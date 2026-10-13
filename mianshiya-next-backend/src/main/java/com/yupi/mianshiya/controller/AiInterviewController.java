package com.yupi.mianshiya.controller;

import cn.dev33.satoken.annotation.SaCheckLogin;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.yupi.mianshiya.ai.*;
import com.yupi.mianshiya.common.*;
import com.yupi.mianshiya.exception.BusinessException;
import com.yupi.mianshiya.model.entity.*;
import com.yupi.mianshiya.service.*;
import feign.Response;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.web.bind.annotation.*;
import javax.servlet.http.HttpServletRequest;
import java.io.*;
import java.util.*;
import java.util.function.Supplier;
import java.util.stream.Collectors;

/**
 * 新模拟面试的唯一浏览器入口：身份从登录态取得，题目快照从现有题库取得。
 * 浏览器不持有内部凭证，也不能提供他人的 ownerId 或自行指定评分参考答案。
 */
@RestController
@RequestMapping("/ai/interviews")
@SaCheckLogin
@Slf4j
public class AiInterviewController {
    private final AiServiceProperties properties;
    private final ObjectProvider<AiInterviewClient> clients;
    private final ObjectMapper mapper;
    private final UserService users;
    private final QuestionService questions;
    private final QuestionBankService banks;
    private final QuestionBankQuestionService links;

    public AiInterviewController(AiServiceProperties properties, ObjectProvider<AiInterviewClient> clients,
            ObjectMapper mapper, UserService users, QuestionService questions,
            QuestionBankService banks, QuestionBankQuestionService links) {
        this.properties = properties;
        this.clients = clients;
        this.mapper = mapper;
        this.users = users;
        this.questions = questions;
        this.banks = banks;
        this.links = links;
    }

    /** 返回字符串 ID，避免前端损失 Java Long 精度；只提供用户可选择的题库名称。 */
    @GetMapping("/sources")
    public BaseResponse<List<Map<String, String>>> sources(HttpServletRequest request) {
        users.getLoginUser(request);
        List<Map<String, String>> data = banks.list(new QueryWrapper<QuestionBank>().orderByAsc("id").last("LIMIT 100"))
                .stream().map(bank -> {
                    Map<String, String> item = new LinkedHashMap<>();
                    item.put("id", bank.getId().toString());
                    item.put("title", bank.getTitle());
                    return item;
                }).collect(Collectors.toList());
        return ResultUtils.success(data);
    }

    /** v1 冻结固定题目；v2 提供候选题池，由画像面试图规划正式问题与评分合同。 */
    @PostMapping
    public BaseResponse<JsonNode> create(@RequestBody JsonNode body, HttpServletRequest request) {
        String owner = users.getLoginUser(request).getId().toString();
        requireObject(body, new HashSet<>(Arrays.asList("commandId", "bankId", "jobPosition", "experience",
                "difficulty", "maxQuestions", "allowFollowup", "background", "jobDescription",
                "workflowVersion", "directionId", "depth", "level", "candidateProfile", "jobProfile")));
        requireUuid(text(body, "commandId", 36));
        String bankId = text(body, "bankId", 20);
        if (!bankId.matches("[0-9]{1,19}")) { invalid("请选择有效题库"); }
        long bank;
        try { bank = Long.parseLong(bankId); } catch (NumberFormatException e) { throw invalidError("题库编号无效"); }
        String job = text(body, "jobPosition", 80);
        String experience = text(body, "experience", 20);
        String difficulty = text(body, "difficulty", 20);
        if (!Arrays.asList("应届生", "1-3 年", "3-5 年", "5 年以上").contains(experience)
                || !Arrays.asList("基础", "进阶", "深入").contains(difficulty)) { invalid("面试设置无效"); }
        if (!body.path("maxQuestions").isInt() || body.path("maxQuestions").asInt() < 1
                || body.path("maxQuestions").asInt() > ("v2".equals(body.path("workflowVersion").asText()) ? 20 : 10)
                || !body.path("allowFollowup").isBoolean()) {
            invalid("题目数量或追问设置无效");
        }
        String background = optionalText(body, "background", 6000);
        String jd = optionalText(body, "jobDescription", 6000);
        QuestionBank selected = banks.getById(bank);
        if (selected == null) { throw new BusinessException(ErrorCode.NOT_FOUND_ERROR, "题库不存在"); }
        List<Long> ids = links.list(new QueryWrapper<QuestionBankQuestion>().eq("questionBankId", bank)
                .orderByAsc("questionId").last("LIMIT 200")).stream()
                .map(QuestionBankQuestion::getQuestionId).collect(Collectors.toList());
        if (ids.isEmpty()) { invalid("该题库没有可用题目，请选择其他题库"); }
        List<Question> candidates = questions.list(new QueryWrapper<Question>().in("id", ids)
                .isNotNull("answer").orderByAsc("id").last("LIMIT 100"));
        List<Map<String, String>> snapshots = new ArrayList<>();
        for (Question question : candidates) {
            // 超长题目不静默截断评分依据，首版只使用契约范围内的完整题目。
            if (question.getAnswer().trim().isEmpty() || question.getAnswer().length() > 16000
                    || question.getTitle() == null || question.getTitle().trim().isEmpty()
                    || question.getTitle().length() > 500
                    || (question.getContent() != null && question.getContent().length() > 12000)) { continue; }
            Map<String, String> snapshot = new LinkedHashMap<>();
            snapshot.put("id", question.getId().toString());
            snapshot.put("title", bounded(question.getTitle(), 500));
            snapshot.put("content", bounded(question.getContent(), 12000));
            snapshot.put("referenceAnswer", bounded(question.getAnswer(), 16000));
            snapshot.put("sourceVersion", question.getUpdateTime() == null ? "legacy-v1"
                    : Long.toString(question.getUpdateTime().getTime()));
            snapshots.add(snapshot);
            if (!"v2".equals(body.path("workflowVersion").asText()) && snapshots.size() == body.get("maxQuestions").asInt()) { break; }
        }
        if (snapshots.isEmpty()) { invalid("题库没有带参考答案的题目，暂时无法评价回答"); }
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("commandId", body.get("commandId").asText());
        payload.put("ownerId", owner);
        payload.put("bankId", bankId);
        payload.put("bankTitle", bounded(selected.getTitle(), 200));
        payload.put("jobPosition", job);
        payload.put("experience", experience);
        payload.put("difficulty", difficulty);
        payload.put("maxQuestions", body.get("maxQuestions").asInt());
        payload.put("allowFollowup", body.get("allowFollowup").asBoolean());
        payload.put("background", background);
        payload.put("jobDescription", jd);
        payload.put("questions", snapshots);
        if (body.has("workflowVersion")) {
            if (!"v2".equals(text(body, "workflowVersion", 4))) { invalid("工作流版本无效"); }
            payload.put("workflowVersion", "v2");
            payload.put("directionId", text(body, "directionId", 80));
            String depth = text(body, "depth", 20);
            String level = text(body, "level", 20);
            if (!Arrays.asList("short", "standard", "deep").contains(depth)
                    || !Arrays.asList("junior", "mid", "senior").contains(level)) { invalid("岗位级别或深度无效"); }
            payload.put("depth", depth);
            payload.put("level", level);
            // 字段结构由 Python 严格 Schema 校验，Java 限制体积且不接收 ownerId。
            for (String key : Arrays.asList("candidateProfile", "jobProfile")) {
                if (!body.path(key).isObject() || body.get(key).toString().length() > 24000) { invalid("画像或岗位资料无效"); }
                payload.put(key, mapper.convertValue(body.get(key), Map.class));
            }
        }
        String id = requestId(request);
        return call(id, () -> clients.getObject().create(id, payload));
    }

    @GetMapping
    public BaseResponse<JsonNode> history(HttpServletRequest request) {
        String owner = users.getLoginUser(request).getId().toString();
        String id = requestId(request);
        return call(id, () -> clients.getObject().list(id, owner));
    }

    /** 方向、岗位模板与考察维度取自同一版本目录，防止前端写死选项。 */
    @GetMapping("/catalog")
    public BaseResponse<JsonNode> catalog(HttpServletRequest request) {
        users.getLoginUser(request);
        String id = requestId(request);
        return call(id, () -> clients.getObject().catalog(id));
    }

    /** 文件以限量 Base64 转发，接口只受理任务，模型解析不占用 Feign 等待时间。 */
    @PostMapping("/setup-jobs")
    public BaseResponse<JsonNode> setup(@RequestBody JsonNode body, HttpServletRequest request) {
        String owner = users.getLoginUser(request).getId().toString();
        requireObject(body, new HashSet<>(Arrays.asList("commandId", "kind", "directionId", "text", "filename", "fileBase64")));
        String commandId = text(body, "commandId", 36);
        requireUuid(commandId);
        String kind = text(body, "kind", 10);
        if (!Arrays.asList("resume", "jd").contains(kind)) { invalid("解析类型无效"); }
        String text = optionalText(body, "text", "jd".equals(kind) ? 12000 : 30000);
        String file = optionalText(body, "fileBase64", 7000000);
        if (text.trim().isEmpty() == file.isEmpty() || ("jd".equals(kind) && !file.isEmpty())) { invalid("请选择文件或填写文本"); }
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("commandId", commandId);
        payload.put("ownerId", owner);
        payload.put("kind", kind);
        payload.put("directionId", text(body, "directionId", 80));
        payload.put("text", text);
        payload.put("filename", optionalText(body, "filename", 200));
        payload.put("fileBase64", file);
        String id = requestId(request);
        return call(id, () -> clients.getObject().setup(id, payload));
    }

    @GetMapping("/setup-jobs/{jobId}")
    public BaseResponse<JsonNode> setupJob(@PathVariable String jobId, HttpServletRequest request) {
        requireUuid(jobId);
        String owner = users.getLoginUser(request).getId().toString();
        String id = requestId(request);
        return call(id, () -> clients.getObject().setupJob(id, jobId, owner));
    }

    @GetMapping("/{sessionId}")
    public BaseResponse<JsonNode> get(@PathVariable String sessionId, HttpServletRequest request) {
        requireUuid(sessionId);
        String owner = users.getLoginUser(request).getId().toString();
        String id = requestId(request);
        return call(id, () -> clients.getObject().get(id, sessionId, owner));
    }

    /** 只允许明确的动作，版本号必须为整数；用户身份始终重新从服务端获取。 */
    @PostMapping("/{sessionId}/commands")
    public BaseResponse<JsonNode> command(@PathVariable String sessionId, @RequestBody JsonNode body,
                                          HttpServletRequest request) {
        requireUuid(sessionId);
        String owner = users.getLoginUser(request).getId().toString();
        requireObject(body, new HashSet<>(Arrays.asList("commandId", "expectedVersion", "questionId", "action", "answer")));
        requireUuid(text(body, "commandId", 36));
        String action = text(body, "action", 20);
        if (!Arrays.asList("answer", "skip", "end", "retry", "hint").contains(action)
                || !body.path("expectedVersion").isIntegralNumber() || !body.path("expectedVersion").canConvertToLong()
                || body.path("expectedVersion").asLong() < 0) { invalid("面试操作参数无效"); }
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("commandId", body.get("commandId").asText());
        payload.put("expectedVersion", body.get("expectedVersion").asLong());
        payload.put("action", action);
        payload.put("answer", optionalText(body, "answer", 8000));
        if (body.hasNonNull("questionId")) { payload.put("questionId", text(body, "questionId", 100)); }
        String id = requestId(request);
        return call(id, () -> clients.getObject().command(id, sessionId, owner, payload));
    }

    /** 内部响应有大小和标识校验，Python 错误消息仅按已知业务状态透传。 */
    private BaseResponse<JsonNode> call(String id, Supplier<Response> operation) {
        if (!properties.isEnabled()) { throw new BusinessException(ErrorCode.OPERATION_ERROR, "AI 服务未启用"); }
        try (Response response = operation.get()) {
            Collection<String> correlation = response.headers().entrySet().stream()
                    .filter(e -> "X-Request-Id".equalsIgnoreCase(e.getKey())).map(Map.Entry::getValue)
                    .findFirst().orElse(Collections.emptyList());
            if (response.body() == null || correlation.size() != 1 || !correlation.contains(id)) {
                throw new IOException("Invalid interview response");
            }
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            try (InputStream input = response.body().asInputStream()) {
                byte[] buffer = new byte[4096];
                int read;
                while ((read = input.read(buffer)) != -1) {
                    if (out.size() + read > 2 * 1024 * 1024) { throw new IOException("Interview response too large"); }
                    out.write(buffer, 0, read);
                }
            }
            JsonNode envelope = mapper.reader().with(DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
                    .readTree(out.toByteArray());
            if (!id.equals(envelope.path("requestId").asText())) { throw new IOException("Interview correlation mismatch"); }
            if (response.status() != 200) {
                if (Arrays.asList(404, 409, 422).contains(response.status())) {
                    throw new BusinessException(ErrorCode.OPERATION_ERROR, envelope.path("message").asText("面试操作失败"));
                }
                throw new IOException("Interview service unavailable");
            }
            if (!envelope.has("data") || (!envelope.get("data").isObject() && !envelope.get("data").isArray())) {
                throw new IOException("Invalid interview data");
            }
            return ResultUtils.success(envelope.get("data"));
        } catch (BusinessException e) {
            throw e;
        } catch (Exception e) {
            log.warn("Interview bridge requestId={} type={}", id, e.getClass().getSimpleName());
            throw new BusinessException(ErrorCode.OPERATION_ERROR, "面试服务暂不可用，请稍后刷新，requestId=" + id);
        }
    }

    private String requestId(HttpServletRequest request) { return (String) request.getAttribute(AiRequestIdFilter.ATTRIBUTE); }
    private void requireUuid(String value) {
        if (value == null || !value.matches("[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}")) {
            invalid("面试或请求编号无效");
        }
    }
    private void requireObject(JsonNode body, Set<String> allowed) {
        if (body == null || !body.isObject()) { invalid("请求参数无效"); }
        body.fieldNames().forEachRemaining(key -> { if (!allowed.contains(key)) { invalid("请求包含不支持的字段"); } });
    }
    private String text(JsonNode body, String key, int max) {
        if (!body.path(key).isTextual() || body.get(key).asText().trim().isEmpty() || body.get(key).asText().length() > max) {
            invalid("字段 " + key + " 无效");
        }
        return body.get(key).asText();
    }
    private String optionalText(JsonNode body, String key, int max) {
        if (!body.has(key)) { return ""; }
        if (!body.get(key).isTextual() || body.get(key).asText().length() > max) { invalid("字段 " + key + " 无效"); }
        return body.get(key).asText();
    }
    private String bounded(String value, int max) { return value == null ? "" : value.substring(0, Math.min(value.length(), max)); }
    private BusinessException invalidError(String message) { return new BusinessException(ErrorCode.PARAMS_ERROR, message); }
    private void invalid(String message) { throw invalidError(message); }
}

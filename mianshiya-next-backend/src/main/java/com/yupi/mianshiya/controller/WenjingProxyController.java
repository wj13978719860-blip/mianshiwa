package com.yupi.mianshiya.controller;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.yupi.mianshiya.ai.AiRequestIdFilter;
import com.yupi.mianshiya.ai.AiServiceProperties;
import com.yupi.mianshiya.ai.WenjingRoutes;
import com.yupi.mianshiya.ai.WenjingTransport;
import com.yupi.mianshiya.model.entity.User;
import com.yupi.mianshiya.service.UserService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import javax.servlet.http.HttpServletRequest;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.regex.Pattern;

/**
 * 问镜面试的浏览器入口：按白名单把 /api/ai/wenjing/api/v1/** 透传给 Python。
 * 身份只取自 Sa-Token 登录态并以 X-Owner-Id 注入；内部凭证不出现在浏览器。
 * 响应状态码和正文保持上游原样，前端沿用上游 API 客户端的错误处理。
 */
@RestController
@RequestMapping("/ai/wenjing/api/v1")
@Slf4j
public class WenjingProxyController {
    private static final String PREFIX = "/ai/wenjing/api/v1/";
    private static final int MAX_JSON_BYTES = 1024 * 1024;
    private static final Pattern IDEMPOTENCY_KEY = Pattern.compile("[A-Za-z0-9_.:-]{1,128}");
    private static final Set<String> UPLOAD_TYPES = new HashSet<>(Arrays.asList(".pdf", ".docx", ".txt", ".md"));
    private final AiServiceProperties properties;
    private final WenjingTransport transport;
    private final UserService users;
    private final ObjectMapper mapper;

    public WenjingProxyController(AiServiceProperties properties, WenjingTransport transport,
                                  UserService users, ObjectMapper mapper) {
        this.properties = properties;
        this.transport = transport;
        this.users = users;
        this.mapper = mapper;
    }

    @RequestMapping("/**")
    public ResponseEntity<byte[]> proxy(HttpServletRequest request, @RequestBody(required = false) byte[] body) {
        String path = relativePath(request);
        String method = request.getMethod();
        if (!WenjingRoutes.allowed(method, path) || !WenjingRoutes.validQuery(request.getQueryString())) {
            return error(HttpStatus.NOT_FOUND, "Not Found");
        }
        byte[] payload = body == null ? new byte[0] : body;
        if (payload.length > 0) {
            String rejected = rejectJson(request.getContentType(), payload);
            if (rejected != null) {
                return error(HttpStatus.BAD_REQUEST, rejected);
            }
        }
        String query = request.getQueryString();
        Map<String, String> headers = baseHeaders(request);
        if (headers == null) {
            return error(HttpStatus.UNAUTHORIZED, "login required");
        }
        if (payload.length > 0) {
            headers.put("Content-Type", MediaType.APPLICATION_JSON_VALUE);
        }
        return forward(request, method, query == null ? path : path + "?" + query, headers, payload);
    }

    /** 简历上传：Sa-Token 读参数会提前解析 multipart，这里接收文件后按上游表单（仅 file 字段）重新组装。 */
    @PostMapping(value = {"/interview/resume/parse-jobs", "/interview/resume/parse"},
            consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<byte[]> upload(HttpServletRequest request, @RequestPart("file") MultipartFile file) {
        String path = relativePath(request);
        if (!WenjingRoutes.UPLOADS.contains(path)) {
            return error(HttpStatus.NOT_FOUND, "Not Found");
        }
        if (request.getParameterMap().containsKey("llm_config")) {
            return error(HttpStatus.BAD_REQUEST, "不支持自定义模型配置");
        }
        String filename = safeFilename(file.getOriginalFilename());
        if (filename == null) {
            return error(HttpStatus.UNSUPPORTED_MEDIA_TYPE, "仅支持 PDF、DOCX、TXT、MD 简历");
        }
        Map<String, String> headers = baseHeaders(request);
        if (headers == null) {
            return error(HttpStatus.UNAUTHORIZED, "login required");
        }
        String boundary = "----wenjing" + UUID.randomUUID().toString().replace("-", "");
        headers.put("Content-Type", "multipart/form-data; boundary=" + boundary);
        try {
            return forward(request, "POST", path, headers, multipart(boundary, filename, file));
        } catch (IOException e) {
            return error(HttpStatus.BAD_REQUEST, "简历文件读取失败");
        }
    }

    private ResponseEntity<byte[]> forward(HttpServletRequest request, String method, String pathAndQuery,
                                           Map<String, String> headers, byte[] body) {
        String requestId = requestId(request);
        if (!properties.isEnabled()) {
            return error(HttpStatus.SERVICE_UNAVAILABLE, "AI 服务未启用");
        }
        try {
            WenjingTransport.Reply reply = transport.exchange(method, pathAndQuery, headers, body);
            HttpHeaders out = new HttpHeaders();
            out.setCacheControl("no-store");
            String type = reply.getContentType();
            out.set(HttpHeaders.CONTENT_TYPE, type == null ? MediaType.APPLICATION_JSON_VALUE : type);
            return new ResponseEntity<>(reply.getBody(), out, HttpStatus.valueOf(reply.getStatus()));
        } catch (Exception e) {
            log.warn("Wenjing bridge requestId={} type={}", requestId, e.getClass().getSimpleName());
            return error(HttpStatus.BAD_GATEWAY, "面试服务暂不可用，请稍后重试，requestId=" + requestId);
        }
    }

    /** 未登录返回 null；ownerId 用十进制字符串，避免长整型精度问题。 */
    private Map<String, String> baseHeaders(HttpServletRequest request) {
        User user = users.getLoginUserPermitNull(request);
        if (user == null || user.getId() == null) {
            return null;
        }
        Map<String, String> headers = new LinkedHashMap<>();
        headers.put("Accept", MediaType.APPLICATION_JSON_VALUE);
        headers.put("X-AI-Service-Token", properties.getToken());
        headers.put("X-Request-Id", requestId(request));
        headers.put("X-Owner-Id", user.getId().toString());
        String idempotency = request.getHeader("Idempotency-Key");
        if (idempotency != null && IDEMPOTENCY_KEY.matcher(idempotency).matches()) {
            headers.put("Idempotency-Key", idempotency);
        }
        return headers;
    }

    /** 只接受 JSON 对象；llm_config 允许指定任意模型地址和密钥，第一期不开放。 */
    private String rejectJson(String contentType, byte[] body) {
        if (contentType == null || !contentType.toLowerCase(Locale.ROOT).startsWith(MediaType.APPLICATION_JSON_VALUE)) {
            return "请求必须是 JSON";
        }
        if (body.length > MAX_JSON_BYTES) {
            return "请求体过大";
        }
        try {
            JsonNode node = mapper.readTree(body);
            if (node == null || !node.isObject()) {
                return "请求必须是 JSON 对象";
            }
            if (node.has("llm_config")) {
                return "不支持自定义模型配置";
            }
        } catch (IOException e) {
            return "请求 JSON 无效";
        }
        return null;
    }

    private static String relativePath(HttpServletRequest request) {
        String uri = request.getRequestURI().substring(request.getContextPath().length());
        return uri.startsWith(PREFIX) ? uri.substring(PREFIX.length()) : "";
    }

    private static String safeFilename(String original) {
        String name = original == null ? "" : original.replaceAll("[\\r\\n\"\\\\/]", "_").trim();
        int dot = name.lastIndexOf('.');
        if (name.isEmpty() || name.length() > 200 || dot < 0
                || !UPLOAD_TYPES.contains(name.substring(dot).toLowerCase(Locale.ROOT))) {
            return null;
        }
        return name;
    }

    private static byte[] multipart(String boundary, String filename, MultipartFile file) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        String contentType = file.getContentType() == null ? MediaType.APPLICATION_OCTET_STREAM_VALUE
                : file.getContentType().replaceAll("[\\r\\n]", "");
        String head = "--" + boundary + "\r\n"
                + "Content-Disposition: form-data; name=\"file\"; filename=\"" + filename + "\"\r\n"
                + "Content-Type: " + contentType + "\r\n\r\n";
        out.write(head.getBytes(StandardCharsets.UTF_8));
        out.write(file.getBytes());
        out.write(("\r\n--" + boundary + "--\r\n").getBytes(StandardCharsets.UTF_8));
        return out.toByteArray();
    }

    private String requestId(HttpServletRequest request) {
        return (String) request.getAttribute(AiRequestIdFilter.ATTRIBUTE);
    }

    private ResponseEntity<byte[]> error(HttpStatus status, String detail) {
        Map<String, String> body = Collections.singletonMap("detail", detail);
        try {
            return ResponseEntity.status(status).contentType(MediaType.APPLICATION_JSON)
                    .body(mapper.writeValueAsBytes(body));
        } catch (IOException e) {
            return ResponseEntity.status(status).build();
        }
    }
}

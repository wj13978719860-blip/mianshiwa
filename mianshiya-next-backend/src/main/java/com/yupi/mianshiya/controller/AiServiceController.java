package com.yupi.mianshiya.controller;

import cn.dev33.satoken.annotation.SaCheckLogin;
import cn.dev33.satoken.annotation.SaCheckRole;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.yupi.mianshiya.ai.*;
import com.yupi.mianshiya.common.BaseResponse;
import com.yupi.mianshiya.common.ErrorCode;
import com.yupi.mianshiya.common.ResultUtils;
import com.yupi.mianshiya.constant.UserConstant;
import com.yupi.mianshiya.exception.BusinessException;
import feign.Response;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.web.bind.annotation.*;
import javax.servlet.http.HttpServletRequest;
import java.io.IOException;
import java.io.InputStream;
import java.io.ByteArrayOutputStream;
import java.net.ConnectException;
import java.net.SocketTimeoutException;
import java.util.Collection;
import java.util.Collections;

/**
 * 管理员验证 Java → Python 通信的入口，不承担真实模型推理。
 * 执行顺序：登录/角色校验 → 参数校验 → 接入开关 → Feign 调用 → 响应契约校验。
 */
@Slf4j
@RestController
@RequestMapping("/ai/service")
public class AiServiceController {
    private final AiServiceProperties properties;
    // 延迟获取客户端：接入关闭时没有这个 Bean，控制器仍能正常创建并返回停用提示。
    private final ObjectProvider<AiServiceClient> clients;
    private final ObjectMapper mapper;

    public AiServiceController(AiServiceProperties properties, ObjectProvider<AiServiceClient> clients,
                               ObjectMapper mapper) {
        this.properties = properties;
        this.clients = clients;
        this.mapper = mapper;
    }

    /** 仅允许登录管理员调用，返回项目统一的 BaseResponse，而非直接暴露 Python 响应。 */
    @PostMapping("/probe")
    @SaCheckLogin
    @SaCheckRole(UserConstant.ADMIN_ROLE)
    public BaseResponse<JsonNode> probe(@RequestBody(required = false) String body, HttpServletRequest request) {
        // 取过滤器生成的 UUID，随后传给 Python；两端日志可用同一个值查找。
        String id = (String) request.getAttribute(AiRequestIdFilter.ATTRIBUTE);
        String message;
        try {
            // 本地先校验，非法请求不占用 Python 服务资源。
            message = AiProbeContract.parseMessage(mapper, body);
        } catch (IOException e) {
            throw new BusinessException(ErrorCode.PARAMS_ERROR, "请求参数错误，requestId=" + id);
        }
        if (!properties.isEnabled()) {
            throw new BusinessException(ErrorCode.OPERATION_ERROR, "AI 服务接入未启用，requestId=" + id);
        }
        // try-with-resources 会关闭 Feign Response，释放响应流和连接资源。
        String failureType = "PROTOCOL_ERROR";
        try (Response response = clients.getObject().probe(id, Collections.singletonMap("message", message))) {
            // 将内部认证、参数契约、服务不可用分别记录，外部统一返回脱敏失败信息。
            if (response.status() != 200) {
                if (response.status() == 401) {
                    failureType = "INTERNAL_AUTH_FAILED";
                } else if (response.status() == 422) {
                    failureType = "CONTRACT_ERROR";
                } else if (response.status() == 503) {
                    // Python 应用响应带请求标识；LoadBalancer 无实例时生成的 503 通常不带。
                    failureType = response.headers().keySet().stream()
                            .anyMatch(h -> "X-Request-Id".equalsIgnoreCase(h)) ? "SERVICE_NOT_READY" : "NO_INSTANCE";
                } else {
                    failureType = "HTTP_" + response.status();
                }
                throw new IOException("HTTP failure");
            }
            // 响应头大小写不敏感，但必须恰好包含本次请求标识，不能串到其他请求。
            Collection<String> headers = response.headers().entrySet().stream()
                    .filter(e -> "X-Request-Id".equalsIgnoreCase(e.getKey()))
                    .map(java.util.Map.Entry::getValue).findFirst().orElse(Collections.emptyList());
            if (headers.size() != 1 || !headers.contains(id) || response.body() == null) {
                throw new IOException("Invalid response headers");
            }
            // 探测响应很小，最多读取 8 KB，避免异常服务返回过大正文占用内存。
            byte[] bytes;
            try (InputStream in = response.body().asInputStream(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[1024];
                int read;
                while ((read = in.read(buffer)) != -1) {
                    if (out.size() + read > 8192) { throw new IOException("Response too large"); }
                    out.write(buffer, 0, read);
                }
                bytes = out.toByteArray();
            }
            // 只有响应头和正文都符合约定，才对外返回 code=0。
            JsonNode data = AiProbeContract.parseResponse(mapper, bytes, id, properties.getName());
            return ResultUtils.success(data);
        } catch (Exception e) {
            // Feign 异常可能包含内部请求头；只记录类别，不打印原始异常或响应中的凭证。
            log.warn("AI call failed requestId={} type={}", id, failureCategory(e, failureType));
            throw new BusinessException(ErrorCode.OPERATION_ERROR, "AI 服务调用失败，请稍后重试，requestId=" + id);
        }
    }

    /** Feign 可能包装底层网络异常，沿 cause 链识别连接超时、读取超时与连接拒绝。 */
    private String failureCategory(Throwable error, String fallback) {
        for (Throwable cause = error; cause != null; cause = cause.getCause()) {
            if (cause instanceof SocketTimeoutException) {
                String message = cause.getMessage();
                return message != null && message.toLowerCase(java.util.Locale.ROOT).contains("connect")
                        ? "CONNECT_TIMEOUT" : "READ_TIMEOUT";
            }
            if (cause instanceof ConnectException) { return "CONNECTION_REFUSED"; }
        }
        return fallback;
    }
}

package com.yupi.mianshiya.ai;

import feign.Response;
import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import java.util.Map;

/**
 * Java 调用 Python 的接口声明，实际 HTTP 请求由 OpenFeign 自动生成。
 * name 是 Nacos 中的服务名：LoadBalancer 从发现结果中选实例，不需要写死 IP 和端口。
 * contextId 用于区分客户端；configuration 指定仅属于此客户端的超时和凭证设置。
 */
@FeignClient(name = "${ai.service.name:mianshiya-ai-service}", contextId = "aiServiceClient",
        configuration = AiClientConfiguration.class)
public interface AiServiceClient {
    // 传入 Java 生成的请求标识及 JSON 正文；不转发用户 Cookie。
    // 返回原始 Response，便于控制器检查 HTTP 状态、响应头和正文是否符合约定。
    @PostMapping(value = "/internal/v1/probe", consumes = "application/json")
    Response probe(@RequestHeader("X-Request-Id") String requestId, @RequestBody Map<String, String> body);
}

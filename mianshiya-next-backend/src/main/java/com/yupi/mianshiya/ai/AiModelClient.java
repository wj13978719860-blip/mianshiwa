package com.yupi.mianshiya.ai;

import feign.Response;
import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import java.util.Map;

/** 真实模型调用专用客户端：服务名相同，但使用独立的生成超时预算。 */
@FeignClient(name = "${ai.service.name:mianshiya-ai-service}", contextId = "aiModelClient",
        configuration = AiModelClientConfiguration.class)
public interface AiModelClient {
    /** 只传测试问题和追踪 UUID，模型 Key 始终由 Python 管理。 */
    @PostMapping(value = "/internal/v1/model/probe", consumes = "application/json")
    Response probe(@RequestHeader("X-Request-Id") String requestId, @RequestBody Map<String, String> body);
}

package com.yupi.mianshiya.ai;

import feign.Response;
import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.*;
import java.util.Map;

/** 新模拟面试专用内部接口；HTTP 只受理命令，不同步等待整个模型流程。 */
@FeignClient(name = "${ai.service.name:mianshiya-ai-service}", contextId = "aiInterviewClient",
        configuration = AiClientConfiguration.class)
public interface AiInterviewClient {
    /** 问镜方向目录及异步资料解析任务，沿用同一内部认证与服务发现。 */
    @GetMapping("/internal/v1/interviews/catalog")
    Response catalog(@RequestHeader("X-Request-Id") String requestId);

    @PostMapping("/internal/v1/interviews/setup-jobs")
    Response setup(@RequestHeader("X-Request-Id") String requestId, @RequestBody Map<String, Object> body);

    @GetMapping("/internal/v1/interviews/setup-jobs/{id}")
    Response setupJob(@RequestHeader("X-Request-Id") String requestId, @PathVariable("id") String id,
                      @RequestParam("ownerId") String ownerId);

    @PostMapping("/internal/v1/interviews")
    Response create(@RequestHeader("X-Request-Id") String requestId, @RequestBody Map<String, Object> body);

    @GetMapping("/internal/v1/interviews")
    Response list(@RequestHeader("X-Request-Id") String requestId, @RequestParam("ownerId") String ownerId);

    @GetMapping("/internal/v1/interviews/{id}")
    Response get(@RequestHeader("X-Request-Id") String requestId, @PathVariable("id") String id,
                 @RequestParam("ownerId") String ownerId);

    @PostMapping("/internal/v1/interviews/{id}/commands")
    Response command(@RequestHeader("X-Request-Id") String requestId, @PathVariable("id") String id,
                     @RequestParam("ownerId") String ownerId, @RequestBody Map<String, Object> body);
}

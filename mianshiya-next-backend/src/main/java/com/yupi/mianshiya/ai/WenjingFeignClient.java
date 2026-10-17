package com.yupi.mianshiya.ai;

import feign.Response;
import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.*;

import java.util.Collection;
import java.util.Map;

/** 面试调用由 OpenFeign 发出；服务名经 Spring Cloud LoadBalancer / Nacos 解析。 */
@FeignClient(name = "${ai.service.name:mianshiya-ai-service}", contextId = "wenjingFeignClient",
        configuration = WenjingFeignConfiguration.class)
public interface WenjingFeignClient {
    String PATH = "/internal/wenjing/api/v1/{path}";

    // path 仅来自控制器白名单；查询参数单独编码，不能让浏览器指定目标主机。
    @GetMapping(PATH)
    Response get(@PathVariable("path") String path,
                 @RequestParam Map<String, Collection<String>> query,
                 @RequestHeader Map<String, String> headers);

    @PostMapping(PATH)
    Response post(@PathVariable("path") String path,
                  @RequestParam Map<String, Collection<String>> query,
                  @RequestHeader Map<String, String> headers,
                  @RequestBody byte[] body);

    @DeleteMapping(PATH)
    Response delete(@PathVariable("path") String path,
                    @RequestParam Map<String, Collection<String>> query,
                    @RequestHeader Map<String, String> headers);
}

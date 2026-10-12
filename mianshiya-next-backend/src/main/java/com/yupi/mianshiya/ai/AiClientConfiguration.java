package com.yupi.mianshiya.ai;

import feign.Logger;
import feign.Request;
import feign.RequestInterceptor;
import feign.Retryer;
import org.springframework.context.annotation.Bean;
import java.util.concurrent.TimeUnit;

/**
 * AI 服务专用的 Feign 设置：超时、重试策略、内部凭证和日志级别。
 * 故意不加 @Configuration，仅由 AiServiceClient 引用，避免影响其他 Feign 客户端。
 */
public class AiClientConfiguration {
    // 禁止自动重试，避免未来的生成题目、记录回答等操作被重复执行。
    @Bean
    public Retryer aiRetryer() { return Retryer.NEVER_RETRY; }

    // 不输出原始请求，避免凭证泄漏；由控制器记录脱敏后的调用结果。
    @Bean
    public Logger.Level aiLogLevel() { return Logger.Level.NONE; }

    @Bean
    public Request.Options aiOptions(AiServiceProperties p) {
        // 分别限制建立连接和等待响应的时间；false 表示不跟随重定向，避免凭证传到其他地址。
        return new Request.Options(p.getConnectTimeoutMs(), TimeUnit.MILLISECONDS,
                p.getReadTimeoutMs(), TimeUnit.MILLISECONDS, false);
    }

    @Bean
    public RequestInterceptor aiCredential(AiServiceProperties p) {
        // 凭证由 Java 服务端附加到内部调用中，浏览器不需要持有它。
        return template -> template.header("X-AI-Service-Token", p.getToken());
    }
}

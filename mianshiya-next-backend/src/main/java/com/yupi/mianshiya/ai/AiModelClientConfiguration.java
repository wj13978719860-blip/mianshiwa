package com.yupi.mianshiya.ai;

import feign.Request;
import org.springframework.context.annotation.Bean;
import java.util.concurrent.TimeUnit;

/** 继承内部认证、关闭重试与日志设置，仅延长真实模型的读取预算。 */
public class AiModelClientConfiguration extends AiClientConfiguration {
    @Override
    @Bean
    public Request.Options aiOptions(AiServiceProperties properties) {
        // Python 默认总预算 30 秒，Java 默认等待 40 秒，留出服务转发开销。
        return new Request.Options(properties.getConnectTimeoutMs(), TimeUnit.MILLISECONDS,
                properties.getModelReadTimeoutMs(), TimeUnit.MILLISECONDS, false);
    }
}

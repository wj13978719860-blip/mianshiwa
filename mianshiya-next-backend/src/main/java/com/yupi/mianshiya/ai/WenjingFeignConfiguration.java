package com.yupi.mianshiya.ai;

import feign.Request;
import feign.codec.EncodeException;
import feign.codec.Encoder;
import org.springframework.context.annotation.Bean;

import java.util.concurrent.TimeUnit;

/** 仅用于面试 Feign 子上下文；不加 Configuration，避免影响探测客户端。 */
public class WenjingFeignConfiguration extends AiClientConfiguration {
    @Override
    @Bean
    public Request.Options aiOptions(AiServiceProperties properties) {
        return new Request.Options(properties.getConnectTimeoutMs(), TimeUnit.MILLISECONDS,
                properties.getWenjingReadTimeoutMs(), TimeUnit.MILLISECONDS, false);
    }

    @Bean
    public Encoder wenjingBodyEncoder() {
        // 控制器已检查 JSON 或重组 multipart。直接发送原字节，避免重复 JSON 编码或改写 boundary。
        return (body, type, template) -> {
            if (!(body instanceof byte[])) {
                throw new EncodeException("Wenjing request body must be bytes");
            }
            template.body((byte[]) body, null);
        };
    }
}

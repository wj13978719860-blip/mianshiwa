package com.yupi.mianshiya.ai;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.cloud.openfeign.EnableFeignClients;
import org.springframework.context.annotation.Configuration;

/**
 * 仅在 ai.service.enabled=true 时创建 AI Feign 客户端。
 * Nacos 注册发现的开关在 application.yml 中，与这里使用相同配置项。
 */
@Configuration
@ConditionalOnProperty(name = "ai.service.enabled", havingValue = "true")
@EnableFeignClients(clients = {AiServiceClient.class, AiModelClient.class, AiInterviewClient.class})
public class AiDiscoveryConfiguration {
}

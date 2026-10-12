package com.yupi.mianshiya.ai;

import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;
import org.springframework.beans.factory.InitializingBean;

/**
 * 将 application.yml 的 ai.service 配置绑定到 Java 字段。
 * Spring 完成配置绑定后会执行 afterPropertiesSet，提前发现缺少凭证等配置错误。
 */
@Getter
@Setter
@Component
@ConfigurationProperties(prefix = "ai.service")
public class AiServiceProperties implements InitializingBean {
    /** 是否开启独立 AI 服务接入，默认关闭。 */
    private boolean enabled;
    /** Java 与 Python 共享的内部凭证，只能来自私有配置或环境变量。 */
    private String token = "";
    /** Nacos 中的 AI 服务名，需要与 Python 注册名称一致。 */
    private String name = "mianshiya-ai-service";
    /** 建立 TCP 连接的超时时间，单位毫秒。 */
    private int connectTimeoutMs = 2000;
    /** 等待响应数据的超时时间，单位毫秒。 */
    private int readTimeoutMs = 3000;
    /** 真实模型接口读取超时，独立于快速通信探测，默认 40 秒。 */
    private int modelReadTimeoutMs = 40000;

    @Override
    public void afterPropertiesSet() {
        // 关闭接入时不要求凭证；开启时立即校验，避免启动后才发现无法调用。
        if (enabled && (token.trim().isEmpty() || name.trim().isEmpty()
                || connectTimeoutMs <= 0 || readTimeoutMs <= 0 || modelReadTimeoutMs <= 0)) {
            throw new IllegalStateException("AI service credential, name and positive timeouts are required");
        }
    }
}

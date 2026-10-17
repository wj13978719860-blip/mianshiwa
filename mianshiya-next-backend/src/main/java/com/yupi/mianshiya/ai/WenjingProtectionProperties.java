package com.yupi.mianshiya.ai;

import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

/** Java 到 Python 的保护参数；均为单个 Java 实例的起始值，须按压测调整。 */
@Getter
@Setter
@Component
@ConfigurationProperties(prefix = "ai.service.protection")
public class WenjingProtectionProperties {
    private boolean enabled = true;
    private int pollConcurrency = 32;
    private int readConcurrency = 16;
    private int writeConcurrency = 8;
    private int setupConcurrency = 4;
    private double errorRatio = 0.5;
    private int minRequests = 20;
    private int statIntervalMs = 10000;
    private int openSeconds = 10;
}

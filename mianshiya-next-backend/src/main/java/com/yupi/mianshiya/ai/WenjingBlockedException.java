package com.yupi.mianshiya.ai;

import java.io.IOException;

/** 区分本地保护拒绝与已经发出请求后的通信故障。 */
public class WenjingBlockedException extends IOException {
    private final boolean circuitOpen;

    public WenjingBlockedException(boolean circuitOpen, Throwable cause) {
        super(circuitOpen ? "AI circuit open" : "AI concurrency limit", cause);
        this.circuitOpen = circuitOpen;
    }

    public boolean isCircuitOpen() {
        return circuitOpen;
    }
}

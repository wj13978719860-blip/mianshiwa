package com.yupi.mianshiya.blackfilter;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

class BlackIpUtilsTest {
    @AfterEach
    void clearBlacklist() {
        BlackIpUtils.rebuildBlackIp("blackIpList: []");
    }

    @Test
    void updatesReplaceBlacklistAndOnlyBlockExactMatches() {
        BlackIpUtils.rebuildBlackIp("blackIpList: [192.0.2.123]");
        assertTrue(BlackIpUtils.isBlackIp("192.0.2.123"));
        assertFalse(BlackIpUtils.isBlackIp("127.0.0.1"));
        BlackIpUtils.rebuildBlackIp("blackIpList: [192.0.2.124]");
        assertFalse(BlackIpUtils.isBlackIp("192.0.2.123"));
        assertTrue(BlackIpUtils.isBlackIp("192.0.2.124"));
        BlackIpUtils.rebuildBlackIp("blackIpList: []");
        assertFalse(BlackIpUtils.isBlackIp("192.0.2.124"));
    }
}

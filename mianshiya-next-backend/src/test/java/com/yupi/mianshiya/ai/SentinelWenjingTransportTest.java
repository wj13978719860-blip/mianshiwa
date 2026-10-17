package com.yupi.mianshiya.ai;

import com.alibaba.csp.sentinel.slots.block.RuleConstant;
import com.alibaba.csp.sentinel.slots.block.degrade.DegradeRule;
import com.alibaba.csp.sentinel.slots.block.degrade.DegradeRuleManager;
import com.alibaba.csp.sentinel.slots.block.flow.FlowRule;
import com.alibaba.csp.sentinel.slots.block.flow.FlowRuleManager;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.net.SocketTimeoutException;
import java.util.Collections;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** 使用真实 Sentinel 规则执行，不连接 Nacos、数据库或模型。 */
class SentinelWenjingTransportTest {
    private final WenjingTransport delegate = mock(WenjingTransport.class);
    private final WenjingProtectionProperties properties = new WenjingProtectionProperties();

    @BeforeAll
    static void useWorkspaceLogs() {
        if (System.getProperty("csp.sentinel.log.dir") == null) {
            System.setProperty("csp.sentinel.log.dir", new java.io.File("target/sentinel-test-logs").getAbsolutePath());
        }
    }

    @AfterEach
    void clearRules() {
        FlowRuleManager.loadRules(Collections.emptyList());
        DegradeRuleManager.loadRules(Collections.emptyList());
    }

    private SentinelWenjingTransport protectedTransport() {
        SentinelWenjingTransport transport = new SentinelWenjingTransport(delegate, properties);
        transport.afterPropertiesSet();
        return transport;
    }

    private WenjingTransport.Reply call(WenjingTransport transport, String method, String path) throws IOException {
        return transport.exchange(method, path, Collections.emptyMap(), new byte[0]);
    }

    @Test
    void blocksExcessPollsWithoutCallingPythonAndReleasesPermit() throws Exception {
        properties.setPollConcurrency(1);
        SentinelWenjingTransport transport = protectedTransport();
        CountDownLatch entered = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        when(delegate.exchange(anyString(), anyString(), anyMap(), any())).thenAnswer(invocation -> {
            entered.countDown();
            if (!release.await(5, TimeUnit.SECONDS)) {
                throw new IOException("test latch timed out");
            }
            return new WenjingTransport.Reply(200, "application/json", new byte[0]);
        });
        ExecutorService executor = Executors.newSingleThreadExecutor();
        try {
            Future<?> first = executor.submit(() -> call(transport, "GET", "interview/sessions/a/question?timeout=30"));
            assertTrue(entered.await(3, TimeUnit.SECONDS));
            WenjingBlockedException blocked = assertThrows(WenjingBlockedException.class,
                    () -> call(transport, "GET", "interview/sessions/b/question?timeout=30"));
            assertFalse(blocked.isCircuitOpen());
            verify(delegate, times(1)).exchange(anyString(), anyString(), anyMap(), any());
            release.countDown();
            first.get(3, TimeUnit.SECONDS);
            assertEquals(200, call(transport, "GET", "interview/sessions/c/question").getStatus());
        } finally {
            release.countDown();
            executor.shutdownNow();
        }
    }

    @Test
    void countsHttp5xxAndOpensCircuitButPreservesFirstResponse() throws Exception {
        properties.setMinRequests(1);
        properties.setOpenSeconds(1);
        SentinelWenjingTransport transport = protectedTransport();
        WenjingTransport.Reply unavailable = new WenjingTransport.Reply(503, "application/json", new byte[]{1});
        when(delegate.exchange(anyString(), anyString(), anyMap(), any())).thenReturn(unavailable);
        assertSame(unavailable, call(transport, "GET", "interview/dimensions"));
        WenjingBlockedException blocked = assertThrows(WenjingBlockedException.class,
                () -> call(transport, "GET", "interview/directions"));
        assertTrue(blocked.isCircuitOpen());
        verify(delegate, times(1)).exchange(anyString(), anyString(), anyMap(), any());
        // 等待真实的熔断窗口，验证半开探测成功后恢复，而不是手动清规则。
        when(delegate.exchange(anyString(), anyString(), anyMap(), any()))
                .thenReturn(new WenjingTransport.Reply(200, "application/json", new byte[0]));
        Thread.sleep(1100);
        assertEquals(200, call(transport, "GET", "interview/dimensions").getStatus());
        assertEquals(200, call(transport, "GET", "interview/directions").getStatus());
    }

    @Test
    void connectionTimeoutCountsAsFailureWithoutAutomaticRetry() throws Exception {
        properties.setMinRequests(1);
        SentinelWenjingTransport transport = protectedTransport();
        when(delegate.exchange(anyString(), anyString(), anyMap(), any())).thenThrow(new SocketTimeoutException("slow"));
        assertThrows(SocketTimeoutException.class, () -> call(transport, "POST", "interview/jd/parse"));
        assertTrue(assertThrows(WenjingBlockedException.class,
                () -> call(transport, "POST", "interview/resume/parse-jobs")).isCircuitOpen());
        verify(delegate, times(1)).exchange(anyString(), anyString(), anyMap(), any());
    }

    @Test
    void businessErrorsAndRateLimitsDoNotOpenCircuitOrRetryWrites() throws Exception {
        properties.setMinRequests(1);
        SentinelWenjingTransport transport = protectedTransport();
        when(delegate.exchange(anyString(), anyString(), anyMap(), any()))
                .thenReturn(new WenjingTransport.Reply(409, "application/json", new byte[0]))
                .thenReturn(new WenjingTransport.Reply(429, "application/json", new byte[0]))
                .thenReturn(new WenjingTransport.Reply(200, "application/json", new byte[0]));
        assertEquals(409, call(transport, "POST", "interview/sessions/a/answer").getStatus());
        assertEquals(429, call(transport, "POST", "interview/sessions/a/answer").getStatus());
        assertEquals(200, call(transport, "POST", "interview/sessions/a/answer").getStatus());
        verify(delegate, times(3)).exchange(anyString(), anyString(), anyMap(), any());
    }

    @Test
    void retainsExistingRulesAndUsesNoSlowCallBreaker() {
        FlowRule existingFlow = new FlowRule("question-list").setGrade(RuleConstant.FLOW_GRADE_QPS).setCount(10);
        DegradeRule existingBreaker = new DegradeRule("question-list").setGrade(1).setCount(0.5).setTimeWindow(10);
        FlowRuleManager.loadRules(Collections.singletonList(existingFlow));
        DegradeRuleManager.loadRules(Collections.singletonList(existingBreaker));
        protectedTransport();
        assertTrue(FlowRuleManager.getRules().stream().anyMatch(rule -> "question-list".equals(rule.getResource())));
        assertTrue(DegradeRuleManager.getRules().stream().anyMatch(rule -> "question-list".equals(rule.getResource())));
        assertEquals(4, DegradeRuleManager.getRules().stream()
                .filter(rule -> rule.getResource().startsWith(SentinelWenjingTransport.PREFIX))
                .filter(rule -> rule.getGrade() == RuleConstant.DEGRADE_GRADE_EXCEPTION_RATIO).count());
    }

    @Test
    void groupsByOperationRatherThanSessionId() {
        assertEquals("ai:wenjing:poll", SentinelWenjingTransport.resourceFor("GET", "interview/sessions/a/question?timeout=30"));
        assertEquals("ai:wenjing:setup", SentinelWenjingTransport.resourceFor("GET", "interview/resume/parse-jobs/abc"));
        assertEquals("ai:wenjing:write", SentinelWenjingTransport.resourceFor("POST", "interview/sessions/a/answer"));
        assertEquals("ai:wenjing:read", SentinelWenjingTransport.resourceFor("GET", "interview/sessions/a/report"));
    }

    @Test
    void disablingProtectionDelegatesDirectly() throws Exception {
        properties.setEnabled(false);
        when(delegate.exchange(anyString(), anyString(), anyMap(), any()))
                .thenReturn(new WenjingTransport.Reply(200, "application/json", new byte[0]));
        assertEquals(200, call(protectedTransport(), "GET", "interview/dimensions").getStatus());
    }

    @Test
    void isolatedErrorBelowMinimumSampleDoesNotOpenCircuit() throws Exception {
        SentinelWenjingTransport transport = protectedTransport();
        when(delegate.exchange(anyString(), anyString(), anyMap(), any()))
                .thenReturn(new WenjingTransport.Reply(500, "application/json", new byte[0]))
                .thenReturn(new WenjingTransport.Reply(200, "application/json", new byte[0]));
        assertEquals(500, call(transport, "GET", "interview/dimensions").getStatus());
        assertEquals(200, call(transport, "GET", "interview/dimensions").getStatus());
    }

    @Test
    void rejectsInvalidLimitsAtStartup() {
        properties.setPollConcurrency(0);
        assertThrows(IllegalArgumentException.class, this::protectedTransport);
    }
}

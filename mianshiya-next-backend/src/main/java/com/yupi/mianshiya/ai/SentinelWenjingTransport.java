package com.yupi.mianshiya.ai;

import com.alibaba.csp.sentinel.Entry;
import com.alibaba.csp.sentinel.EntryType;
import com.alibaba.csp.sentinel.SphU;
import com.alibaba.csp.sentinel.Tracer;
import com.alibaba.csp.sentinel.slots.block.BlockException;
import com.alibaba.csp.sentinel.slots.block.RuleConstant;
import com.alibaba.csp.sentinel.slots.block.degrade.DegradeException;
import com.alibaba.csp.sentinel.slots.block.degrade.DegradeRule;
import com.alibaba.csp.sentinel.slots.block.degrade.DegradeRuleManager;
import com.alibaba.csp.sentinel.slots.block.flow.FlowRule;
import com.alibaba.csp.sentinel.slots.block.flow.FlowRuleManager;
import org.springframework.beans.factory.InitializingBean;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.context.annotation.Primary;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * 参考 Sentinel 官方 FlowThreadDemo / ExceptionRatioCircuitBreakerDemo。
 * 保护实际同步调用，不按 sessionId 建资源，避免高基数；不自动重试写操作。
 */
@Component
@Primary
public class SentinelWenjingTransport implements WenjingTransport, InitializingBean {
    static final String PREFIX = "ai:wenjing:";
    private final WenjingTransport delegate;
    private final WenjingProtectionProperties properties;

    public SentinelWenjingTransport(
            @Qualifier("loadBalancedWenjingTransport") WenjingTransport delegate,
            WenjingProtectionProperties properties) {
        this.delegate = delegate;
        this.properties = properties;
    }

    @Override
    public void afterPropertiesSet() {
        if (!properties.isEnabled()) {
            return;
        }
        if (properties.getPollConcurrency() <= 0 || properties.getReadConcurrency() <= 0
                || properties.getWriteConcurrency() <= 0 || properties.getSetupConcurrency() <= 0
                || !Double.isFinite(properties.getErrorRatio()) || properties.getErrorRatio() <= 0
                || properties.getErrorRatio() >= 1 || properties.getMinRequests() <= 0
                || properties.getStatIntervalMs() <= 0 || properties.getOpenSeconds() <= 0) {
            throw new IllegalArgumentException("Invalid ai.service.protection settings");
        }
        // loadRules 会替换全量规则，必须保留题库等已有资源的规则。
        List<FlowRule> flows = new ArrayList<>(FlowRuleManager.getRules());
        flows.removeIf(rule -> rule.getResource().startsWith(PREFIX));
        List<DegradeRule> breakers = new ArrayList<>(DegradeRuleManager.getRules());
        breakers.removeIf(rule -> rule.getResource().startsWith(PREFIX));
        String[] groups = {"poll", "read", "write", "setup"};
        int[] limits = {properties.getPollConcurrency(), properties.getReadConcurrency(),
                properties.getWriteConcurrency(), properties.getSetupConcurrency()};
        for (int i = 0; i < groups.length; i++) {
            String resource = PREFIX + groups[i];
            FlowRule flow = new FlowRule(resource);
            flow.setGrade(RuleConstant.FLOW_GRADE_THREAD);
            flow.setCount(limits[i]);
            flows.add(flow);
            // 不设置慢调用熔断：正常长轮询可能等待 30～60 秒。
            breakers.add(new DegradeRule(resource)
                    .setGrade(RuleConstant.DEGRADE_GRADE_EXCEPTION_RATIO)
                    .setCount(properties.getErrorRatio())
                    .setMinRequestAmount(properties.getMinRequests())
                    .setStatIntervalMs(properties.getStatIntervalMs())
                    .setTimeWindow(properties.getOpenSeconds()));
        }
        FlowRuleManager.loadRules(flows);
        DegradeRuleManager.loadRules(breakers);
    }

    @Override
    public Reply exchange(String method, String pathAndQuery, Map<String, String> headers, byte[] body)
            throws IOException {
        if (!properties.isEnabled()) {
            return delegate.exchange(method, pathAndQuery, headers, body);
        }
        Entry entry;
        try {
            entry = SphU.entry(resourceFor(method, pathAndQuery), EntryType.OUT);
        } catch (BlockException blocked) {
            // 本地拦截不是 Python 调用异常，不能计入熔断失败数。
            throw new WenjingBlockedException(blocked instanceof DegradeException, blocked);
        }
        try {
            Reply reply = delegate.exchange(method, pathAndQuery, headers, body);
            if (reply.getStatus() >= 500 && reply.getStatus() <= 599) {
                // HTTP 客户端将 5xx 作为响应返回，必须手动记录；仍保留原状态码和正文。
                Tracer.traceEntry(new IOException("Python HTTP " + reply.getStatus()), entry);
            }
            // 4xx（包括共享限流的 429）仍原样透传，不作为依赖故障。
            return reply;
        } catch (IOException | RuntimeException failure) {
            Tracer.traceEntry(failure, entry);
            throw failure;
        } finally {
            entry.exit();
        }
    }

    static String resourceFor(String method, String pathAndQuery) {
        String path = pathAndQuery.split("\\?", 2)[0];
        if ("GET".equals(method) && path.startsWith("interview/sessions/") && path.endsWith("/question")) {
            return PREFIX + "poll";
        }
        if (path.startsWith("interview/resume/") || path.startsWith("interview/jd/")) {
            return PREFIX + "setup";
        }
        return PREFIX + ("GET".equals(method) ? "read" : "write");
    }
}

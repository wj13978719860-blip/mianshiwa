package com.yupi.mianshiya.ai;

import lombok.extern.slf4j.Slf4j;
import org.slf4j.MDC;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;
import javax.servlet.FilterChain;
import javax.servlet.ServletException;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.UUID;

/**
 * 在控制器及权限校验之前生成请求 UUID，方便关联 Java/Python 两端日志。
 * 只处理新增探测路径；即使未登录或参数错误，响应也带 X-Request-Id。
 */
@Slf4j
@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 10)
public class AiRequestIdFilter extends OncePerRequestFilter {
    public static final String ATTRIBUTE = "aiRequestId";

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        // 去掉 /api 等 context-path 后比较路径，不干扰项目原有接口。
        String path = request.getRequestURI().substring(request.getContextPath().length());
        return !"/ai/service/probe".equals(path) && !"/ai/service/model/probe".equals(path)
                && !path.startsWith("/ai/interviews") && !path.startsWith("/ai/wenjing/");
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        // 不信任浏览器传入的请求标识，由本后端重新生成。
        String id = UUID.randomUUID().toString();
        // MDC 是当前线程的日志上下文；Servlet 线程会复用，因此退出时必须恢复原值。
        String previous = MDC.get("requestId");
        // request attribute 供控制器取值，响应头供调用者排查，MDC 供日志扩展使用。
        request.setAttribute(ATTRIBUTE, id);
        response.setHeader("X-Request-Id", id);
        MDC.put("requestId", id);
        long start = System.nanoTime();
        try {
            chain.doFilter(request, response);
        } finally {
            // 成功或抛异常都记录耗时；此处 status 是 HTTP 状态，业务码还需查看响应正文。
            log.info("AI probe requestId={} status={} elapsedMs={}", id, response.getStatus(),
                    (System.nanoTime() - start) / 1_000_000);
            if (previous == null) { MDC.remove("requestId"); } else { MDC.put("requestId", previous); }
        }
    }
}

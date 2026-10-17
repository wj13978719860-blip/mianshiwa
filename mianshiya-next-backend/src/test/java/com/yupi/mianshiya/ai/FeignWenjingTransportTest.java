package com.yupi.mianshiya.ai;

import feign.Client;
import feign.Feign;
import feign.Request;
import feign.Response;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.cloud.openfeign.support.SpringMvcContract;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.net.SocketTimeoutException;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

/** 真正执行 Feign + Spring MVC Contract + 编码器，仅替换网络 Client，避免依赖外部服务。 */
class FeignWenjingTransportTest {
    private final AtomicReference<Request> sent = new AtomicReference<>();
    private final AtomicReference<Request.Options> options = new AtomicReference<>();
    private final AtomicInteger calls = new AtomicInteger();
    private final AiServiceProperties properties = new AiServiceProperties();

    @SuppressWarnings("unchecked")
    private FeignWenjingTransport transport(Client network) {
        properties.setToken("test-internal");
        WenjingFeignConfiguration config = new WenjingFeignConfiguration();
        WenjingFeignClient client = Feign.builder()
                .contract(new SpringMvcContract())
                .encoder(config.wenjingBodyEncoder())
                .options(config.aiOptions(properties))
                .retryer(config.aiRetryer())
                .requestInterceptor(config.aiCredential(properties))
                .client((request, requestOptions) -> {
                    sent.set(request);
                    options.set(requestOptions);
                    calls.incrementAndGet();
                    return network.execute(request, requestOptions);
                })
                .target(WenjingFeignClient.class, "http://mianshiya-ai-service");
        ObjectProvider<WenjingFeignClient> provider = mock(ObjectProvider.class);
        when(provider.getIfAvailable()).thenReturn(client);
        return new FeignWenjingTransport(provider);
    }

    private FeignWenjingTransport returning(int status, byte[] body) {
        return transport((request, ignored) -> Response.builder().request(request).status(status).reason("test")
                .headers(Collections.singletonMap("Content-Type", Collections.singletonList("application/json")))
                .body(body).build());
    }

    private Map<String, String> headers(String contentType) {
        Map<String, String> headers = new LinkedHashMap<>();
        headers.put("X-Owner-Id", "9007199254740993");
        headers.put("X-Request-Id", "request-123");
        headers.put("Idempotency-Key", "answer-1");
        if (contentType != null) headers.put("Content-Type", contentType);
        return headers;
    }

    @Test
    void preservesPathsQueriesOwnerAndRawBusinessErrors() throws Exception {
        byte[] body = "{\"detail\":\"wrong turn\"}".getBytes(StandardCharsets.UTF_8);
        WenjingTransport.Reply reply = returning(409, body).exchange("GET",
                "interview/sessions/sess-1/question?timeout=30", headers(null), null);
        assertEquals(409, reply.getStatus());
        assertArrayEquals(body, reply.getBody());
        assertEquals("application/json", reply.getContentType());
        assertEquals("http://mianshiya-ai-service/internal/wenjing/api/v1/interview/sessions/sess-1/question?timeout=30",
                sent.get().url());
        assertEquals(Collections.singletonList("9007199254740993"), new ArrayList<>(sent.get().headers().get("X-Owner-Id")));
        assertEquals(Collections.singletonList("test-internal"), new ArrayList<>(sent.get().headers().get("X-AI-Service-Token")));
    }

    @Test
    void sendsJsonAsOriginalBytesAndRetainsIdempotencyKey() throws Exception {
        byte[] body = "{\"answer\":\"先查日志\",\"turn_idx\":1}".getBytes(StandardCharsets.UTF_8);
        returning(200, new byte[0]).exchange("POST", "interview/sessions/sess-1/answer", headers("application/json"), body);
        assertArrayEquals(body, sent.get().body());
        assertEquals(Request.HttpMethod.POST, sent.get().httpMethod());
        assertEquals(Collections.singletonList("answer-1"), new ArrayList<>(sent.get().headers().get("Idempotency-Key")));
        assertEquals(2000, options.get().connectTimeoutMillis());
        assertEquals(130000, options.get().readTimeoutMillis());
        assertFalse(options.get().isFollowRedirects());
    }

    @Test
    void preservesMultipartBoundaryAndBinaryBytes() throws Exception {
        byte[] body = new byte[]{45,45,97,13,10,0,(byte)255,13,10,45,45,97,45,45};
        returning(200, new byte[0]).exchange("POST", "interview/jd/extract",
                headers("multipart/form-data; boundary=a"), body);
        assertArrayEquals(body, sent.get().body());
        assertEquals(Collections.singletonList("multipart/form-data; boundary=a"),
                new ArrayList<>(sent.get().headers().get("Content-Type")));
    }

    @Test
    void keeps5xxAvailableForSentinelInsteadOfFeignErrorDecoding() throws Exception {
        byte[] body = "{\"detail\":\"unavailable\"}".getBytes(StandardCharsets.UTF_8);
        WenjingTransport.Reply reply = returning(503, body).exchange("GET", "interview/directions", headers(null), null);
        assertEquals(503, reply.getStatus());
        assertArrayEquals(body, reply.getBody());
        assertEquals(1, calls.get());
    }

    @Test
    void communicationTimeoutDoesNotReplayAnswer() {
        FeignWenjingTransport transport = transport((request, ignored) -> { throw new SocketTimeoutException("slow"); });
        assertThrows(IOException.class, () -> transport.exchange("POST", "interview/sessions/sess-1/answer",
                headers("application/json"), "{}".getBytes(StandardCharsets.UTF_8)));
        assertEquals(1, calls.get());
    }

    @Test
    void supportsDeleteWithoutRequestBody() throws Exception {
        returning(204, new byte[0]).exchange("DELETE", "interview/sessions/sess-1", headers(null), null);
        assertEquals(Request.HttpMethod.DELETE, sent.get().httpMethod());
    }

    @Test
    void refusesOversizedResponseAndClosesItsStream() {
        AtomicInteger closed = new AtomicInteger();
        FeignWenjingTransport transport = transport((request, ignored) -> Response.builder().request(request)
                .status(200).reason("OK").headers(Collections.emptyMap())
                .body(new ByteArrayInputStream(new byte[8 * 1024 * 1024 + 1]) {
                    @Override public void close() { closed.incrementAndGet(); }
                }, 8 * 1024 * 1024 + 1).build());
        assertThrows(IOException.class, () -> transport.exchange("GET", "interview/dimensions", headers(null), null));
        assertTrue(closed.get() > 0);
    }

    @Test
    void rejectsForeignUrlsAndUnsupportedUploadMethodsBeforeSending() {
        FeignWenjingTransport transport = returning(200, new byte[0]);
        assertThrows(IOException.class, () -> transport.exchange("GET", "http://evil.example/a", headers(null), null));
        assertThrows(IOException.class, () -> transport.exchange("DELETE", "interview/jd/extract", headers(null), null));
        assertEquals(0, calls.get());
    }

    @Test
    @SuppressWarnings("unchecked")
    void missingDisabledFeignClientFailsWithoutPreventingConstruction() {
        ObjectProvider<WenjingFeignClient> provider = mock(ObjectProvider.class);
        FeignWenjingTransport transport = new FeignWenjingTransport(provider);
        assertThrows(IOException.class, () -> transport.exchange("GET", "interview/dimensions", headers(null), null));
    }
}

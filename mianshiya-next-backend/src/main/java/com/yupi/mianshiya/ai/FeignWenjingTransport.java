package com.yupi.mianshiya.ai;

import feign.FeignException;
import feign.Response;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Component;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.URLDecoder;
import java.util.*;

/** 保留现有 Transport 契约，HTTP 请求构造、负载均衡与发送交由 OpenFeign。 */
@Component
public class FeignWenjingTransport implements WenjingTransport {
    private static final int MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
    private final ObjectProvider<WenjingFeignClient> clients;

    public FeignWenjingTransport(ObjectProvider<WenjingFeignClient> clients) {
        // AI 关闭时没有 Feign Bean，保持非 AI 业务可以正常启动。
        this.clients = clients;
    }

    @Override
    public Reply exchange(String method, String pathAndQuery, Map<String, String> headers, byte[] body)
            throws IOException {
        String[] parts = pathAndQuery.split("\\?", 2);
        // 适配层也校验路径，禁止通过绝对 URL、路径穿越或非法方法绕过白名单。
        if (!WenjingRoutes.allowed(method, parts[0])
                && !("POST".equals(method) && WenjingRoutes.UPLOADS.contains(parts[0]))) {
            throw new IOException("Unsupported Wenjing route");
        }
        if (parts.length == 2 && !WenjingRoutes.validQuery(parts[1])) {
            throw new IOException("Invalid Wenjing query");
        }
        WenjingFeignClient client = clients.getIfAvailable();
        if (client == null) {
            throw new IOException("AI Feign client unavailable");
        }
        Map<String, Collection<String>> query = new LinkedHashMap<>();
        if (parts.length == 2 && !parts[1].isEmpty()) {
            for (String pair : parts[1].split("&")) {
                String[] kv = pair.split("=", 2);
                String key = URLDecoder.decode(kv[0], "UTF-8");
                String value = kv.length == 2 ? URLDecoder.decode(kv[1], "UTF-8") : "";
                query.computeIfAbsent(key, ignored -> new ArrayList<>()).add(value);
            }
        }
        try (Response response = invoke(client, method, parts[0], query, headers, body)) {
            String contentType = response.headers().entrySet().stream()
                    .filter(entry -> "content-type".equalsIgnoreCase(entry.getKey()))
                    .flatMap(entry -> entry.getValue().stream()).findFirst().orElse(null);
            return new Reply(response.status(), contentType, read(response));
        } catch (FeignException failure) {
            // 与旧实现保持一致：传输故障由外层 Sentinel 统计，控制器返回 502。
            throw new IOException("AI Feign request failed", failure);
        }
    }

    private Response invoke(WenjingFeignClient client, String method, String path,
                            Map<String, Collection<String>> query, Map<String, String> headers, byte[] body)
            throws IOException {
        switch (method) {
            case "GET": return client.get(path, query, headers);
            case "POST": return client.post(path, query, headers, body == null ? new byte[0] : body);
            case "DELETE": return client.delete(path, query, headers);
            default: throw new IOException("Unsupported Wenjing method");
        }
    }

    private byte[] read(Response response) throws IOException {
        if (response.body() == null) {
            return new byte[0];
        }
        try (InputStream input = response.body().asInputStream()) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buffer = new byte[8192];
            int count;
            while ((count = input.read(buffer)) != -1) {
                if (out.size() + count > MAX_RESPONSE_BYTES) {
                    throw new IOException("Wenjing response too large");
                }
                out.write(buffer, 0, count);
            }
            return out.toByteArray();
        }
    }
}

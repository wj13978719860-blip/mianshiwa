package com.yupi.mianshiya.ai;

import org.springframework.beans.factory.ObjectProvider;
import org.springframework.cloud.client.ServiceInstance;
import org.springframework.cloud.client.loadbalancer.LoadBalancerClient;
import org.springframework.stereotype.Component;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Map;

/** 通过 Nacos 选出 AI 服务实例后直连 HTTP；不跟随重定向，响应体有上限。 */
@Component
public class LoadBalancedWenjingTransport implements WenjingTransport {
    static final String MOUNT = "/internal/wenjing/api/v1/";
    private static final int MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
    private final AiServiceProperties properties;
    private final ObjectProvider<LoadBalancerClient> balancers;

    public LoadBalancedWenjingTransport(AiServiceProperties properties, ObjectProvider<LoadBalancerClient> balancers) {
        this.properties = properties;
        this.balancers = balancers;
    }

    @Override
    public Reply exchange(String method, String pathAndQuery, Map<String, String> headers, byte[] body) throws IOException {
        LoadBalancerClient balancer = balancers.getIfAvailable();
        ServiceInstance instance = balancer == null ? null : balancer.choose(properties.getName());
        if (instance == null) {
            throw new IOException("AI service instance unavailable");
        }
        URL url = new URL(instance.getUri().toString().replaceAll("/+$", "") + MOUNT + pathAndQuery);
        HttpURLConnection connection = (HttpURLConnection) url.openConnection();
        try {
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(properties.getConnectTimeoutMs());
            connection.setReadTimeout(properties.getWenjingReadTimeoutMs());
            connection.setRequestMethod(method);
            connection.setUseCaches(false);
            headers.forEach(connection::setRequestProperty);
            if (body != null && body.length > 0) {
                connection.setDoOutput(true);
                connection.setFixedLengthStreamingMode(body.length);
                try (OutputStream out = connection.getOutputStream()) {
                    out.write(body);
                }
            }
            int status = connection.getResponseCode();
            InputStream stream = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
            return new Reply(status, connection.getContentType(), read(stream));
        } finally {
            connection.disconnect();
        }
    }

    private static byte[] read(InputStream stream) throws IOException {
        if (stream == null) {
            return new byte[0];
        }
        try (InputStream input = stream) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buffer = new byte[8192];
            int read;
            while ((read = input.read(buffer)) != -1) {
                if (out.size() + read > MAX_RESPONSE_BYTES) {
                    throw new IOException("Wenjing response too large");
                }
                out.write(buffer, 0, read);
            }
            return out.toByteArray();
        }
    }
}

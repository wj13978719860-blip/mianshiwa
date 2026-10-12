package com.yupi.mianshiya.ai;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;

/** 模型响应契约：检查完整 JSON、请求标识、服务名、模型模式和非空文本。 */
public final class AiModelContract {
    private AiModelContract() { }

    public static JsonNode parseResponse(ObjectMapper mapper, byte[] body, String id, String service)
            throws IOException {
        JsonNode node = mapper.reader().with(DeserializationFeature.FAIL_ON_TRAILING_TOKENS).readTree(body);
        if (node == null || !node.isObject() || !id.equals(text(node, "requestId"))
                || !service.equals(text(node, "service")) || !"model".equals(text(node, "mode"))
                || text(node, "model").trim().isEmpty() || text(node, "reply").trim().isEmpty()
                || text(node, "reply").length() > 32768) {
            throw new IOException("Invalid model response");
        }
        return node;
    }

    private static String text(JsonNode node, String key) {
        return node.has(key) && node.get(key).isTextual() ? node.get(key).textValue() : "";
    }
}

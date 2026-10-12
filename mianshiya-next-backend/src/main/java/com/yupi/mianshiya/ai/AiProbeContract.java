package com.yupi.mianshiya.ai;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.DeserializationFeature;
import java.io.IOException;

/** Java 与 Python 之间的探测接口契约：集中校验请求和响应，防止两端理解不一致。 */
public final class AiProbeContract {
    private AiProbeContract() { }

    /** 请求必须是只有一个 message 字段的 JSON 对象；不合法时由控制器转为 40000。 */
    public static String parseMessage(ObjectMapper mapper, String body) throws IOException {
        // 禁止尾随第二段 JSON，例如 {"message":"hello"} {}，使 Java 与 Python 校验一致。
        JsonNode node = body == null ? null : mapper.reader()
                .with(DeserializationFeature.FAIL_ON_TRAILING_TOKENS).readTree(body);
        if (node == null || !node.isObject() || node.size() != 1 || !node.has("message")
                || !node.get("message").isTextual()) {
            throw new IOException("Invalid probe body");
        }
        String text = node.get("message").textValue();
        // 用 Unicode 码点统计字符：一个蛙 Emoji 在 Java 中占两个 char，但在此只算一个字符。
        // 同时覆盖普通空格、特殊空白与 U+0085，尽量与 Python 的 strip() 保持一致。
        boolean blank = text.codePoints().allMatch(cp -> Character.isWhitespace(cp) || Character.isSpaceChar(cp)
                || cp == 0x85);
        if (blank || text.codePointCount(0, text.length()) > 256) {
            throw new IOException("Invalid probe message");
        }
        return text;
    }

    /** 严格解析整个响应正文，再校验字段；禁止合法 JSON 后追加乱码或第二个 JSON 对象。 */
    public static JsonNode parseResponse(ObjectMapper mapper, byte[] body, String requestId, String service)
            throws IOException {
        JsonNode node = mapper.reader().with(DeserializationFeature.FAIL_ON_TRAILING_TOKENS).readTree(body);
        validateResponse(node, requestId, service);
        return node;
    }

    /** HTTP 200 也必须校验业务正文，尤其是请求标识、服务名和 stub 模式。 */
    public static void validateResponse(JsonNode node, String requestId, String service) throws IOException {
        if (node == null || !node.isObject() || !requestId.equals(text(node, "requestId"))
                || !service.equals(text(node, "service")) || !"stub".equals(text(node, "mode"))
                || text(node, "version").isEmpty() || text(node, "reply").isEmpty()) {
            throw new IOException("AI response does not match contract");
        }
    }

    // 不把数字等字段自动转为字符串，类型错误也应视为协议错误。
    private static String text(JsonNode node, String key) {
        return node.has(key) && node.get(key).isTextual() ? node.get(key).textValue() : "";
    }
}

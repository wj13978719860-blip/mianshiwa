package com.yupi.mianshiya.ai;

import com.fasterxml.jackson.databind.ObjectMapper;
import feign.Request;
import org.junit.jupiter.api.Test;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import static org.junit.jupiter.api.Assertions.*;

/** 验证模型与快速探测的契约/超时隔离，避免真实生成被 3 秒预算误伤。 */
class AiModelContractTest {
    @Test
    void validatesModelResponseAndRejectsTrailingOrStub() throws Exception {
        ObjectMapper mapper = new ObjectMapper();
        String body = "{\"requestId\":\"id\",\"service\":\"service\",\"mode\":\"model\",\"model\":\"deepseek-flash\",\"reply\":\"答案\"}";
        assertEquals("答案", AiModelContract.parseResponse(mapper, body.getBytes(StandardCharsets.UTF_8), "id", "service").get("reply").textValue());
        for (String invalid : new String[]{body + " {}", body.replace("\"model\",", "\"stub\","),
                body.replace("答案", " "), body.replace("\"id\"", "\"other\"")}) {
            assertThrows(IOException.class, () -> AiModelContract.parseResponse(mapper, invalid.getBytes(StandardCharsets.UTF_8), "id", "service"));
        }
    }

    @Test
    void keepsSeparateTimeoutsAndDisablesRedirects() {
        AiServiceProperties properties = new AiServiceProperties();
        Request.Options probe = new AiClientConfiguration().aiOptions(properties);
        Request.Options model = new AiModelClientConfiguration().aiOptions(properties);
        assertEquals(3000, probe.readTimeoutMillis());
        assertEquals(40000, model.readTimeoutMillis());
        assertFalse(model.isFollowRedirects());
    }
}

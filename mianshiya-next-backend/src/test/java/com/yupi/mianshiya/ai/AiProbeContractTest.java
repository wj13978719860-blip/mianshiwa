package com.yupi.mianshiya.ai;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.yupi.mianshiya.controller.AiServiceController;
import com.yupi.mianshiya.exception.BusinessException;
import feign.Request;
import feign.Response;
import org.springframework.beans.factory.support.DefaultListableBeanFactory;
import org.junit.jupiter.api.Test;
import javax.servlet.http.HttpServletRequest;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;

/** 契约回归测试：校验 JSON/字符规则与控制器错误映射，不启动 Spring、不访问 Python/Nacos。 */
class AiProbeContractTest {
    private final ObjectMapper mapper = new ObjectMapper();

    @Test
    void rejectsInvalidBodiesBeforeRemoteCall() {
        // 验证空正文、非法 JSON、错误字段/类型、空白和尾随 JSON 均被拒绝。
        for (String body : new String[]{null, "{", "{}", "{\"message\":1}",
                "{\"message\":\" \"}", "{\"message\":\"ok\",\"extra\":1}", "{\"message\":\"ok\"} {}"}) {
            assertThrows(IOException.class, () -> AiProbeContract.parseMessage(mapper, body));
        }
    }

    @Test
    void countsUnicodeCodePointsRatherThanUtf16Units() throws Exception {
        // 蛙 Emoji 是一对 UTF-16 代理字符；仍应按一个字符计入 256 字符上限。
        String text = String.join("", Collections.nCopies(256, "\uD83D\uDC38"));
        assertEquals(text, AiProbeContract.parseMessage(mapper, mapper.writeValueAsString(Collections.singletonMap("message", text))));
        assertThrows(IOException.class, () -> AiProbeContract.parseMessage(mapper,
                mapper.writeValueAsString(Collections.singletonMap("message", text + "x"))));
    }

    @Test
    void rejectsForgedOrIncompleteResponses() throws Exception {
        // 服务响应的标识错误或字段缺失时，不能当作成功结果返回给用户。
        assertThrows(IOException.class, () -> AiProbeContract.validateResponse(mapper.readTree(
                "{\"requestId\":\"other\",\"service\":\"mianshiya-ai-service\",\"mode\":\"stub\"}"), "expected", "mianshiya-ai-service"));
    }

    @Test
    void controllerRejectsTrailingContentInSuccessfulResponses() {
        // 模拟 Feign 的 HTTP 200 响应，直接验证控制器不会将错误正文包装成 code=0。
        String id = "8876aa32-3555-44f3-8052-3818e2453b2b";
        String valid = "{\"requestId\":\"" + id + "\",\"service\":\"mianshiya-ai-service\","
                + "\"version\":\"0.1.0\",\"mode\":\"stub\",\"reply\":\"ok\"}";
        AiServiceProperties properties = new AiServiceProperties();
        properties.setEnabled(true);
        AiServiceClient client = mock(AiServiceClient.class);
        DefaultListableBeanFactory factory = new DefaultListableBeanFactory();
        factory.registerSingleton("aiServiceClient", client);
        AiServiceController controller = new AiServiceController(properties,
                factory.getBeanProvider(AiServiceClient.class), mapper);
        HttpServletRequest request = mock(HttpServletRequest.class);
        when(request.getAttribute(AiRequestIdFilter.ATTRIBUTE)).thenReturn(id);

        for (String suffix : new String[]{"", " \r\n", " {}", " THIS IS NOT JSON"}) {
            Response response = Response.builder().status(200).reason("OK")
                    .request(Request.create(Request.HttpMethod.POST, "http://test/internal/v1/probe",
                            Collections.emptyMap(), new byte[0], StandardCharsets.UTF_8, null))
                    .headers(Collections.singletonMap("X-Request-Id", Collections.singletonList(id)))
                    .body(valid + suffix, StandardCharsets.UTF_8).build();
            when(client.probe(eq(id), anyMap())).thenReturn(response);
            if (suffix.trim().isEmpty()) {
                // 合法 JSON 后的普通空白允许存在，避免严格解析误伤正常响应。
                assertEquals(0, controller.probe("{\"message\":\"hello\"}", request).getCode());
            } else {
                BusinessException error = assertThrows(BusinessException.class,
                        () -> controller.probe("{\"message\":\"hello\"}", request));
                assertEquals(50001, error.getCode());
            }
        }
    }
}

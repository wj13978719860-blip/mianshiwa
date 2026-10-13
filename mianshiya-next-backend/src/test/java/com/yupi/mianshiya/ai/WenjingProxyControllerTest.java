package com.yupi.mianshiya.ai;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.yupi.mianshiya.controller.WenjingProxyController;
import com.yupi.mianshiya.model.entity.User;
import com.yupi.mianshiya.service.UserService;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.http.ResponseEntity;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockMultipartFile;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** 网关透传契约：白名单、身份注入、llm_config 拒绝、multipart 重组，不启动 Spring。 */
class WenjingProxyControllerTest {
    private final String id = "8876aa32-3555-44f3-8052-3818e2453b2b";
    private final ObjectMapper mapper = new ObjectMapper();
    private final WenjingTransport transport = mock(WenjingTransport.class);
    private final UserService users = mock(UserService.class);

    private WenjingProxyController controller(boolean loggedIn) {
        AiServiceProperties properties = new AiServiceProperties();
        properties.setEnabled(true);
        properties.setToken("internal-secret");
        if (loggedIn) {
            User owner = new User();
            owner.setId(9007199254740993L);
            when(users.getLoginUserPermitNull(any())).thenReturn(owner);
        }
        return new WenjingProxyController(properties, transport, users, mapper);
    }

    private MockHttpServletRequest request(String method, String path) {
        MockHttpServletRequest request = new MockHttpServletRequest(method, "/api/ai/wenjing/api/v1/" + path);
        request.setContextPath("/api");
        request.setAttribute(AiRequestIdFilter.ATTRIBUTE, id);
        return request;
    }

    @SuppressWarnings("unchecked")
    private Map<String, String> sentHeaders() throws Exception {
        ArgumentCaptor<Map<String, String>> headers = ArgumentCaptor.forClass(Map.class);
        verify(transport).exchange(anyString(), anyString(), headers.capture(), any());
        return headers.getValue();
    }

    @Test
    void forwardsWhitelistedCallWithServerSideOwnerAndUpstreamStatus() throws Exception {
        when(transport.exchange(eq("GET"), eq("interview/sessions/sess-1/question?timeout=30"), anyMap(), any()))
                .thenReturn(new WenjingTransport.Reply(403, "application/json", "{\"detail\":\"session owner required\"}"
                        .getBytes(StandardCharsets.UTF_8)));
        MockHttpServletRequest request = request("GET", "interview/sessions/sess-1/question");
        request.setQueryString("timeout=30");
        request.addHeader("X-Owner-Id", "1");

        ResponseEntity<byte[]> response = controller(true).proxy(request, null);

        assertEquals(403, response.getStatusCodeValue());
        Map<String, String> headers = sentHeaders();
        assertEquals("9007199254740993", headers.get("X-Owner-Id"));
        assertEquals("internal-secret", headers.get("X-AI-Service-Token"));
        assertEquals(id, headers.get("X-Request-Id"));
    }

    @Test
    void rejectsRoutesOutsideWhitelistWithoutCallingPython() throws Exception {
        WenjingProxyController controller = controller(true);
        for (String[] call : new String[][]{{"POST", "auth/login"}, {"GET", "admin/sessions"},
                {"POST", "interview/sessions/sess-1/voice-ticket"}, {"GET", "interview/sessions/../admin"},
                {"GET", "account/credits"}}) {
            assertEquals(404, controller.proxy(request(call[0], call[1]), null).getStatusCodeValue());
        }
        verifyNoInteractions(transport);
    }

    @Test
    void requiresLoginAndRejectsCustomModelConfig() throws Exception {
        assertEquals(401, controller(false).proxy(request("GET", "account/interview-sessions"), null).getStatusCodeValue());
        MockHttpServletRequest create = request("POST", "interview/sessions");
        create.setContentType("application/json");
        byte[] body = "{\"llm_config\":{\"base_url\":\"http://169.254.169.254\"}}".getBytes(StandardCharsets.UTF_8);
        assertEquals(400, controller(true).proxy(create, body).getStatusCodeValue());
        verifyNoInteractions(transport);
    }

    @Test
    void rebuildsResumeUploadAsSingleFileMultipart() throws Exception {
        when(transport.exchange(eq("POST"), eq("interview/resume/parse-jobs"), anyMap(), any()))
                .thenReturn(new WenjingTransport.Reply(200, "application/json", "{}".getBytes(StandardCharsets.UTF_8)));
        MockMultipartFile file = new MockMultipartFile("file", "简历.pdf", "application/pdf", new byte[]{1, 2, 3});

        assertEquals(200, controller(true).upload(request("POST", "interview/resume/parse-jobs"), file).getStatusCodeValue());

        ArgumentCaptor<byte[]> body = ArgumentCaptor.forClass(byte[].class);
        verify(transport).exchange(eq("POST"), eq("interview/resume/parse-jobs"), anyMap(), body.capture());
        String text = new String(body.getValue(), StandardCharsets.UTF_8);
        assertTrue(text.contains("name=\"file\"; filename=\"简历.pdf\""));
        assertFalse(text.contains("llm_config"));
        assertEquals(415, controller(true).upload(request("POST", "interview/resume/parse-jobs"),
                new MockMultipartFile("file", "a.exe", "application/octet-stream", new byte[]{1})).getStatusCodeValue());
    }

    @Test
    void transportFailureBecomesBadGatewayWithRequestId() throws Exception {
        when(transport.exchange(anyString(), anyString(), anyMap(), any())).thenThrow(new java.io.IOException("down"));

        ResponseEntity<byte[]> response = controller(true).proxy(request("GET", "interview/dimensions"), null);

        assertEquals(502, response.getStatusCodeValue());
        assertTrue(new String(response.getBody(), StandardCharsets.UTF_8).contains(id));
    }
}

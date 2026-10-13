package com.yupi.mianshiya.ai;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.yupi.mianshiya.controller.AiInterviewController;
import com.yupi.mianshiya.exception.BusinessException;
import com.yupi.mianshiya.model.entity.User;
import com.yupi.mianshiya.service.*;
import feign.Request;
import feign.Response;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.support.DefaultListableBeanFactory;
import javax.servlet.http.HttpServletRequest;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

/** 身份与内部契约测试，不启动 Spring，不访问真实模型或数据库。 */
class AiInterviewControllerTest {
    private final String id = "8876aa32-3555-44f3-8052-3818e2453b2b";
    private final ObjectMapper mapper = new ObjectMapper();
    private final AiInterviewClient client = mock(AiInterviewClient.class);
    private final HttpServletRequest request = mock(HttpServletRequest.class);

    private AiInterviewController controller() {
        AiServiceProperties properties = new AiServiceProperties();
        properties.setEnabled(true);
        DefaultListableBeanFactory factory = new DefaultListableBeanFactory();
        factory.registerSingleton("interviewClient", client);
        UserService users = mock(UserService.class);
        User owner = new User();
        owner.setId(9007199254740993L);
        when(users.getLoginUser(request)).thenReturn(owner);
        when(request.getAttribute(AiRequestIdFilter.ATTRIBUTE)).thenReturn(id);
        return new AiInterviewController(properties, factory.getBeanProvider(AiInterviewClient.class), mapper,
                users, mock(QuestionService.class), mock(QuestionBankService.class), mock(QuestionBankQuestionService.class));
    }

    private Response response(String body, String header) {
        return Response.builder().status(200).reason("OK").request(Request.create(Request.HttpMethod.GET,
                "http://test/internal/v1/interviews", Collections.emptyMap(), new byte[0], StandardCharsets.UTF_8, null))
                .headers(Collections.singletonMap("X-Request-Id", Collections.singletonList(header)))
                .body(body, StandardCharsets.UTF_8).build();
    }

    @Test
    void historyUsesServerSideOwnerAsExactDecimalString() {
        when(client.list(id, "9007199254740993")).thenReturn(response("{\"requestId\":\"" + id + "\",\"data\":[]}", id));
        assertEquals(0, controller().history(request).getCode());
        verify(client).list(id, "9007199254740993");
    }

    @Test
    void browserCannotSupplyOwnerOrScoringQuestions() throws Exception {
        AiInterviewController controller = controller();
        for (String body : new String[]{"{\"ownerId\":\"2\"}", "{\"questions\":[]}"}) {
            assertThrows(BusinessException.class, () -> controller.create(mapper.readTree(body), request));
        }
        verifyNoInteractions(client);
    }

    @Test
    void rejectsTrailingJsonAndWrongCorrelation() {
        AiInterviewController controller = controller();
        String valid = "{\"requestId\":\"" + id + "\",\"data\":[]}";
        when(client.list(id, "9007199254740993")).thenReturn(response(valid + " {}", id));
        assertThrows(BusinessException.class, () -> controller.history(request));
        when(client.list(id, "9007199254740993")).thenReturn(response(valid, "other"));
        assertThrows(BusinessException.class, () -> controller.history(request));
    }

    @Test
    void setupTasksUseAuthenticatedOwnerAndRejectBrowserOwner() throws Exception {
        AiInterviewController controller = controller();
        assertThrows(BusinessException.class, () -> controller.setup(mapper.readTree("{\"ownerId\":\"2\"}"), request));
        when(client.setup(eq(id), anyMap())).thenAnswer(invocation -> {
            java.util.Map<String, Object> body = invocation.getArgument(1);
            assertEquals("9007199254740993", body.get("ownerId"));
            assertEquals("resume", body.get("kind"));
            return response("{\"requestId\":\"" + id + "\",\"data\":{\"status\":\"queued\"}}", id);
        });
        assertEquals(0, controller.setup(mapper.readTree("{\"commandId\":\"" + id +
            "\",\"kind\":\"resume\",\"directionId\":\"java_backend\",\"text\":\"Java 后端学习经历\"}"), request).getCode());
    }

    @Test
    void setupTaskQueryPreservesOwnerAndCorrelation() {
        when(client.setupJob(id, id, "9007199254740993")).thenReturn(response(
            "{\"requestId\":\"" + id + "\",\"data\":{\"status\":\"succeeded\"}}", id));
        assertEquals(0, controller().setupJob(id, request).getCode());
        verify(client).setupJob(id, id, "9007199254740993");
    }
}

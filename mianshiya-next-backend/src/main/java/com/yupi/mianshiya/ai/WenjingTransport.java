package com.yupi.mianshiya.ai;

import java.io.IOException;
import java.util.Map;

/** 调用 Python 问镜子应用（/internal/wenjing/api/v1/...）的传输层，便于单测替换。 */
public interface WenjingTransport {
    Reply exchange(String method, String pathAndQuery, Map<String, String> headers, byte[] body) throws IOException;

    final class Reply {
        private final int status;
        private final String contentType;
        private final byte[] body;

        public Reply(int status, String contentType, byte[] body) {
            this.status = status;
            this.contentType = contentType;
            this.body = body;
        }

        public int getStatus() { return status; }
        public String getContentType() { return contentType; }
        public byte[] getBody() { return body; }
    }
}

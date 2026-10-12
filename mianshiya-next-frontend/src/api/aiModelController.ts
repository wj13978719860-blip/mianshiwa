import request from "@/libs/request";

/** 模型回答的数据结构；供应商 Key 不出现在前端请求中。 */
export interface ModelAnswer {
  requestId: string;
  service: string;
  mode: "model";
  model: string;
  reply: string;
}

interface ModelResponse {
  code: number;
  data: ModelAnswer | null;
  message: string;
}

/** 沿用全局请求工具携带登录态；响应拦截器已解包，并处理业务错误。 */
export function askAiModel(message: string, signal: AbortSignal) {
  return request.post<ModelResponse, ModelResponse>(
    "/api/ai/service/model/probe",
    { message },
    // 比 Java 的 40 秒预算更长；页面离开时只取消浏览器等待，不承诺撤销供应商计费。
    { timeout: 45000, signal },
  );
}

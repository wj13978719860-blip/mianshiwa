/**
 * 问镜接口经 Java 网关转发：浏览器 -> {后端}/api/ai/wenjing/api/v1/** -> AI 服务。
 * 登录态沿用面试蛙的 Sa-Token Cookie，网关注入 X-Owner-Id 与内部 Token。
 * 后端地址与 src/libs/request.ts 保持一致，可用 NEXT_PUBLIC_WENJING_API_BASE 覆盖。
 */
export const API_BASE =
  (typeof process !== "undefined" && process.env.NEXT_PUBLIC_WENJING_API_BASE) ||
  "http://localhost:8101/api/ai/wenjing";

export function apiUrl(path: string): string {
  if (!path.startsWith("/")) path = "/" + path;
  return `${API_BASE}${path}`;
}

/** 网络失败、非 Error 异常均有可读提示，避免错误处理自身再次报错。 */
export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "请稍后重试";
}

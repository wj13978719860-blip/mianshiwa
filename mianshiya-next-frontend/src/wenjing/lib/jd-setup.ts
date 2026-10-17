/** 把所有影响岗位解析的输入纳入身份，防止迟到结果或旧确认用于新 JD。 */
export function jdContextKey(text: string, direction: string, title: string, level: string): string {
  return JSON.stringify([text.trim(), direction, title.trim(), level]);
}

/** 定向面试只允许使用当前输入的已确认解析；方向练习不要求 JD。 */
export function canStartWithJd(args: {
  targeted: boolean; uploading: boolean; status: string; confirmed: boolean;
  parsedKey: string | null; currentKey: string;
}): boolean {
  return !args.targeted || (!args.uploading && args.status === "success" && args.confirmed && args.parsedKey === args.currentKey);
}

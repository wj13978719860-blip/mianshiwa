/** 登录后只返回本站路径，拒绝外部网址和再次回到登录页的循环。 */
export function safeLoginRedirect(raw: string | null, origin: string): string {
  try {
    const target = new URL(raw || "/", origin);
    if (target.origin !== origin || target.pathname === "/user/login" || target.pathname.startsWith("/user/login/")) return "/";
    return target.pathname + target.search + target.hash;
  } catch { return "/"; }
}

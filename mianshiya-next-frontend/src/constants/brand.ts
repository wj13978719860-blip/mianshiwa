export const BRAND_NAME = "面试蛙";
export const BRAND_DESCRIPTION = "程序员面试刷题与 AI 模拟面试平台";
export const BRAND_LOGO = "/assets/logo.svg";

// Replace original seed images while keeping user-provided images.
const LEGACY_IMAGES = new Set([
  "/assets/logo.png",
  "/assets/notLoginUser.png",
  "https://www.code-nav.cn/logo.png",
  "https://www.mianshiya.com/logo.png",
  "https://mianshiya.com/logo.png",
  "https://pic.code-nav.cn/mianshiya/question_bank_picture/1777886594896760834/JldkWf9w_JavaScript.png",
  "https://pic.code-nav.cn/mianshiya/question_bank_picture/1777886594896760834/QatnFmEN_CSS.png",
]);

export function getBrandImage(src?: string) {
  return !src || LEGACY_IMAGES.has(src) ? BRAND_LOGO : src;
}

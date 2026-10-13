import store from "@/stores";

const PREFIX = "mianshiwa:interview:user:";
const LEGACY_KEYS = ["setupDrafts", "resume_draft", "lastSessionId", "interviewHistory"];

/** 只使用已确认的登录用户；未登录期间不读取、保存面试材料。 */
function ownerId(): string | null {
  const user = store.getState().loginUser;
  return user.id != null && user.userRole !== "notLogin" ? String(user.id) : null;
}

function nativeStorage(kind: "local" | "session"): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return kind === "local" ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

/** 删除指定前缀，不能清空浏览器中其他业务的数据。 */
function removePrefix(storage: Storage, prefix: string): void {
  for (let i = storage.length - 1; i >= 0; i -= 1) {
    const key = storage.key(i);
    if (key?.startsWith(prefix)) storage.removeItem(key);
  }
}

/** 旧草稿无归属，旧历史是 Python 影子用户 ID，不能冒认为 Java 当前账号。服务端历史会重新加载。 */
function cleanLegacy(storage: Storage): void {
  for (const key of LEGACY_KEYS) storage.removeItem(key);
  removePrefix(storage, "interviewSessionToken:");
}

/** Storage 外观保持不变，底层键带用户前缀，兼容问镜现有读写函数。 */
export function userStorage(kind: "local" | "session"): Storage | null {
  const owner = ownerId();
  const storage = nativeStorage(kind);
  if (!owner || !storage) return null;
  const prefix = `${PREFIX}${owner}:`;
  try {
    cleanLegacy(storage);
  } catch {
    return null;
  }
  const keys = () => Array.from({ length: storage.length }, (_, i) => storage.key(i))
    .filter((key): key is string => Boolean(key?.startsWith(prefix)));
  return {
    get length() { return keys().length; },
    key: (index) => keys()[index]?.slice(prefix.length) ?? null,
    getItem: (key) => storage.getItem(prefix + key),
    setItem: (key, value) => storage.setItem(prefix + key, value),
    removeItem: (key) => storage.removeItem(prefix + key),
    clear: () => removePrefix(storage, prefix),
  };
}

export function isInterviewStorageKey(key: string | null): boolean {
  return key === null || key.startsWith(PREFIX) || LEGACY_KEYS.includes(key);
}

/** 退出或切换账号立即清理上一个账号的本地材料；服务端记录保持完整。 */
if (typeof window !== "undefined") {
  let previousOwner = ownerId();
  store.subscribe(() => {
    const currentOwner = ownerId();
    if (previousOwner && previousOwner !== currentOwner) {
      for (const kind of ["local", "session"] as const) {
        try {
          const storage = nativeStorage(kind);
          if (storage) removePrefix(storage, `${PREFIX}${previousOwner}:`);
        } catch {
          // 禁用浏览器存储时仍允许退出登录。
        }
      }
    }
    previousOwner = currentOwner;
  });
}

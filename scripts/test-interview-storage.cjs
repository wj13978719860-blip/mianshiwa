/** 验证真实问镜存储入口：账号隔离、退出清理、旧数据及浏览器存储不可用。 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const root = path.resolve(__dirname, "../mianshiya-next-frontend");
const localRequire = createRequire(path.join(root, "package.json"));
const ts = localRequire("typescript");
const cache = new Map();
const apiCalls = [];
let user = { id: 101, userRole: "user" };
const listeners = [];
const store = { getState: () => ({ loginUser: user }), subscribe: (listener) => listeners.push(listener) };

function memoryStorage() {
  const values = new Map();
  return {
    get length() { return values.size; },
    key: (index) => [...values.keys()][index] ?? null,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    clear: () => values.clear(),
  };
}
global.window = { localStorage: memoryStorage(), sessionStorage: memoryStorage() };
function load(filename) {
  if (cache.has(filename)) return cache.get(filename).exports;
  const module = { exports: {} };
  cache.set(filename, module);
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017, esModuleInterop: true },
  });
  const requireModule = (name) => {
    if (name === "@/stores") return { __esModule: true, default: store };
    if (filename.endsWith(path.join("api", "interview.ts")) && name === "./client") {
      return { ApiError: class extends Error {}, request: (_url, options) => {
        apiCalls.push(options);
        return Promise.resolve({ session_id: "test-session", accepted: true });
      } };
    }
    if (name === "@/wenjing/lib/llm-config") return { buildLLMPayload: () => undefined };
    if (name.startsWith("@/")) return load(path.join(root, "src", name.slice(2) + ".ts"));
    if (name.startsWith(".")) return load(path.resolve(path.dirname(filename), name + ".ts"));
    return localRequire(name);
  };
  vm.runInThisContext(`(function(exports, require, module) {\n${outputText}\n})`, { filename })(module.exports, requireModule, module);
  return module.exports;
}
const storage = load(path.join(root, "src/wenjing/lib/storage/userStorage.ts"));
const drafts = load(path.join(root, "src/wenjing/lib/storage/setupDrafts.ts"));
const history = load(path.join(root, "src/wenjing/lib/storage/interviewHistory.ts"));
function changeUser(next) { user = next; listeners.forEach((listener) => listener()); }

window.localStorage.setItem("setupDrafts", JSON.stringify([{ filename: "其他用户简历" }]));
window.sessionStorage.setItem("resume_draft", "无归属的旧简历");
assert.deepEqual(drafts.getSetupDrafts(), []);
assert.equal(storage.userStorage("session").getItem("resume_draft"), null);
console.log("PASS 旧版无归属草稿不会迁给当前账号");

drafts.upsertSetupDraft({ draftId: "draft-a", jobId: "parse-a", filename: "A简历.pdf", status: "ready" });
storage.userStorage("session").setItem("resume_draft", "A简历");
history.writeSessionToken("session-a", "test-token", new Date(Date.now() + 60000).toISOString());
assert.equal(drafts.getSetupDrafts()[0].filename, "A简历.pdf");
assert.ok(window.localStorage.getItem("mianshiwa:interview:user:101:setupDrafts"));
console.log("PASS 实际草稿入口写入用户命名空间");

window.localStorage.setItem("unrelated-business", "保留");
changeUser({ id: 102, userRole: "user" });
assert.deepEqual(drafts.getSetupDrafts(), []);
assert.equal(storage.userStorage("session").getItem("resume_draft"), null);
assert.equal(window.localStorage.getItem("mianshiwa:interview:user:101:setupDrafts"), null);
assert.equal(window.sessionStorage.getItem("mianshiwa:interview:user:101:interviewSessionToken:session-a"), null);
assert.equal(window.localStorage.getItem("unrelated-business"), "保留");
console.log("PASS 切换账号清理旧材料、恢复令牌，不清其他业务缓存");

drafts.upsertSetupDraft({ draftId: "draft-b", jobId: "parse-b", filename: "B简历.pdf", status: "ready" });
changeUser({ userRole: "notLogin" });
assert.deepEqual(drafts.getSetupDrafts(), []);
assert.equal(storage.userStorage("local"), null);
assert.equal(window.localStorage.getItem("mianshiwa:interview:user:102:setupDrafts"), null);
console.log("PASS 退出登录清理当前材料，未登录不能写入");

changeUser({ id: 101, userRole: "user" });
Object.defineProperty(window, "localStorage", { get() { throw new Error("disabled"); } });
assert.deepEqual(drafts.getSetupDrafts(), []);
assert.deepEqual(history.getHistory(), []);
console.log("PASS 浏览器禁用存储仍能打开页面");
delete global.window;
assert.equal(storage.userStorage("session"), null);
console.log("PASS 服务端渲染不访问浏览器存储");

async function checkAnswerIdempotency() {
  const api = load(path.join(root, "src/wenjing/lib/api/interview.ts"));
  await api.submitAnswer("test-session", "相同回答", 2);
  await api.submitAnswer("test-session", "相同回答", 2);
  await api.submitAnswer("test-session", "改过的回答", 2);
  const keys = apiCalls.map((call) => call.headers["Idempotency-Key"]);
  assert.match(keys[0], /^[A-Za-z0-9_.~-]{8,128}$/);
  assert.equal(keys[0], keys[1]);
  assert.notEqual(keys[0], keys[2]);
  console.log("PASS 实际回答 API 生成合法稳定幂等键，修改回答使用新键");
}
checkAnswerIdempotency().catch((error) => { console.error(error); process.exitCode = 1; });

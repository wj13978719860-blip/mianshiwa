/** 面试对话记录回归：用现有 TypeScript 编译器加载纯函数，无需新增测试依赖。 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const { test } = require("node:test");

const frontendRoot = path.resolve(__dirname, "../mianshiya-next-frontend");
const frontendRequire = createRequire(path.join(frontendRoot, "package.json"));
const ts = frontendRequire("typescript");
const moduleCache = new Map();

function loadTypeScript(filename) {
  if (moduleCache.has(filename)) return moduleCache.get(filename).exports;
  const module = { exports: {} };
  moduleCache.set(filename, module);
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017 },
  });
  const localRequire = (name) => {
    if (name.startsWith("@/")) {
      return loadTypeScript(path.join(frontendRoot, "src", name.slice(2) + ".ts"));
    }
    return frontendRequire(name);
  };
  const execute = vm.runInThisContext(`(function(exports, require, module) {\n${outputText}\n})`, { filename });
  execute(module.exports, localRequire, module);
  return module.exports;
}

const { mergeRestoredQaHistory, recordQaAnswer, qaEntryIdentity, restoredTurnToQaEntry } =
  loadTypeScript(path.join(frontendRoot, "src/wenjing/components/room/helpers.ts"));

function entry(index, answer = `回答${index + 1}`) {
  return {
    turnIdx: index + 1,
    formalTurnIdx: index,
    displayTurnIdx: index,
    questionType: "technical",
    question: `原始第${index + 1}题`,
    answer,
    dimension: "technical_depth",
  };
}

for (const length of [3, 8]) {
  test(`回答到第${length}题后，旧恢复快照不能删除最新答案或改变此前题干`, () => {
    const local = Array.from({ length }, (_, i) => entry(i));
    const stale = local.slice(0, -1).map((row, i) => ({
      ...row, turnIdx: i, question: "错误重复的旧题干", answer: "旧答案",
    }));
    const merged = mergeRestoredQaHistory(local, stale);
    assert.equal(merged.length, length);
    assert.deepEqual(merged.map((row) => row.question), local.map((row) => row.question));
    assert.deepEqual(merged.map((row) => row.answer), local.map((row) => row.answer));
  });
}

test("恢复记录按正式轮次合并，补评分时不重复追加传输轮次不同的同一题", () => {
  const local = entry(0);
  const evaluation = { turn_idx: 0, dimension: "technical_depth", score: 4, passed: true, strengths: [], weaknesses: [] };
  const restored = { ...entry(0), turnIdx: 0, evaluation };
  const merged = mergeRestoredQaHistory([local], [restored]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].turnIdx, 1);
  assert.equal(merged[0].evaluation, evaluation);
  assert.equal(qaEntryIdentity(local), qaEntryIdentity(restored));
});

test("刷新后可完整恢复八个不同问答，开场与第一题身份独立", () => {
  const restored = [
    restoredTurnToQaEntry({ turn_idx: 0, question_type: "self_intro", question: "自我介绍", answer: "开场回答" }),
    ...Array.from({ length: 8 }, (_, i) => restoredTurnToQaEntry({ turn_idx: i, question_type: "technical", question: `题${i + 1}`, answer: `答${i + 1}` })),
  ];
  const merged = mergeRestoredQaHistory([], restored);
  assert.equal(merged.length, 9);
  assert.equal(new Set(merged.map(qaEntryIdentity)).size, 9);
  assert.equal(merged[0].questionType, "self_intro");
});

test("提交返回时列表已出现下一题，答案仍只写回提交的那一轮", () => {
  const history = [entry(0, null), entry(1, null)];
  const updated = recordQaAnswer(history, { question: history[0].question, formal_turn_idx: 0, question_type: "technical" }, 1, "第一题实际答案");
  assert.equal(updated[0].answer, "第一题实际答案");
  assert.equal(updated[1].answer, null);
  assert.equal(history[0].answer, null);
});

test("跳过一题后恢复空评分快照不会擦除此前反馈", () => {
  const evaluation = { turn_idx: 0, dimension: "technical_depth", score: 3, passed: false, strengths: [], weaknesses: ["需补证据"] };
  const answered = { ...entry(0), evaluation };
  const open = entry(1, null);
  const skipped = recordQaAnswer([answered, open], { formal_turn_idx: 1, question_type: "technical" }, 2, "已跳过本题");
  const restored = mergeRestoredQaHistory(skipped, [{ ...entry(0), evaluation: null }]);
  assert.equal(restored[0].evaluation, evaluation);
  assert.equal(restored[1].answer, "已跳过本题");
});

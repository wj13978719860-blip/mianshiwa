# 面试蛙：第一步真实模型接入

## 已完成的能力

在独立 Python AI 服务中新增 OpenAI Chat Completions 兼容协议适配器，由 Java 管理员入口经 Nacos 服务发现和 OpenFeign 调用。实际供应商为 DeepSeek，按照用户指定使用 `deepseek-flash`，没有自动切换模型。

```text
管理员登录 Java
  → POST /api/ai/service/model/probe
  → AiModelClient 按 Nacos 服务名调用
  → POST /internal/v1/model/probe
  → Python 使用本地私有 Key 请求供应商 /chat/completions
  → 返回真实生成文本，Java 校验契约并包装 BaseResponse
```

原 `/api/ai/service/probe` 继续只做快速通信探测；原 Ark 接口不变。这一步借用之前规划的独立模型适配层边界，没有复制问镜完整面试流程，也没有实现 RAG 或 Agent。

## 真实验收（2026-10-12）

| 检查 | 结果 |
| --- | --- |
| Java → Python → DeepSeek | 业务码 0，返回 `mode=model`、`model=deepseek-flash` 和真实中文回答 |
| 测试问题 | 请用两句话解释 Java HashMap 为什么不是线程安全的 |
| 端到端耗时 | 4265 ms，本机单次实测，不表示固定性能 |
| 请求追踪 | `9963b487-9d81-4265-867a-a5780640fd17`；响应头、响应体、Java/Python 日志一致 |
| 旧通信探测 | 仍返回 `mode=stub` |
| 新模型入口游客 | 40100，未调用模型 |
| 新模型入口未知字段 | 40000，未调用模型 |
| 原题库查询 | 业务码 0 |
| 临时管理员清理 | 按确切 id/account 删除并确认剩余数 0 |
| Python 测试 | 27 项通过，含原通信契约和供应商协议/超时/并发/脱敏场景 |
| Java 相关回归 | 7 项通过，JDK 8 打包成功 |

原始本轮结果在 `.runtime/ai-model-real-results.json`；供应商故障场景使用模拟 HTTP 传输测试，不故意使用错误真实 Key 或消耗额度做批量测试。依赖存在原有第三方弃用提示。Java 全量历史集成测试没有作为本步骤通过标准，本步骤执行相关契约及黑名单回归。

## 配置和稳定性

Key、Base URL、模型名写入被 Git 忽略的 `.runtime/ai-service.env`；公共 `.env.example` 只有示例和空 Key，真实凭证不写入源码。本服务通过 httpx 实现兼容协议，不要求供应商 SDK。

Python 总时长预算默认 30 秒，最大输出 512 tokens，最大并发 2；Java 模型客户端默认读取 40 秒、连接 2 秒。快速探测的 3 秒读取预算不变。两端不自动重试，Python 不跟随 HTTP 重定向。健康检查不发送付费模型请求。

错误统一分类并脱敏；Java 不把供应商异常正文返回给用户。测试入口只允许管理员，不转发用户 Cookie 到 Python，不允许浏览器覆盖模型配置、系统角色或工具。模型结果属于生成内容，当前不做持久化或评分。

## 本步骤文件变更

- Python：新增 `app/model.py`、`tests/test_model.py`，更新配置、HTTP 入口、环境变量示例、依赖锁文件和 README。
- Java：新增 `AiModelClient`、`AiModelClientConfiguration`、`AiModelContract`、`AiModelController`、契约测试；更新 Feign 客户端注册、请求 ID 路径和独立模型超时配置。
- 本地：填写私有模型配置，重启 Java/Python 载入新版本；没有自动提交或推送 GitHub。

## 后续步骤

下一步才是面试会话：Java 保存题目快照及作答，Python 根据题目和参考答案生成结构化评价。完成会话与评价后，再增加追问、复盘和检索能力。

## 前端交互入口

新增 `/admin/ai` 页面，入口为“管理 → AI 问答”，使用现有管理员权限和请求工具携带登录态。包含技术问题输入、示例问题、Unicode 字符计数、生成状态、Markdown 回答、错误提示和清空操作。每次独立提问，不传递历史对话；模型生成期间阻止重复提交，离开页面取消浏览器等待。

新页面和 API 封装的独立 TypeScript 检查、限定文件 ESLint 检查通过，Next.js 开发模式页面编译与 HTTP 200 通过；未登录浏览器显示项目原有 403 页面。项目全量类型检查存在旧页面及生成 API 类型报错，本次没有修改这些旧问题。

本轮新增前端文件为 `src/api/aiModelController.ts`、`src/app/admin/ai/page.tsx`、`src/app/admin/ai/index.css`，并在 `config/menu.tsx` 添加管理员菜单。用户已自行完成前端交互验收并确认通过；未为该页面验收创建临时管理员账号。

后续目标明确为替换原 AI 模拟面试功能，以问镜为主要技术参考并适配面试蛙。当前管理员问答页仅为新服务的验证入口，不代表已经完成模拟面试替换。

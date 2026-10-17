# 面试蛙

面试蛙是一个程序员面试刷题平台，支持题库学习、题目检索、刷题日历和 AI 文字模拟面试。

维护者：[程序员条条](https://github.com/wj13978719860-blip/mianshiwa)

GitHub 仓库：https://github.com/wj13978719860-blip/mianshiwa

## 功能

- 账号注册、登录、个人资料编辑和管理员权限。
- 题库与题目管理、批量关联、Markdown 题目和题解。
- Elasticsearch 题目搜索与数据库同步；按题库筛选使用 MySQL。
- 刷题签到与日历记录。
- AI 文字模拟面试：简历与岗位描述解析、面试设置、自我介绍、动态出题、追问、跳题、暂停与恢复。
- 面试报告、评分证据、训练计划、历史列表、问答回放和 Trace。
- 简历重点跨场轮换、项目业务适配检查、同场考点去重和围绕回答缺口的追问。
- 面试设置明确区分方向练习与真实岗位面试；支持粘贴或上传 JD，解析技能和维度后确认开始，详见 [JD 入口与验收](docs/JD定向面试入口与验收.md)。
- 管理员 AI 问答与服务探测；原 AI 批量出题仍使用 Ark 独立配置。
- Redis 缓存、HotKey 热点识别、Sentinel 保护、Nacos 动态 IP 黑名单。

AI 模拟面试已由独立 Python 服务替换，核心流程参考问镜。刷题题库与 AI 面试素材分别管理，不将原刷题题库作为面试出题边界。

针对模板业务错配和重复提问，面试蛙补充了质量校验与重点调度，保留真实简历事实；实现边界和验证见 [出题质量改造记录](docs/AI面试出题质量改造与验收.md)。

## 技术栈

| 部分 | 技术 |
| --- | --- |
| 前端 | Next.js 14、React 18、TypeScript、Ant Design、Redux Toolkit |
| Java 后端 | JDK 8、Spring Boot 2.7.2、MyBatis-Plus、Sa-Token、Spring Cloud OpenFeign / LoadBalancer |
| AI 服务 | Python 3.11、FastAPI、LangGraph、OpenAI 兼容模型协议 |
| 数据与中间件 | MySQL、Redis、Elasticsearch / ESVector、Nacos、Sentinel、etcd、HotKey |
| 当前模型配置 | DeepSeek `deepseek-flash`；DashScope `text-embedding-v3`，1024 维 |

面试请求由浏览器发送给 Java，Java 校验登录身份，通过 Nacos 发现 Python 实例并以 HTTP 转发。管理员探测与模型调试接口使用 OpenFeign。Java 保持 JDK 8，无需为 AI 服务升级到 JDK 17。

问镜的会话与 Checkpoint 存在独立 MySQL 库，简历锚点与知识向量存入 ES，BM25 沿用问镜的 Python 实现。Redis 提供共享解析缓存和限流。

## 项目结构

| 目录 | 内容 |
| --- | --- |
| `mianshiya-next-frontend` | 刷题页面及 AI 面试设置、房间、历史、报告、回放、Trace |
| `mianshiya-next-backend` | Java 业务接口、登录鉴权、AI 网关与数据库脚本 |
| `mianshiya-ai-service` | Python AI 服务、问镜面试引擎、MySQL / ES 适配及测试 |
| `scripts` | 启动、环境准备、问镜同步、素材导入与回归脚本 |
| `docker` | 中间件构建文件与运行说明 |
| `docs` | 配置、设计及验收记录 |

页面品牌为“面试蛙”。内部 `mianshiya` 包名、目录名及服务标识保留。

## 本地运行

需要 JDK 8、Maven、Node.js、Python 3.11、uv、MySQL 和 Docker。Windows 启动脚本中的安装路径可通过参数调整。

1. 在 MySQL 准备业务库 `mianshiya`，检查 `mianshiya-next-backend/sql/create_table.sql` 后初始化；已有数据库不要重复执行。`init_data.sql` 是可选演示数据。
2. 从项目根目录准备 HotKey 客户端依赖并启动基础中间件：

```powershell
./scripts/prepare-hotkey-client.ps1
docker compose up -d --build redis elasticsearch nacos sentinel
```

本机 etcd、HotKey worker 和 dashboard 的启动见 [中间件说明](docker/README.md)。Compose 用于本地开发。

3. 按 [AI 服务说明](mianshiya-ai-service/README.md) 准备 Python 环境和 `.runtime/ai-service.env`。填写内部凭证、模型、Embedding、MySQL、ES、Redis 配置，开启 `OPENAI_MODEL_ENABLED` 和 `WENJING_ENABLED`。提前创建独立 AI 库 `mianshiwa_ai_wenjing`，使用说明中的字符集和权限；首次启动自动建表。

```powershell
uv python install 3.11
./scripts/prepare-ai-service.ps1
./scripts/start-ai-service.ps1
```

4. 在另一个终端启动 Java：

```powershell
$env:DB_PASSWORD='你的数据库密码'
./scripts/start-backend.ps1 -Build -EnableAiService
```

维护者机器的私有数据库覆盖配置位于 `.runtime/backend-private.yml`，启动脚本会读取。新环境需按自身连接参数配置。

5. Python 就绪后导入问镜面试素材，再启动前端：

```powershell
# 默认只读诊断；--apply 才导入，重复导入按 ID / 版本更新。
./.runtime/ai-venv/Scripts/python.exe scripts/prepare-wenjing-data.py
./.runtime/ai-venv/Scripts/python.exe scripts/prepare-wenjing-data.py --apply
./scripts/start-frontend.ps1
```

前端默认开发模式；生产模式使用 `./scripts/start-frontend.ps1 -Production -Build`。

| 地址 | 用途 |
| --- | --- |
| http://localhost:3000 | 前端 |
| http://localhost:3000/interview/setup | AI 面试设置 |
| http://localhost:3000/interview/history | 我的面试 |
| http://localhost:8101/api/doc.html | Java 接口文档 |
| http://127.0.0.1:8102/health/ready | AI 服务就绪检查 |

当前本机使用 Docker Redis `6380`、ES `9201`、Nacos `8848 / 9848`；请核对自己的端口，避免连到其他实例。Nacos 中的 AI 服务名为 `mianshiya-ai-service`。仅启动 Java 与前端无法使用独立 AI 面试。

## 配置

| 配置 | 用途 |
| --- | --- |
| `DB_PASSWORD`、Java datasource 配置 | 原业务 MySQL |
| `AI_SERVICE_TOKEN`、`NACOS_*` | Java / Python 内部认证与注册发现 |
| `OPENAI_BASE_URL` / `OPENAI_MODEL` / `OPENAI_API_KEY` | AI 对话模型 |
| `EMBEDDING_BASE_URL` / `EMBEDDING_MODEL` / `EMBEDDING_DIMENSIONS` / `EMBEDDING_API_KEY` | 独立 Embedding 模型 |
| `WENJING_ENABLED`、`AI_MYSQL_*`、`WENJING_MYSQL_DATABASE` | 问镜开关与独立数据库 |
| `CHECKPOINT_BACKEND=mysql`、`AI_ES_URL` | 会话恢复与 ESVector |
| `REDIS_URL`、`RESUME_PARSE_CACHE_BACKEND`、`RATE_LIMIT_BACKEND` | AI 共享缓存与限流，模板使用独立键前缀 |
| `EVALUATOR_LLM_MAX_TOKENS`、`COACH_LLM_MAX_TOKENS` | 评分与训练计划输出预算 |
| `AI_API_KEY` | 原 Ark 批量出题功能 |
| `REDIS_PASSWORD`、`ES_PASSWORD` | 原 Java 中间件认证 |
| `COS_ACCESS_KEY` / `COS_SECRET_KEY`、`WX_*` | 可选对象存储与微信功能 |
| `SENTINEL_CLIENT_IP` | Docker 控制台回连后端的宿主 IPv4 |

完整 AI 模板见 `mianshiya-ai-service/.env.example`。真实 Key、Cookie、恢复凭证、数据库密码和日志只放在被 Git 忽略的本地目录，不随源码发布。

## 验证与当前边界

本轮已通过前端类型检查、独立生产构建、定向回归，以及真实模型的 3 / 8 轮面试、重复回答、重启恢复、跳题收尾、报告、回放和 Trace 验证。详细范围和未覆盖项见 [文字面试补齐与验收](docs/问镜文字面试补齐与验收.md)。

- 已导入问镜自带的 162 个题目种子、324 个变体；正式公共知识库仍缺允许入库的真实资料。向量链路验证通过不等于公共知识库已经有内容。
- 当前单 Python 实例，部分在线执行和幂等状态仍在进程内，不具备多实例高可用。
- 没有独立提前结束按钮/API；语音、个人 BYOK、额度与运营后台暂不开发。
- 评分准确性、策略学习效果、大规模召回质量与长期压测尚未专项评估。
- COS、微信及遗留帖子模块未完成可用性验收；页面仍有部分组件告警。

第三方许可及问镜固定版本见 [第三方组件说明](THIRD_PARTY_NOTICES.md)。

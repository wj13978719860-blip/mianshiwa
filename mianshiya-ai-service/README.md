# 面试蛙独立 AI 服务

本目录提供 Python 3.11 / FastAPI 服务，注册现有 Nacos，由 Java 后端通过 OpenFeign 按服务名调用。包含通信探测（`mode=stub`）和管理员真实模型测试（`mode=model`）两个独立入口，后者使用 OpenAI Chat Completions 兼容协议。原后端的 Ark 业务接口继续使用原路径。

## 建议的代码阅读顺序

先看 Java 入口如何发请求，再看 Python 如何接收，最后看注册与启动。每个源文件已补充中文注释。

```text
管理员发请求
  → AiRequestIdFilter：生成本次请求的 UUID
  → AiServiceController：检查权限、参数、开关
  → AiServiceClient：Feign 按服务名调用 Python
  → Python main.py：验证内部凭证、请求标识、正文
  → 返回固定探测结果
  → Java 校验返回结果，包装为 BaseResponse

Nacos 提供实例地址，不转发这次业务 HTTP 请求。
```

| 顺序 | 文件 | 主要看什么 |
| --- | --- | --- |
| 1 | `../mianshiya-next-backend/src/main/java/com/yupi/mianshiya/controller/AiServiceController.java` | 整个 Java 调用流程和错误处理 |
| 2 | `../mianshiya-next-backend/src/main/java/com/yupi/mianshiya/ai/AiServiceClient.java` | Java 对应哪个 Python 路径，如何按服务名调用 |
| 3 | `../mianshiya-next-backend/src/main/java/com/yupi/mianshiya/ai/AiClientConfiguration.java` | 超时、禁止重试、内部凭证如何附加 |
| 4 | `app/main.py` | Python HTTP 入口、认证、正文校验和固定响应 |
| 5 | `app/registry.py` | 注册 Nacos、监控失联、补注册和退出注销 |
| 6 | `app/settings.py` | 从哪些环境变量读取配置，为什么启动时校验 |
| 7 | `app/__main__.py` | `python -m app` 如何启动 Uvicorn |

Java 的其他配套文件：`AiServiceProperties` 绑定配置，`AiDiscoveryConfiguration` 控制客户端启用，`AiProbeContract` 校验双方的数据约定，`AiRequestIdFilter` 将一次调用的两端日志关联起来。

Python 常见写法：`async def` 定义异步函数，`await` 等待异步操作完成，等待可让事件循环处理其他任务；`lifespan` 的 `yield` 前后分别执行启动与退出逻辑；`app.state` 保存应用共享的配置和注册器，`request.state` 保存当前请求的 UUID。Pydantic 模型声明字段类型，FastAPI 会自动按模型校验请求正文。

`tests/test_contract.py` 是无需真实 Nacos 的接口测试；`tests/fault_server.py` 是模拟故障的临时服务。它们都不属于正式业务入口。`requirements.in` 是维护依赖的源文件，两个 `.txt` 是自动生成的完整版本/哈希锁文件，不是业务代码。`prepare-ai-service.ps1` 准备环境，`start-ai-service.ps1` 加载私有配置并启动服务。

## 本地启动

从项目根目录执行。先启动现有 MySQL、Redis、ES、Nacos、etcd/HotKey；Nacos 需要开放 8848 和 9848。Python 与 Java 都运行在宿主机，AI 默认只监听 `127.0.0.1:8102`。

1. 安装 [uv](https://docs.astral.sh/uv/getting-started/installation/)，准备 Python 3.11 和依赖：

```powershell
uv python install 3.11
./scripts/prepare-ai-service.ps1
```

2. 首次运行时，创建双方共用的私有配置和随机内部凭证。已有文件时不要重新生成，否则运行中的 Java/Python 凭证可能不一致。

```powershell
New-Item -ItemType Directory -Force .runtime | Out-Null
if (Test-Path .runtime/ai-service.env) { throw '私有配置已存在，请保留并检查现有文件' }
$credentialBytes = New-Object byte[] 32
$credentialRng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
try { $credentialRng.GetBytes($credentialBytes) } finally { $credentialRng.Dispose() }
$template = Get-Content mianshiya-ai-service/.env.example -Raw
$privateContent = $template.Replace('replace-with-private-random-service-credential', [Convert]::ToBase64String($credentialBytes))
Set-Content .runtime/ai-service.env -Value $privateContent -Encoding UTF8
```

`.runtime/ai-service.env` 被 Git 忽略；脚本读取文件并以现有进程环境变量为优先。不要把凭证填入公共 `application.yml`。

3. 在一个终端启动 Python：

```powershell
./scripts/start-ai-service.ps1
```

4. 在另一个终端启动 Java；如有旧进程，先停止旧进程，避免 8101 端口冲突：

```powershell
./scripts/start-backend.ps1 -Build -EnableAiService
```

Java 保持 JDK 8。数据库配置仍由原有环境变量或 `.runtime/backend-private.yml` 提供。此脚本只有带 `-EnableAiService` 时才开启接入，避免上一轮启动遗留的环境变量意外开启功能。

5. 检查服务：

```powershell
Invoke-RestMethod http://127.0.0.1:8102/health/live
Invoke-RestMethod http://127.0.0.1:8102/health/ready
Invoke-RestMethod 'http://127.0.0.1:8848/nacos/v1/ns/instance/list?serviceName=mianshiya-ai-service&groupName=DEFAULT_GROUP'
```

Nacos 控制台的 public / DEFAULT_GROUP 下应存在 `mianshiya-next-backend:8101` 和 `mianshiya-ai-service:8102` 两个健康实例。

## 验证 Java → Python

在 [后端接口文档](http://localhost:8101/api/doc.html) 中使用已有管理员账号登录，调用 `POST /api/ai/service/probe`，请求体：

```json
{"message":"hello"}
```

预期 `code=0`，`data.service=mianshiya-ai-service`，`data.mode=stub`，`data.reply=AI service is reachable`，响应头 `X-Request-Id` 与 `data.requestId` 一致。前端页面本版没有新增按钮。

游客返回 40100，普通用户返回 40101；Java 沿用项目原约定，HTTP 200 不代表业务成功。参数错误为 40000，远程失败或接入关闭为 50001，失败的 `data=null`。Python 内部接口使用真实的 HTTP 401 / 422 / 503 / 500。

健康检查不需要凭证；`POST /internal/v1/probe` 必须带 `X-AI-Service-Token` 和 UUID 格式的 `X-Request-Id`。内部凭证由 Java 客户端添加，浏览器不需要知道它。

## 配置

### 真实模型接入（第一步）

在被 Git 忽略的 `.runtime/ai-service.env` 中填写以下配置。供应商 Key 仅由 Python 读取，与 Java/Python 内部认证的 `AI_SERVICE_TOKEN` 不同。

```dotenv
OPENAI_MODEL_ENABLED=true
OPENAI_BASE_URL=https://api.deepseek.com
OPENAI_API_KEY=填写你的真实Key
OPENAI_MODEL=deepseek-flash
OPENAI_TIMEOUT_SECONDS=30
OPENAI_MAX_TOKENS=512
OPENAI_MAX_CONCURRENCY=2
```

Base URL 是供应商的 API 根地址，适配器自动拼接 `/chat/completions`；例如 DashScope 使用 `https://dashscope.aliyuncs.com/compatible-mode/v1`，模型名填写该供应商支持的名称。配置无效时启动失败，不会自动换模型或降级为固定回答。关闭 `OPENAI_MODEL_ENABLED` 后，原通信探测继续可用。

重启 Python 和更新后的 Java 后，管理员登录并调用：

```http
POST /api/ai/service/model/probe
Content-Type: application/json

{"message":"请用两句话解释 Java HashMap 为什么不是线程安全的。"}
```

成功结果为 `code=0`，`data` 包含 `requestId`、`service`、`mode=model`、`model` 和模型生成的 `reply`。测试问题上限 256 个 Unicode 字符，不接受额外字段。浏览器不能指定供应商、模型、Key、系统提示词或工具。游客/普通用户仍分别返回 40100/40101。

Java 模型接口使用独立 Feign context，读取预算默认 40 秒，快速探测仍为 3 秒；连接预算均为 2 秒。Python 模型调用总预算默认 30 秒、最多并发 2 个请求，超额立即拒绝；无自动重试、不跟随重定向、不继承本机代理。修改 Python 预算时须同步确保 `ai.service.model-read-timeout-ms` 大于它并预留转发时间。

Python 统一错误类型包括 `MODEL_NOT_CONFIGURED`、`MODEL_BUSY`、`MODEL_AUTH_FAILED`、`MODEL_RATE_LIMITED`、`MODEL_REQUEST_REJECTED`、`MODEL_UPSTREAM_ERROR`、`MODEL_TIMEOUT`、`MODEL_UNAVAILABLE`、`MODEL_PROTOCOL_ERROR`。Java 对外返回脱敏的 50001 和请求 ID，排错时据此查询 Python 日志；供应商原始错误正文、Key 不回传给浏览器。

代码阅读：`app/model.py` 负责模型协议、连接池、超时与错误；`app/main.py` 负责接口认证/校验和响应；Java 的 `AiModelClient`、`AiModelClientConfiguration`、`AiModelContract`、`AiModelController` 分别负责声明调用、独立超时、响应验证和管理员入口。所有新增源文件有中文注释。

本步骤不提供聊天前端、面试会话、作答评分或知识库检索，不保存模型回答到数据库。`tests/test_model.py` 模拟供应商验证协议和故障，不消耗额度；真实验收结果见项目 `docs/AI模型接入-第一步验收.md`。

### 服务通信配置

| 配置 | 默认值 / 用途 |
| --- | --- |
| `AI_SERVICE_TOKEN` | 必填；双方相同的私有凭证 |
| `AI_SERVICE_NAME` | `mianshiya-ai-service`；双方共享 |
| `NACOS_SERVER_ADDR` | `127.0.0.1:8848`；双方共享 |
| `NACOS_NAMESPACE` | 空值代表 public；自定义空间填写实际 namespace ID |
| `NACOS_GROUP` | `DEFAULT_GROUP`；双方共享 |
| `AI_HOST` / `AI_PORT` | Python 监听地址 / 端口：`127.0.0.1` / `8102` |
| `AI_REGISTER_IP` | Python 注册地址：`127.0.0.1` |
| `BACKEND_REGISTER_IP` | Java 注册地址：`127.0.0.1` |
| `AI_LOG_LEVEL` | Python 应用与 Uvicorn 日志级别：`INFO` |
| `AI_SERVICE_ENABLED` | 直接运行 Java JAR 时的开关，默认 false；启动脚本以参数明确覆盖 |
| `ai.service.connect-timeout-ms` | Java 连接超时，2000 ms；可由 Spring 配置或命令行覆盖 |
| `ai.service.read-timeout-ms` | Java 读取超时，3000 ms；可由 Spring 配置或命令行覆盖 |

目前复用本机关闭鉴权的 Nacos；尚未提供带鉴权/TLS 的 Nacos 部署配置。跨主机/容器部署需要配置实际可达地址，不要注册 `0.0.0.0` 或直接沿用回环地址。`NACOS_SERVER_ADDR` 管理新增 naming 接入；原 `nacos.config` 配置中心设置保持独立，迁移注册中心时两处都需核对。

依赖版本：FastAPI 0.115.12、Uvicorn 0.34.3、nacos-sdk-python 2.0.11。运行和开发依赖分别在 `requirements.txt`、`requirements-dev.txt` 中锁定版本与哈希。安装脚本使用 `uv pip sync --require-hashes`，切换到运行锁文件会移除测试依赖。

## 生命周期与故障

- 首次 Nacos 初始化/注册总预算 30 秒，清理最多 5 秒，失败时非零退出；未注册成功不开始 HTTP 监听。
- Nacos SDK 维护 gRPC 连接和重连。后台每 5 秒确认一次实例，失败后检查间隔最多 10 秒，每次检查预算 3 秒。
- `ready` 表示业务是否可接收请求；`registry` 独立报告注册状态。运行中 Nacos 断开时，业务正常则 ready 仍为 200，已有发现缓存可能继续调用。
- Feign 与 LoadBalancer 自动重试关闭。日志记录 UUID、耗时和错误类别，不打印内部凭证、用户 Cookie 或完整正文。
- 正常 Ctrl+C 退出尝试注销；异常结束依赖 Nacos 临时实例机制摘除。恢复后无需重启 Java。
- 单 worker、不启用 reload；当前只有一个 Python 实例，不具备 AI 服务高可用。

SDK 2.0.11 需要两处适配：gRPC 的空 namespace 规范化为 `public`；关闭客户端时避开 SDK 对同步 `stop()` 的错误 await。后台检查直接远程查询，避免 SDK 缓存把失联误报为已注册。升级 SDK 时需重新验收这些行为。

## 测试与故障复现

```powershell
./scripts/prepare-ai-service.ps1 -Dev
$env:PYTHONPATH = (Join-Path $PWD 'mianshiya-ai-service')
./.runtime/ai-venv/Scripts/python.exe -m pytest mianshiya-ai-service/tests/test_contract.py -q -p no:cacheprovider
```

后端构建测试：在 JDK 8 环境执行 `mvn -f mianshiya-next-backend/pom.xml -Dtest=AiProbeContractTest,BlackIpUtilsTest test`。测试使用假的 registry，不依赖模型或真实 Nacos；真实注册发现和故障验收另见 [实施与验收记录](../docs/AI服务MVP实施与验收.md)。

真实 Feign 故障复现可以使用 `tests/fault_server.py`，只用于本地验收。先停止正常 Python，保持已启用的 Java 运行。在新 PowerShell 终端加载内部凭证后执行：

```powershell
$env:AI_SERVICE_TOKEN = (Get-Content .runtime/ai-service.env | Where-Object { $_.StartsWith('AI_SERVICE_TOKEN=') }).Substring('AI_SERVICE_TOKEN='.Length)
$env:PYTHONPATH = (Join-Path $PWD 'mianshiya-ai-service')
./.runtime/ai-venv/Scripts/python.exe mianshiya-ai-service/tests/fault_server.py --mode delay
```

再从管理员入口调用一次。`delay` 延迟 6 秒，默认读取超时约 3 秒，Java 应返回 50001；`.runtime/ai-fault-requests.jsonl` 应只有这一请求的 1 条记录。其他模式：`bad-response` 返回不匹配的请求标识，`auth` 返回 401，`refuse` 注册未监听的相邻端口（须确认该端口未被占用）。生产 `app` 没有这些故障开关。完成后 Ctrl+C 停止测试服务，再启动正常 Python。

## 停用与版本回退

功能停用：停止 Java，再运行 `./scripts/start-backend.ps1`（不带 `-EnableAiService`），随后停止 Python。原配置中心继续运行，管理员探测返回“AI 服务接入未启用”。关闭开关不会撤销 Maven 依赖升级。

本机实施前的 JAR、POM、配置模板、依赖树与基线 commit 保存在忽略目录 `.runtime/ai-mvp-baseline/`。需要回退时停止新 Java/Python，使用基线 JAR 和原私有配置启动；原版本不提供新增探测入口：

```powershell
& "$env:JAVA_HOME/bin/java.exe" -Dfile.encoding=UTF-8 -jar .runtime/ai-mvp-baseline/backend.jar '--spring.config.additional-location=file:.runtime/backend-private.yml'
```

这份备份只存在于实施机器。其他环境部署前也需保留自己的基线产物、配置和 Git 版本。源码回退应从已记录基线另建 checkout 构建，不覆盖后续改动，不重置数据库或中间件数据卷。

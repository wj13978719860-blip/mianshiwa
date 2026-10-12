# 面试蛙 AI 服务 MVP 实施与验收

日期：2026-10-12。对应 [Spec v0.2](AI服务MVP-Spec-v0.2.md)。本次完成独立服务的注册发现与通信闭环，未迁移真实模型调用，也未实现 RAG、Harness 或动态面试。

## 最终实现

```text
Next.js → Java 8 / Spring Boot 2.7.2 :8101
              │ OpenFeign + LoadBalancer，按 mianshiya-ai-service 发现
              ↓
         Python 3.11 / FastAPI :8102

两个服务 → Nacos 2.4.3，public / DEFAULT_GROUP
```

Java 新增管理员接口 `POST /api/ai/service/probe`，由 Sa-Token 控制登录与管理员权限。Java 为请求生成 UUID，校验参数后调用 Python，内部凭证仅由 Feign 客户端添加。Python 提供认证、严格字段校验、健康检查和固定探测响应。双方响应与日志关联同一个 UUID。

Java 的 AI 客户端配置限定于新增客户端；Feign/LoadBalancer 自动重试关闭，连接/读取超时默认 2000/3000 ms。远程认证、超时、连接、无实例和响应协议错误统一向外返回业务码 50001，日志保留具体错误类别。

`ai.service.enabled` 默认 false。关闭时不创建 AI Feign 客户端，不启用新增 naming 注册发现，原 Nacos 配置监听继续工作。启动脚本使用 `-EnableAiService` 明确开启。没有升级业务后端 JDK，没有修改数据库表、ES 索引或中间件数据卷。

## 验证版本

| 组件 | 最终版本 |
| --- | --- |
| Java / Spring Boot | JDK 1.8.0_341 / 2.7.2 |
| Spring Cloud BOM | 2021.0.6 |
| Spring Cloud Alibaba BOM | 2021.0.5.0 |
| OpenFeign starter / LoadBalancer | 3.1.6 / 3.1.6 |
| Feign core | 11.10 |
| Nacos Java client | 2.2.0，原依赖解析为 2.1.0 |
| 现有 Nacos config starter | 0.2.12，保留 |
| Sentinel core | 1.8.6，原版本保留，改由 BOM 管理 |
| Nacos server | 2.4.3 |
| Python | 3.11.15 |
| FastAPI / Uvicorn | 0.115.12 / 0.34.3 |
| Nacos Python SDK | nacos-sdk-python 2.0.11，使用 `v2.nacos` API |
| 开发测试依赖 | httpx 0.28.1 / pytest 8.3.5 |

Python 全部传递依赖和哈希保存在两个 requirements 锁文件；安装脚本的哈希校验已验证。新旧 Maven 依赖树分别保存在 `.runtime/ai-mvp-dependency-tree.txt`、`.runtime/ai-mvp-baseline/dependency-tree.txt`，不提交本机运行目录。

SDK 3.x 面向 Nacos 3.x，本次选择经 Nacos 2.4.3 实测的 2.0.11。实施发现并处理了以下 SDK 差异：

1. Java/HTTP 接口将空 namespace 视为 public，但该 Python SDK 的 gRPC 代理会原样传入空字符串；Python 在边界规范化为 `public`，保证 Java 能发现注册实例。
2. SDK 的 `get_service()` 可能返回缓存；后台检查使用有界的服务端查询，避免断连后持续报告 registered。
3. SDK 的 shutdown 对同步 updater.stop() 错误使用 await；适配器显式停止 updater，并关闭 gRPC 客户端。升级 SDK 时需复验。

## 生命周期参数

Python 注册首次初始化限制 30 秒，退出清理限制 5 秒；底层 gRPC 请求超时设为 2000 ms，gRPC 端口偏移 +1000。SDK 默认 gRPC keepalive 为 60 秒，应用层连接检查周期为 5 秒；SDK 重连间隔递增、最大 5 秒，SDK 初次连接最多尝试 3 次。

本项目额外每 5 秒执行一次实例确认，单次预算 3 秒，异常后检查间隔最多 10 秒。这是注册状态诊断，不是另一套实例心跳。Java 依照 Nacos 客户端订阅更新发现缓存，LoadBalancer 自身缓存和自动重试关闭。Python 使用单 worker、不启用 reload。

正常退出尝试注销临时实例。异常结束依靠 gRPC 连接与 Nacos 临时实例失效机制；无法保证所有网络环境下都立即摘除，因此 Java 同时处理旧缓存地址调用失败。

## 验收结果

| 编号 | 结果与证据 |
| --- | --- |
| AC-01 | public / DEFAULT_GROUP 中两个健康实例：Java 127.0.0.1:8101、Python 127.0.0.1:8102 |
| AC-02 | 管理员通过真实 Feign 服务名发现调用成功；返回 mode=stub；两端日志、响应头与响应体的 UUID 一致 |
| AC-03 | 游客 40100、普通用户 40101、管理员成功；测试服务请求计数证明无权请求没有进入 Python |
| AC-04 | 缺失/错误内部凭证均返回 HTTP 401，优先于非法 JSON 和非法 UUID；错误体与响应头标识一致 |
| AC-05 | 非法 JSON、空体、null、空白、类型错误、未知字段、超长均被拒绝；256 个蛙 Emoji 通过，257 个失败；Java 拒绝尾随 JSON；Python 拒绝缺失 UUID；错误成功响应不能被 Java 当作成功 |
| AC-06 | 正常停止注销实例，Java 返回 50001 |
| AC-07 | 强制终止后约 1.31 秒实例失效；不可达地址在默认连接超时下约 2.02 秒失败；另以 5000 ms 诊断连接预算验证真实连接拒绝，约 2.22 秒返回 |
| AC-08 | Python 重启就绪后约 0.08 秒连续三次 Java 调用成功，Java 无需重启 |
| AC-09 | 独立测试服务延迟 6 秒，真实 Feign 约 3.03 秒读取超时；请求计数为 1，无隐藏重试；生产 app 不含延迟开关 |
| AC-10 | 停止 Nacos 后约 4.08 秒 registry 异常可见；ready 仍为 200，直接合法探测成功，Java 命中既有缓存也成功；Nacos readiness 恢复后约 6.14 秒注册与连续三次调用恢复 |
| AC-11 | 不可用 Nacos 地址下 Python 约 8.03 秒非零退出，未遗留监听进程；SDK 可提前失败，无须耗尽 30 秒预算 |
| AC-12 | JDK 8 构建通过，登录和题库查询通过；原 Ark 调用代码与路径未改；真实模型调用因缺少有效密钥未验证 |
| AC-13 | 默认关闭、手动关闭均验证；无新增 Java 注册实例，管理员返回 50001；关闭时原配置监听仍工作 |
| AC-14 | 实际启动保存的基线 JAR，原登录功能通过，再恢复新产物；未回滚数据库 |
| AC-15 | 固定依赖组合在 JDK 8 编译和启动通过；开/关两种状态的 Nacos 配置变更均约 1 秒被监听；Sentinel 原有 1 条热点限流、2 条降级规则仍加载 |

Windows 关闭端口可能先表现为连接超时，所以将默认预算下的 CONNECT_TIMEOUT 与较长诊断预算下的 CONNECTION_REFUSED 分别记录；最终运行配置恢复为连接 2000 ms、读取 3000 ms。以上时间为本机实测，不作为跨环境的固定延迟承诺。

后端契约测试与已有黑名单测试：4 项通过；Python 契约测试：9 项通过。第三方 Starlette/Nacos SDK 存在弃用提示，当前固定依赖测试通过，升级时应复验。

故障测试只使用临时测试账号，管理员角色仅授予本次临时账号，完成后按确切 id/account 删除。Nacos 动态配置测试只附加无业务作用的标记字段并恢复原文；未更改实际黑名单。原始验收数据保存在 `.runtime/ai-mvp-results.json`。`tests/fault_server.py` 可重复模拟读取延迟、错误响应、认证失败和未监听地址，操作步骤在服务 README 中。

## 变更范围与使用入口

新增 Python `app/`、契约测试、故障测试服务、依赖锁文件和配置示例；Java 新增 `ai/` 客户端及配置类、`AiServiceController`、契约测试。修改后端 POM、公共配置、启动脚本、Git 忽略规则和 README。既有 `BlackIpUtils`、`BlackIpUtilsTest`、`SentinelRulesManager` 和 `AiManager` 本次没有修改。

启动与配置见 [AI 服务 README](../mianshiya-ai-service/README.md)。管理员在接口文档登录后，发送 `POST /api/ai/service/probe`，正文为 `{"message":"hello"}`。本版本没有新增前端入口。

## 停用与回退

功能停用：停止 Java，再运行 `./scripts/start-backend.ps1`（不带 `-EnableAiService`），随后停止 Python。现有业务接口和配置中心继续工作，但依赖仍是新版本。

版本回退基线：`89d8113f522bb44600b471b0c21b66ae60fdde19`。实施前保存的 JAR、POM、公共配置、依赖树和 commit 位于 `.runtime/ai-mvp-baseline/`。私有数据库配置与内部凭证保留在 `.runtime/` 中。回退停止新服务后运行基线 JAR 与匹配配置，并验证原功能；不要覆盖用户后续改动、重置数据库密码或删除数据卷。基线源码需要从该 commit 在单独 checkout 中恢复构建。

验收结束使用正式启动脚本运行 Java 与 Python，恢复默认超时、原 Nacos 配置，测试实例与账号已清理。代码没有自动提交或推送 GitHub。下一阶段可在这个独立服务中增加模型适配器，再按新 Spec 引入面试流程和检索能力。

## 复审问题修复与回归（2026-10-12）

复审发现两个接口契约遗漏，已修复：

1. Java 响应解析统一使用严格解析方法，拒绝合法 JSON 后的乱码或第二个 JSON 对象，并按协议错误映射为 50001。新增控制器回归测试模拟真实 Feign Response，同时验证正常 JSON 和末尾空白仍可成功。
2. Python 对探测路径的正文解析 HTTP 400 统一返回 HTTP 422 / INVALID_REQUEST，补齐 requestId、error、message；错误凭证仍优先返回 401，其他路径的框架错误行为保持原约定。

本次 JDK 8 构建打包通过；Java 契约/黑名单测试共 5 项通过，Python 契约测试共 12 项通过。新增代码和测试均有中文说明，修复后的后端 JAR 已重新生成。

上文注册发现与故障恢复数据是初次实施时的历史记录。本次复审期间服务端口不可达，未重新执行真实 Nacos 联调；本段测试结果不代表已经重新确认当前运行环境正常。

## 本轮真实联调验收（2026-10-12）

本轮已实际启动正式 Java JAR 和 Python `app`，通过真实 HTTP 请求完成 Java → Nacos 服务发现 → OpenFeign → Python 调用，没有使用假注册器替代 Nacos。实测 Nacos 版本为 **2.5.2**，两个服务在 public / DEFAULT_GROUP 各有一个健康实例，地址分别为 127.0.0.1:8101 和 127.0.0.1:8102。

| 检查项 | 本轮实测结果 |
| --- | --- |
| 管理员调用 Java 探测接口 | 连续三次业务码 0，耗时 235 ms、15 ms、15 ms |
| 两端日志关联 | 三次响应 UUID 均出现在 Java 和正式 Python 日志，响应头与正文一致 |
| 游客、普通用户权限 | 分别返回 40100、40101 |
| Java 请求参数 | 空对象、空白字符串、数字、未知字段四种输入均返回 40000 |
| Python 内部认证 | 错误内部凭证返回 HTTP 401 / UNAUTHORIZED |
| Python 无效 UTF-8 | 正式端点返回 HTTP 422 / INVALID_REQUEST，并保留相同请求 UUID |
| 原题库查询 | `/api/question/list/page/vo` 返回业务码 0，总数 20 |
| 停止真实 Python 进程 | Java 约 2031 ms 返回业务码 50001；请求 UUID 为 `0c00eef5-d17c-431e-9e19-282dbece0317` |
| 恢复正式 Python | 原 Java 进程 PID 73592 未重启，调用再次返回业务码 0；两端 UUID 为 `489b0d40-ef09-49ed-9718-169afc3a233a` |
| 临时账号清理 | 本轮脚本专用测试账号数据库剩余数为 0 |

首个成功调用 UUID：`42dd1a6b-1e78-48c5-8798-263d3d65c124`。本轮独立原始结果存放于被 Git 忽略的 `.runtime/ai-real-integration-results.json`，不覆盖历史验收结果。停止测试中的恢复命令曾因测试脚本引号错误失败，随后通过公开启动脚本恢复，并单独完成恢复调用及账号清理验证。

真实启动另外发现 Windows PowerShell 5.1 无法正确读取含中文注释的 UTF-8 无 BOM 脚本，已将 `start-backend.ps1`、`start-ai-service.ps1`、`prepare-ai-service.ps1` 改为 UTF-8 BOM，并验证解析通过。本轮未改业务 Java/Python 源码。

Docker Desktop 的两个遗留 socket 目录 `Docker/run` 和 `docker-secrets-engine` 已备份后重建，未恢复出厂设置、未删除容器数据卷。Redis、ES、Nacos、Sentinel 容器已恢复运行；本机 etcd 已恢复，Java 日志已再次发现 HotKey worker `127.0.0.1:11113`。

本轮验收范围是服务通信 MVP：响应仍为 `mode=stub`，没有调用真实模型，也未验收 RAG、AI 面试或前端交互。本轮没有重新执行上文全部 AC-01 至 AC-15 故障场景，历史数据仍须与本轮结果区分。

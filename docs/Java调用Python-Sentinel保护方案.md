# Java 调用 Python：Sentinel 保护方案

日期：2026-10-17。

## 选型来源

采用项目已有的 Sentinel，不新增网关、重试框架或中间件。参考 GitHub 官方仓库的两种用法，并结合本项目同步 HTTP 转发适配：

- [FlowThreadDemo：并发线程数控制](https://github.com/alibaba/Sentinel/blob/1.8/sentinel-demo/sentinel-demo-basic/src/main/java/com/alibaba/csp/sentinel/demo/flow/FlowThreadDemo.java)。
- [ExceptionRatioCircuitBreakerDemo：异常比例熔断及手动异常统计](https://github.com/alibaba/Sentinel/blob/1.8/sentinel-demo/sentinel-demo-basic/src/main/java/com/alibaba/csp/sentinel/demo/degrade/ExceptionRatioCircuitBreakerDemo.java)。

## 调用链与改动

```text
登录校验和接口白名单
  → SentinelWenjingTransport：并发检查、熔断检查
  → LoadBalancedWenjingTransport：Nacos 实例选择、带超时的 HTTP 调用
  → Python
```

通过 `@Primary` 装饰已有 `WenjingTransport`，底层服务发现、身份传递、JSON、上传和正常响应保持现有方式。该改动保护面试代理链路，不扩展到独立 Feign 探测接口。

按操作分组，不把 session ID 或 query 放入资源名，避免高基数：

| Sentinel 资源 | 适用操作 | 默认单实例并发数 |
| --- | --- | --- |
| `ai:wenjing:poll` | GET 会话 question 长轮询 | 32 |
| `ai:wenjing:setup` | 简历、JD 解析及解析任务查询 | 4 |
| `ai:wenjing:read` | 其他 GET，如历史、报告、回放 | 16 |
| `ai:wenjing:write` | 创建、提交答案、跳题等其他操作 | 8 |

每组使用异常比例熔断：10 秒统计窗口，至少 20 个完成请求，异常比例超过 50% 后打开 10 秒，之后由 Sentinel 允许半开探测。参数是可调整的起始配置，不是压测容量结论。使用率很低时未满足最小样本不会打开熔断，并发上限和 HTTP 超时仍生效。

配置位于 `application.yml` 的 `ai.service.protection`，可用 `AI_SERVICE_PROTECTION_ENABLED=false` 关闭。读取超时继续使用 `ai.service.wenjing-read-timeout-ms`，默认 130000 毫秒；连接超时默认 2000 毫秒。

## 异常分类与返回

- 连接失败、找不到实例、读取超时等 IOException，以及执行中的 RuntimeException：手动记录到当前 Sentinel Entry，继续交由代理返回原有 502。
- Python HTTP 5xx：手动记录异常，但当前请求保留 Python 原状态和正文。
- Python HTTP 4xx：原样透传，不计为依赖故障；429 不触发异常比例熔断。
- Sentinel 并发拦截或熔断：不请求 Python，不计为上游失败，返回 503、中文提示、请求 ID、`Retry-After: 3` 和 `Cache-Control: no-store`。Retry-After 为建议等待时间，不保证届时熔断已关闭。
- 正常长轮询未生成题目：维持原 pending 协议。不使用慢调用熔断，避免把正常等待 30～60 秒当成故障。

不返回虚构题目、评分或“提交成功”；原有前端错误协议仍使用字符串 `detail`。本次未增加自动重试，特别是创建会话和提交答案，通信超时不代表 Python 没有执行，仍需结合状态查询、轮次与幂等机制处理。

## 运维与边界

- 启动安装规则时保留非 `ai:wenjing:` 资源的现有规则；不会用 AI 默认规则清空题库规则。
- 这些是单 JVM 规则，不是跨 Java 实例的全局配额，也不会限制已在 Python 后台运行的模型任务。Python 仍需独立进行模型并发和成本控制。
- 规则在启动时根据配置安装。Dashboard 的临时修改不等于持久化，重启会重建 AI 规则；后续全量规则推送必须包含这四组资源，不能用不完整列表覆盖。此次未接入规则持久化数据源。
- 保留实际调用的错误响应。若 Python 以 HTTP 200 携带业务失败字段，则不会计入传输层 5xx 熔断，属于后续业务观测范围。
- 本次不重启运行中的 Java/Python 服务。代码需在重新构建并启动 Java 后生效。

## 验证

定向测试使用真实 Sentinel 规则和可控的传输替身，不连接数据库、Nacos 或真实模型。覆盖并发拒绝与释放、5xx 熔断与半开恢复、连接超时统计、4xx/429 透传、最小样本、规则保留、关闭开关、非法参数和控制器 503 契约。

使用 JDK 8，在 `mianshiya-next-backend` 运行：

```powershell
& 'D:\devEnviroment\apache-maven-3.9.4\bin\mvn.cmd' -B -ntp '-Dtest=SentinelWenjingTransportTest,WenjingProxyControllerTest' test
```

测试日志写入项目 `target/sentinel-test-logs`，避免依赖用户目录权限。测试结果见执行后的 Surefire 报告；这类定向测试不等同于真实部署压测。

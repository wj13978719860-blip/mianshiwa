# 面试蛙后端

维护者：[程序员条条](https://github.com/wj13978719860-blip/mianshiwa)

使用 JDK 8、Spring Boot 2.7.2、MyBatis-Plus、Sa-Token、MySQL、Redis、Elasticsearch、Nacos、Sentinel 和 HotKey。内部 Java 包名及服务标识保留 `mianshiya`。

## 业务与 AI 接入

- 用户注册、登录、注销、资料编辑与管理员权限。
- 题目、题库、批量关联、刷题签到与搜索同步。
- Redis 缓存、热点识别、接口保护及动态 IP 黑名单。
- `WenjingProxyController`：校验当前用户，通过白名单转发问镜请求，注入用户身份与内部凭证，保留 Java 登录体系。
- `LoadBalancedWenjingTransport`：通过 Nacos 发现 Python 服务，以 HTTP 转发面试请求。
- `AiServiceClient` / `AiModelClient`：通过 OpenFeign 调用管理员通信与模型探测接口。

正式模拟面试由独立 Python 服务处理，Java 不需要升级 JDK。原简化版面试创建与聊天入口不再作为新面试入口，旧数据库记录保留。

## 本地运行

先准备 MySQL 业务库、中间件和 HotKey 客户端依赖，具体步骤见 [项目说明](../README.md) 与 [中间件说明](../docker/README.md)。已有数据库不要重复初始化。

在项目根目录执行：

```powershell
$env:DB_PASSWORD='你的数据库密码'
./scripts/start-backend.ps1 -Build -EnableAiService
```

启动脚本可指定 Java / Maven 路径，自动读取 `.runtime/backend-private.yml`，并从 `.runtime/ai-service.env` 读取共用服务凭证与 Nacos 参数。私有文件不提交 Git。

不传 `-EnableAiService` 时关闭独立 AI 接入。启用时需另外启动 Python；两端凭证、namespace、group 与服务名必须一致。

默认 Java 端口为 `8101`，接口前缀 `/api`，接口文档：http://localhost:8101/api/doc.html。业务使用项目 `BaseResponse`，需同时检查业务 `code`，不能只看 HTTP 200。

AI 环境、独立数据库和模型配置见 [AI 服务说明](../mianshiya-ai-service/README.md)，真实验证及当前限制见 [文字面试验收](../docs/问镜文字面试补齐与验收.md)。对象存储、微信及遗留帖子相关代码不代表前端功能已经完成验收。

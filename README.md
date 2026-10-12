# 面试蛙

面试蛙是一个程序员面试刷题平台，支持题库学习、题目检索、刷题日历和 AI 模拟面试。

维护者：[程序员条条](https://github.com/wj13978719860-blip/mianshiwa)

GitHub 仓库：https://github.com/wj13978719860-blip/mianshiwa

## 功能

- 账号注册、登录、用户资料和管理员权限。
- 题库与题目管理、批量关联题目、Markdown 题目和题解。
- Elasticsearch 题目搜索与数据库同步；按题库筛选使用 MySQL。
- 刷题签到与日历记录。
- AI 生成题目和模拟面试，需配置火山引擎 Ark API Key 和可用模型。
- Redis 缓存、HotKey 热点识别、Sentinel 保护、Nacos 动态 IP 黑名单。

## 技术栈

前端：Next.js 14、React 18、TypeScript、Ant Design、Redux Toolkit。

后端：Java 8、Spring Boot 2.7.2、MyBatis-Plus、Sa-Token、MySQL、Redis、Elasticsearch、Nacos、Sentinel、etcd 与 HotKey。

## 项目结构

| 目录 | 内容 |
| --- | --- |
| `mianshiya-next-frontend` | 面试蛙前端 |
| `mianshiya-next-backend` | 后端接口与数据库脚本 |
| `scripts` | 本地启动和依赖准备脚本 |
| `docker` | 中间件构建文件与运行说明 |
| `docs` | 本地配置检查与 AI 升级需求草案 |

页面品牌为“面试蛙”。内部 `mianshiya` 包名、数据库名和服务标识保留，以兼容当前实现。

## 本地运行

需要 JDK 8、Maven、Node.js、MySQL 和 Docker。Windows 脚本中的安装路径可通过参数调整。

1. 在本机 MySQL 创建 `mianshiya` 数据库，检查 `mianshiya-next-backend/sql/create_table.sql` 后初始化表结构；已有数据库不要重复执行。`init_data.sql` 是演示数据，可选导入。
2. 准备 HotKey 客户端依赖：在项目根目录执行 `./scripts/prepare-hotkey-client.ps1`。项目不会提交依赖 JAR。
3. 启动中间件：

```powershell
docker compose up -d --build redis elasticsearch nacos sentinel
```

4. 通过环境变量提供数据库密码。共享配置中不包含真实密码。

```powershell
$env:DB_PASSWORD='你的数据库密码'
./scripts/start-backend.ps1 -Build
```

5. 在另一个终端启动前端：

```powershell
./scripts/start-frontend.ps1
```

默认开发模式支持热更新。生产模式使用 `./scripts/start-frontend.ps1 -Production -Build`。

前端：http://localhost:3000，后端接口文档：http://localhost:8101/api/doc.html。

HotKey 服务还需准备本机 etcd、worker 和 dashboard，详见 [中间件说明](docker/README.md)。目前后端启用了这些连接；仅启动基础服务不能代表全部增强功能已就绪。[本地配置记录](docs/本地启动与配置检查.md)记录维护者机器的运行情况，并非所有机器的默认值。

## 配置

| 环境变量 | 用途 |
| --- | --- |
| `DB_PASSWORD` | MySQL 密码 |
| `REDIS_PASSWORD` | 使用带认证的 Redis 时设置 |
| `ES_PASSWORD` | 使用带认证的 ES 时设置 |
| `AI_API_KEY` | 火山引擎 Ark API Key |
| `COS_ACCESS_KEY` / `COS_SECRET_KEY` | 可选对象存储凭据 |
| `WX_MP_SECRET` / `WX_MP_TOKEN` / `WX_OPEN_SECRET` | 可选微信功能凭据 |
| `SENTINEL_CLIENT_IP` | Docker 控制台回连后端的宿主机 IPv4 |

MySQL 用户名、地址及可选模型、对象存储、微信参数仍需按实际环境调整。维护者的本机数据库配置位于被忽略的 `.runtime/backend-private.yml`，启动脚本会自动读取；这些本地文件不随仓库发布。

## 当前限制

- AI 升级需求仍是草案，Agentic RAG 尚未实现。
- COS、微信以及遗留帖子模块未完成可用性验收。
- Next.js 现有配置跳过 TypeScript 构建检查，构建成功不代表所有类型问题已解决。
- Docker Compose 用于本地开发，不是生产部署方案。

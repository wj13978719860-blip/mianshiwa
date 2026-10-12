# 本地中间件 Docker Compose

使用根目录 `compose.yaml`。MySQL 保留本机现有服务和数据，Compose 不包含 MySQL。

## 本次验证状态（2026-10-11）

- Compose 配置校验通过。
- Redis 容器已启动，PONG，健康状态正常。
- etcd 已迁移到 Windows 本机 3.5.15（2379），endpoint health 成功。原容器停止、restart=no，快照和原数据卷保留；Compose 默认不再启动 etcd。
- Nacos 已通过本机 2.5.2 JAR 与缓存的 Java 8 镜像构建并启动，控制台 HTTP 200，readiness 返回 OK，容器 healthy。
- Sentinel 已通过本机 1.8.6 JAR 与缓存的 Java 8 镜像构建并启动，控制台 HTTP 200。
- 后端接入已验证：Nacos 配置变更可动态拦截测试 IP，移除后恢复访问；测试后黑名单为空。Sentinel 已收到 `mianshiya-next-backend` 心跳，机器 healthy，控制台可读取两条熔断规则，容器反向访问客户端成功。
- 修复接入暴露的问题：黑名单错误内存容量、Sentinel 初始化早于自动配置、慢调用阈值颠倒、首次缺少本地规则文件导致规则清空。Java 8 打包及黑名单回归测试通过。
- Elasticsearch 7.17.4 官方镜像已下载并启动，端口 9201，集群 mianshiya-es，容器 healthy，集群 green；临时索引写入、搜索、删除验证通过。原项目 zhiguang-es 9.2.2 继续使用 9200。
- HotKey 官方 Gitee `master-v0.0.4` 分支已构建 worker 和 dashboard，通过 cmd 启动。worker Netty 11113、HTTP 8082；dashboard 页面 8081、Netty 11112。已验证登录、worker 展示、规则读取、真实 `bank_detail_1` 热点推送和记录查询。
- MySQL 保留宿主机；后端已切换 Docker Redis 6380 和 ES 9201，并连接 Nacos、Sentinel。前后端继续在宿主机运行。

本次下载网络较慢，部分镜像层一分钟只下载约 1～3 MB。代理曾返回 403／502。

### 本机已成功的启动方式

```powershell
.\scripts\prepare-sentinel.ps1
.\scripts\prepare-nacos.ps1
docker compose -f compose.yaml -f compose.local-runtime.yaml up -d --build redis nacos sentinel elasticsearch
docker compose -f compose.yaml -f compose.local-runtime.yaml ps

# Windows cmd 中分别启动本机 etcd、HotKey worker 和 dashboard
cmd /d /c scripts\start-etcd.cmd
cmd /d /c scripts\start-hotkey-worker.cmd
cmd /d /c scripts\start-hotkey-dashboard.cmd
```

`compose.local-runtime.yaml` 使用本机已缓存 Apache RocketMQ 官方镜像中的 Temurin Java 8 运行时，Dockerfile 覆盖 ENTRYPOINT，仅启动 Nacos／Sentinel，不启动 RocketMQ。本地 Nacos 为 2.5.2，与默认官方镜像方案 2.4.3 有区别。它是下载受限时的本地替代方案，镜像包含额外组件，不作为生产基础镜像推荐。

本地 Java 8 的 cgroup-v2 指标读取有兼容问题，Nacos 的本地 Dockerfile 禁用 JVM 容器自动探测并显式限制堆大小后已验证启动。标准 Java 基础镜像下载正常后可恢复默认 Compose 方案。

本机 ES 启动命令：`docker compose -f compose.yaml -f compose.local-runtime.yaml up -d --no-deps elasticsearch`。官方 7.17.4 内置 JDK 在当前 Docker Desktop 的 cgroup-v2 布局下启动失败，因此本机覆盖文件通过 `JDK_JAVA_OPTIONS=-XX:-UseContainerSupport` 禁用 JVM 容器自动探测，堆大小仍显式限制为 512 MB。官方启动脚本会忽略 `JAVA_TOOL_OPTIONS`，不可用它替代此参数。`compose.mirror.yaml` 的代理此前返回 403，本次使用官方镜像，不需要叠加它。

## 启动

在项目根目录执行：

```powershell
# Sentinel JAR 已从本机安装目录复制到构建目录。
# 在另一台机器上需要先准备 JAR：脚本优先使用本机已有文件，否则下载官方 GitHub release。
.\scripts\prepare-sentinel.ps1
docker compose up -d --build
docker compose ps
```

只启动指定服务：

```powershell
docker compose up -d redis
docker compose up -d elasticsearch nacos
docker compose up -d --build sentinel
```

如果 Docker Hub 无法连接，可尝试更换 Sentinel 基础镜像来源，不改变 Docker Desktop 的全局配置：

```powershell
$env:SENTINEL_JAVA_IMAGE='docker.m.daocloud.io/library/eclipse-temurin:8-jre'
docker compose up -d --build sentinel
```

镜像代理也可能不可用，不能保证解决网络问题。默认配置仍采用官方镜像来源。全部版本为旧项目本地兼容验证而选择，未进行生产版本安全与升级评估。

## 地址与用途

| 服务 | 宿主机地址 | 说明 |
|---|---|---|
| Redis 7.2.15 | 127.0.0.1:6380 | 固定镜像摘要，AOF 与命名卷持久化 |
| Elasticsearch 7.17.4 | http://localhost:9201 | 本项目独立实例 mianshiya-es；匹配 Spring Boot 2.7.2 客户端，单节点、关闭安全认证 |
| Nacos 2.4.3 | http://localhost:8848/nacos | 单机、内置存储；配置与日志使用命名卷；客户端 gRPC 映射 9848 |
| Sentinel 1.8.6 | http://localhost:8858 | 自行构建控制台；默认登录 sentinel / sentinel |
| etcd 3.5.15（本机） | http://localhost:2379 | 官方 Windows 二进制；scripts/start-etcd.cmd；数据在 .runtime/etcd-host |
| HotKey worker 0.0.4（本机） | Netty 11113 / HTTP 8082 | scripts/start-hotkey-worker.cmd |
| HotKey dashboard 0.0.2（本机） | http://127.0.0.1:8081/user/login；Netty 11112 | scripts/start-hotkey-dashboard.cmd；本地登录 admin / 123456 |

Docker 映射端口、etcd 和 dashboard HTTP 页面绑定本机回环地址；HotKey Netty 端口按官方实现监听所有网卡。此配置不用于公网部署。Nacos 和 etcd 没有启用认证，ES 没有启用安全认证。建议 Docker 分配至少 4 GB 内存，本机当前约 8 GB。

## 与后端连接

容器启动不等于后端增强能力已经启用。现有后端和前端继续在 Windows 宿主机运行：

- MySQL 配置保持原样。
- 后端和 Redisson 已使用 Redis 6380、database=1、无密码。切换前检查原 127.0.0.1:6379 的 database=1 为空，没有迁移 Redis 数据；原实例未停止。
- 后端 ES 已使用 localhost:9201 并移除占位认证。启用 QuestionEsDTO、全量/每分钟增量同步，已同步 20 道题。题目搜索入口走 ES；带 questionBankId 的请求保留 MySQL，因为现有 ES 文档没有题库关联。tags 使用 keyword 映射，ES 分页返回正确的 current/size。帖子 ES 模块未启用，当前使用标准分词器，未安装 IK。
- Nacos 使用 `mianshiya` / `DEFAULT_GROUP` 配置，初始内容为 `blackIpList: []`。后端默认开启配置预加载及动态黑名单监听；黑名单使用精确集合匹配。不要在该配置中意外覆盖数据库等业务配置。
- 后端已配置 Sentinel 控制台 `127.0.0.1:8858`，主动初始化客户端。Sentinel 1.8.6 只接受数值 IP，因此上报 `192.168.65.254:8719`（本机容器内 `host.docker.internal` 的 IPv4）。其他机器可通过环境变量 `SENTINEL_CLIENT_IP` 覆盖，使用 `docker compose exec sentinel getent ahostsv4 host.docker.internal` 核对。访问带 Sentinel 保护的题库列表接口后可查看资源。
- etcd 和 HotKey worker 都在宿主机运行；worker 注册地址为 127.0.0.1:11113，应用为 mianshiya。原 etcd 容器保留为备份，位于 docker-etcd-backup profile，默认 up 不会启动。

## HotKey 状态

lib 中的 hotkey-client JAR 是客户端依赖，没有 Main-Class，不能独立启动。原文件未替换。worker 从官方 Gitee 仓库 https://gitee.com/jd-platform-opensource/hotkey 的 master-v0.0.4 分支构建，提交 f1c81819c7dcc7cf3421f556698e0fbebd244641，源码位于 .runtime/hotkey-src，可执行 JAR 位于 .runtime/hotkey。

规则位于本机 etcd 的 /jd/rules/mianshiya：bank_detail_ 前缀，10 秒内达到 50 次判为热点，缓存 60 秒。dashboard 已连接本机 etcd 和 worker，原 Dashboard ip is null 提示已消失。65 次真实题库详情读取在约 1.4 秒内完成，已在热点记录和实时热点接口查到 bank_detail_1。

dashboard 地址：http://127.0.0.1:8081/user/login，账号 admin，密码 123456，应用选择 mianshiya。使用独立 MySQL 管理库 hotkey_mianshiya，不修改面试题库 mianshiya。数据库连接配置保存在忽略目录 .runtime/hotkey/dashboard-local.yml；只为 dashboard 连接会话移除 ONLY_FULL_GROUP_BY，不改变 MySQL 全局模式。日志为 .runtime/hotkey-dashboard.log 和 .runtime/hotkey-dashboard-error.log。

dashboard 的 0.0.2-SNAPSHOT 版本号来自官方 master-v0.0.4 分支，依赖 common 0.0.4，与当前 worker 配套。重建时在 .runtime/hotkey-src 使用 JDK 8 执行 mvn -Dmaven.test.skip=true -pl common,dashboard -am package，再将 dashboard/target/dashboard-0.0.2-SNAPSHOT.jar 复制到 .runtime/hotkey。启动脚本依赖该 JAR 和本地数据库配置；这些忽略文件不会随仓库复制到其他机器。

重建 worker（JDK 8、Maven）：在 .runtime/hotkey-src 执行 mvn -DskipTests -pl common,worker -am package，再将 worker/target/worker-0.0.4-SNAPSHOT.jar 复制到 .runtime/hotkey。此次 Maven 镜像下载较慢，构建临时使用 .runtime/hotkey-settings.xml 指向 Maven Central，没有更改全局 Maven 配置。

## 检查与停止

```powershell
docker compose ps
docker compose logs --tail 80 nacos
docker compose exec -T redis redis-cli ping
.\.runtime\tools\etcd-v3.5.15-windows-amd64\etcdctl.exe --endpoints=http://127.0.0.1:2379 endpoint health
Invoke-RestMethod http://localhost:9201/_cluster/health
Invoke-WebRequest http://localhost:8848/nacos/v1/console/health/readiness
Invoke-WebRequest http://localhost:8858

# 停止容器，保留数据卷
docker compose down
```

不要添加 `down -v`，该参数会删除中间件数据卷。Sentinel 构建 JAR 被已有 `*.jar` 规则忽略，不应把大二进制文件提交到代码仓库。

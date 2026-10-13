# 面试蛙 AI 面试阶段 0：恢复与 ES 检索验收

日期：2026-10-12

## 范围和结果

这是面试替换前的基础适配验证。使用既有 MySQL 与 ES，未引入 PostgreSQL、pgvector 或 Chroma，也未切换原模拟面试入口。

| 项目 | 实际结果 |
| --- | --- |
| 依赖 | LangGraph 1.2.14、社区 langgraph-checkpoint-mysql 3.0.0、PyMySQL 1.2.3；独立虚拟环境及哈希锁文件 |
| 数据库 | 本机 MySQL 8.0.44；新建独立验证库 `mianshiwa_ai_probe`，未改原业务库 |
| 正常恢复 | 一个进程出题并中断退出，另一个进程读取相同题目，再由新进程恢复回答并完成 |
| 异常退出 | 使用 os._exit 强制退出后，新进程仍能恢复等待位置 |
| 连接故障 | 数据库连接断开时错误明确传播，清理不会以重复关闭异常掩盖原错误 |
| 事务故障 | 检查点事务先写 blob，再使检查点 SQL 失败；错误可见，blob 回滚，原待答状态可恢复 |
| 检索 | 真实 ES 7.17.4：中文 BM25、dense_vector/script_score 与独立两路召回的 RRF 融合通过 |
| 测试数据 | ES 每次创建唯一临时 AI 索引，验收后删除；MySQL 验证库保留测试检查点用于排查 |

基础及原有 AI 接口测试 45 项通过，真实 MySQL/ES 集成测试 3 项通过，共 48 项。基础测试命令默认跳过这 3 项外部集成测试。测试中出现上游 Starlette/AnyIO、Nacos/Pydantic 弃用警告，未影响本次通过结果。

本次图不调用模型，不生成真实评分；测试向量是 3 维人工固定值，仅证明 ES 查询路径可用。没有验证真实 Embedding、全量题库召回质量、高并发性能、业务 commandId 幂等或多实例接管，不能把图的重复空推进当作完整业务幂等验收。

## 新增模块说明

| 文件 | 用途 |
| --- | --- |
| `app/interview/checkpoints.py` | 环境配置、MySQL 检查点连接、显式初始化，失败不回退内存 |
| `app/interview/recovery_probe.py` | 三节点试验图：出题、等待、记录完成；为恢复验证服务 |
| `app/knowledge/elasticsearch.py` | 独立 AI 索引、BM25、向量查询及 RRF 排序；不负责生成 Embedding |
| `tests/test_workflow.py`、`tests/test_knowledge.py` | 无外部服务的流程及检索边界测试 |
| `tests/integration/` | 跨进程 MySQL 恢复、事务故障和真实 ES 查询 |
| `scripts/verify-ai-foundation.ps1` | 可重复验收，使用独立 `.runtime/ai-workflow-venv` |

这些模块暂未挂到 FastAPI 业务路由，原 Java→Python 问答接口继续使用现有服务环境。SQLAlchemy 尚未加入，后续定义正式业务表时再接入。

## 重复执行

基础测试不连接 MySQL、ES 或真实模型：

```powershell
./scripts/verify-ai-foundation.ps1 -Prepare
```

真实验收需使用独立验证数据库（建库由部署者执行，脚本只初始化检查点表）：

```sql
CREATE DATABASE IF NOT EXISTS mianshiwa_ai_probe CHARACTER SET utf8mb4;
```

将以下配置放到被 Git 忽略的 `.runtime/ai-foundation.env`，使用有权维护该验证库的账号。密码不应写入源码、终端参数或日志。

```dotenv
AI_MYSQL_HOST=127.0.0.1
AI_MYSQL_PORT=3306
AI_MYSQL_DATABASE=mianshiwa_ai_probe
AI_MYSQL_USER=填写本地验证账号
AI_MYSQL_PASSWORD=填写本地密码
AI_ES_URL=http://127.0.0.1:9201
```

```powershell
./scripts/verify-ai-foundation.ps1 -MySql -Elasticsearch
```

检查点依赖要求 MySQL >= 8.0.19 或 MariaDB >= 10.7.1。本项目只验收了 MySQL 8.0.44。该 Saver 为社区组件，升级时须重新运行恢复与故障用例，不能把本次局部验收当作生产可靠性保证。

## 接下来的开发

正式一轮面试需要继续实现业务表和命令生命周期、用户归属、题目/评分标准快照、真实模型的结构化评价、Java 接口和原面试页面替换。把 commandId、会话版本与恢复窗口纳入验收后，才允许正式入口切换。

ES 暂用内置 cjk 分析器验证中文检索，不安装额外插件；后续用真实技术题对比中文分词效果。向量维度由 Embedding 模型决定，每个索引绑定模型及版本；现有 7.17 路径支持最多 2048 维，超限需选模型或重新评估 ES 版本，禁止截断补零。

当前向量查询属于对过滤后候选文档的精确脚本评分，成本随候选量增长。接入真实数据后再评估查询过滤、延迟与召回，按证据决定是否升级。

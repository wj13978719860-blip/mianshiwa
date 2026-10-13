# 项目来源与第三方组件

面试蛙由程序员条条 / pickyo 维护，项目仓库：https://github.com/wj13978719860-blip/mianshiwa 。本项目基于程序员鱼皮的面试刷题教学项目修改，原代码中的作者署名保留。维护者于 2026-10-12 确认已取得公开源码授权；本仓库未替原作者或第三方组件新增再许可条款。

- 原项目参考：https://github.com/liyupi/mianshiya-next
- HotKey 官方源码：https://gitee.com/jd-platform-opensource/hotkey ，使用 `master-v0.0.4` 分支的 `f1c81819c7dcc7cf3421f556698e0fbebd244641` 提交。
- Spring Boot、Next.js、React、Ant Design、Sa-Token 及其他依赖的许可，参见各自官方仓库和发行包。

依赖二进制、本地数据库、私密配置和运行日志不包含在源码仓库中。

## 问镜（Agentic_Interviewer）

AI 面试引擎移植自 [Agentic_Interviewer](https://github.com/liuhan-agent/Agentic_Interviewer)，固定提交 `0c64377b7758d3bf12ac51073d9b92246f1dc669`。Copyright (c) 2026 Liu Han，MIT License；完整许可位于 `mianshiya-ai-service/licenses/Agentic_Interviewer-MIT.txt`。

- `mianshiya-ai-service/app/wenjing/` 来自上游 `ai-interviewer/backend/app/`，`mianshiya-ai-service/wenjing/knowledge/` 和 `wenjing/tests/` 分别来自上游 `backend/knowledge/` 和 `backend/tests/`。
- 由 `scripts/sync-wenjing.py` 同步，只做包前缀和目录路径的机械改写；脚本中 `ADAPTED` 名单内的文件为面试蛙适配实现（MySQL、Elasticsearch、MySQL checkpointer、网关鉴权），`python scripts/sync-wenjing.py --check` 可核对其余文件与上游一致。
- `mianshiya-next-frontend/src/wenjing/` 中的接口客户端、轮询与本地存储逻辑移植自上游 `ai-interviewer/frontend/src/lib/`，页面 UI 为 Ant Design 重写。
- 当前岗位方向资料位于 `mianshiya-ai-service/wenjing/knowledge/interview_directions.json`，来自上游同名知识文件；旧简化版 `app/interview/` 已移除。

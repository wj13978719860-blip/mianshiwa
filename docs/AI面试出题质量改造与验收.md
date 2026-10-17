# AI 面试出题质量改造与验收

日期：2026-10-13。问镜基准仍为 `0c64377b7758d3bf12ac51073d9b92246f1dc669`，未升级或替换整个面试引擎。

## 对应问题与改动

| 问题 | 改动 | 文件 |
| --- | --- | --- |
| 同一简历总从同几个亮点出题 | 摘要保持事实稳定，完整重点池从最多 6 扩为 12；同一候选池优先考察个人历史中较少使用的重点；不随机改写经历 | `services/resume_parser.py`、`services/resume_parse_cache.py`、`engine/resume_plan.py` |
| 多场面试重点固定 | 从现有 MySQL 会话及问答事实读取认证用户最近 200 条使用记录，仅返回重点计数，不混进本场 `qa_history` | `services/resume_focus_history.py`、`api/v1/interview.py` |
| B 端管理项目被问订单积分 | 注入种子前检查当前重点、技术用途和项目业务是否适配；未知或无匹配种子不注入。种子兜底不再拼接项目名，明确独立假设 | `services/interview_quality.py`、`workflow/nodes/ask_question.py`、`agents/generator.py` |
| 同场题目换措辞重复 | 新题不再复用已注入的同一 seed 的其他 variant；生成后审核考点与场景是否重复，不能只依赖字符串相等 | `services/question_selector.py`、`services/interview_quality.py` |
| 普通 refine 换重点或再问整套设计 | 锁定父题简历锚点及技能；不重新注入种子；从评价中选择一个缺口，审核追问是否聚焦 | `workflow/nodes/ask_question.py`、`agents/prompts/generator_task.md` |
| 改题后仍使用旧模板评分 | 重写同步清除旧种子锁定条款、编译/审核条款及归因标记，最终使用新题的评分草案 | `agents/generator.py`、`workflow/nodes/ask_question.py` |
| 设置页只显示固定六项 | 展示最多 12 项并说明每场依据岗位和个人历史选重点；保留原 Ant Design 风格 | 前端 `components/setup/components.tsx` |

关键新增及修改逻辑有中文注释。适配文件已登记在 `scripts/sync-wenjing.py`，以后机械同步问镜不会覆盖。

## 运行和故障边界

- 默认 `ENABLE_INTERVIEW_QUALITY_GUARD=true`。设为 `false` 可做旧流程对照，种子去重与安全假设兜底仍保留。
- 非追问题可能增加种子适配与题目审核两次模型调用；追问不审核新种子。审核单次超时 15 秒，无应用/SDK 自动重试；不合格题最多重写一次。
- DeepSeek 质量审核显式关闭思考模式；普通生成和评分仍使用原配置。参数依据 [DeepSeek 官方接口](https://api-docs.deepseek.com/api/create-chat-completion/) 的 `thinking.type=disabled`，没有另加 SDK。
- 审核异常或两次题目均不合格时，退到真实重点的具体证据/单个回答缺口。题目和条款一起更新，Trace 标记 `evidence_fallback`，不假装审核通过。
- 管理员原始 Trace 的 `selection_artifacts.seed_grounding` 记录模板适配结果，`selection_artifacts.quality_review` 记录事实、语义重复、追问和评分校验结果，`anchor_scheduler.history_status/historical_attempts` 记录跨场轮换依据。普通用户的 Trace 仍沿用原有脱敏投影，不扩大内部字段访问权限。
- 跨场记录读取失败标记 `unavailable`，使用本场调度。历史按重点名称和项目名称匹配，改写重点名称可能降低匹配率；只扫描最近 200 条。
- 解析版本已更新，旧 Redis 解析缓存自然失效。已存的浏览器草稿和旧场次不会被自动改写；要使用扩大后的重点池，重新上传解析后新开面试。
- 去重和业务校验包含模型判断，不能承诺所有语义错误绝对为零；有 Trace 依据及受控降级，后续可用真实失败样例补回归。

## 验证

- 后端定向回归：290 passed、1 skipped。新增质量组 26 项显式启用新功能；上游兼容回归关闭质量模型调用，以免旧模型 Mock 被新审核协议误判。窄范围 API 测试先初始化独立 SQLite，未连接生产库。
- 全项目 TypeScript 类型检查通过；前端用户草稿/幂等键 7 项、历史恢复 6 项回归通过。
- 前后端同步检查：0 unexpected differences；适配差异单独登记。
- DeepSeek Flash 真实调用（合成资料，不创建测试用户或面试）：导出重点下的 MQ 订单积分种子被拒绝；两道 Redis 整体不可用题判定为重复；恢复指标与阈值追问通过；真实生成的聚焦追问及其评分条款通过审核。
- 审核显式关闭思考后，本次样例审核约 1.1～2.7 秒，非性能保证。最初发现思考 token 导致审核截断，已用官方非思考开关修复并复测。
- 运行服务已重新拉起：`/health/live` 返回 alive、`/health/ready` 返回 ready/registered；Nacos 8102 实例 healthy/enabled，前端历史页 HTTP 200。原有 7 场中断会话恢复，无缺失检查点。

本次没有新增中间件、向量模型或表结构；未提交或推送 GitHub。

## 跳过开场显示重复的修复

- 原因：旧跳题记录只在嵌套 current_question 保存 self_intro 类型，恢复接口默认将其作为正式第 0 轮，页面把同一开场显示两次。实际下一题并非重复的自我介绍。
- 修复：跳题记录补齐题型；恢复兼容旧嵌套类型，跳过的开场单独返回且无正式题评分。新场次跳过开场标记阶段完成，不扣正式题预算。
- 验证：开场跳过、旧 checkpoint、正式跳题及历史恢复共 12 项回归通过。没有改写用户原始问答或 checkpoint；已有场次刷新即可使用修正后的恢复投影。

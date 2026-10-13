# 面试蛙 AI 模拟面试：问镜功能对齐开发规格 v0.2

日期：2026-10-12。状态：第一批业务代码已实现，完整对齐尚未完成。实现边界与测试见 [第一批实现与验收](AI面试问镜对齐-第一批实现与验收.md)。

## 1. 目标、依据与交付边界

替换现有 AI 模拟面试，用户只有一个入口。对齐问镜的模拟面试能力与操作流程，保留面试蛙主题、现有账号体系、Java 8、Nacos/OpenFeign、Python/FastAPI、LangGraph、MySQL 和 Elasticsearch。不因适配技术栈自行删减功能。

上游固定版本：`liuhan-agent/Agentic_Interviewer@0c64377b7758d3bf12ac51073d9b92246f1dc669`。以下相对路径均属于该版本的 `ai-interviewer`：

- `frontend/src/components/interview/SetupForm.tsx`：方向、候选人、岗位三步设置，5/8/12 轮深度选项。
- `frontend/src/components/interview/InterviewRoom.tsx`：自我介绍、项目关联、提示、跳过、重试、报告跳转。
- `backend/app/api/v1/interview.py`：设置、解析、面试命令、恢复、报告、回放、删除、反馈和轨迹。
- `backend/app/engine/workflow/langgraph_workflow.py`：画像、自我介绍、导演、评价、验证、追问、报告和训练节点。
- `backend/app/engine/contracts/seed_contract.py`：题目种子必答点和最低要求。
- `backend/app/engine/workflow/nodes/ask_question.py`：题目筛选、项目关联、知识检索和评分合同是不同环节。
- `backend/app/engine/workflow/nodes/director_sample.py`、`reward_update.py`、`experience_extractor.py`：策略采样、奖励更新和经验提取。

已完成源码核查，尚未运行上游完整系统。不能把源码节点存在当成上游线上效果或本项目能力已经通过验收。进入开发前保存上游关键页面与操作基线；上游不可运行时记录阻断项，继续可独立验证的适配，不宣称体验一致。

已有通信、鉴权、幂等、MySQL 检查点和简化面试是可复用基础。全功能上线前使用版本化工作流；简化版历史可查看，不能直接用新图恢复旧检查点。

## 2. 功能、页面和接口映射

下表接口是面试蛙拟新增的公开 Java 契约，不表示当前已有。统一前缀 `/api/ai/interviews`，记作 `P`；Python 内部前缀 `/internal/v1/interviews`，记作 `I`，除配置目录来源外，桥接保持相同后缀。

| 上游能力/接口 | 面试蛙页面或组件 | Java API 目标/适配 | 实现状态 |
| --- | --- | --- | --- |
| directions、dimensions、job-template、waiting-tips | 设置第一、三步及等待状态 | GET `P/catalog`；目录内包含模板，等待提示待补齐 | 目录/模板已实现，分组及等待提示待补 |
| resume/parse、resume/parse-jobs、任务查询 | 设置第二步上传/粘贴、解析进度 | POST `P/setup-jobs` kind=resume；GET `P/setup-jobs/{id}` | 第一批实现并真实验收 |
| 简历画像预览编辑、jd/parse | 画像编辑、岗位第三步 | POST `P/setup-jobs` kind=jd；GET `P/setup-jobs/{id}`；PUT `P/setup-drafts/{id}` 待开发 | 解析及浏览器画像编辑已实现，服务端草稿待补 |
| sessions 创建 | 设置第三步开始 | POST `P` | 已有简化创建，需升级 |
| question、metadata、resume | 面试房间与历史继续 | GET `P/{id}` | 已有简化查询，需升级 |
| answer、skip-question、retry-question、结束 | 房间操作栏 | POST `P/{id}/commands` | 已有 answer/skip/end/retry，需升级 |
| hint | 房间提示按钮、提示记录 | 同 commands，新增 action=hint | 待开发 |
| recover | 房间故障恢复 | 同 commands，新增 action=recover | 有重启处理基础，需补契约 |
| setup-snapshot | 回看设置、再练一场预填 | GET `P/{id}/setup-snapshot` | 待开发 |
| report、training_plan | `/mockInterview/report/[id]` | GET `P/{id}/report` | 已有简化报告，需独立路由与完整结构 |
| replay | 报告轮次回放 | GET `P/{id}/replay?cursor=&limit=` | 有基础 turns，需补分页与结构 |
| account/interview-sessions | 面试记录 | GET `P?cursor=&limit=&status=` | 已有基础历史，需升级 |
| DELETE sessions | 历史删除及确认 | DELETE `P/{id}`，携带 commandId/expectedVersion | 待开发 |
| sessions/feedback | 报告反馈表单 | POST `P/{id}/feedback` | 待开发 |
| trace | 管理员面试诊断 | GET `P/{id}/trace`，管理员授权 | 待开发 |

统一 catalog 返回方向分组、方向关联维度、岗位级别、深度配置、等待文案及 `catalogVersion`。目录必须覆盖上游基准版本的选项，并保留稳定 ID；不能仅用 Java/前端/Python 三个按钮替代。

### 其他上游能力映射登记

| 能力 | 适配要求 | 验收/配置状态 |
| --- | --- | --- |
| 登录、用户资料、会话归属 | 复用现有 Java 登录；所有设置草稿、解析任务和面试均绑定本人 | 既有登录可用，新增对象隔离待验收 |
| 匿名会话及 claim | 保留为待适配能力；若需改变现有登录前置规则，单独说明方案，不默认忽略 | 方案待细化 |
| BYOK、模型设置 | 核对上游页面能力；内部服务凭证与用户模型 Key 分开，Key 不进入公开快照/回放 | 待适配；当前只有平台配置 |
| 语音、题目播报、voice-ticket/WebSocket | Java 鉴权后签发短期凭据；Feign 负责 HTTP 控制，实时音频需 WebSocket 网关路由 | 待适配；ASR/TTS 能力与配置待核实 |
| 视频分析 | 核查设置开关、实际模型与展示链路，不能仅添加开关宣称完成 | 待核实与适配 |
| 额度、额度申请、管理员运营 | 与面试蛙现有管理功能逐项映射，不能把存在管理员登录当成具备额度功能 | 待适配 |
| 策略管理与后台聚合 | 独立任务及管理员可观测接口 | 待开发 |

本表是已核查能力登记，不声称是所有上游页面的穷尽列表。实施阶段 0 必须补齐其余页面、接口及配置清单；待核实项不能从最终交付中静默消失。

## 3. 公开契约与对象

### 通用规则

Java 对外沿用 `{code,data,message}` 结构，并在错误响应或响应头提供 requestId；Python 返回 `{requestId,data}` 或明确的错误码。用户身份从 Java 登录态取得，浏览器不得指定 ownerId。所有对象读写同时校验本人和内部凭证，管理员诊断另行授权。ID 使用字符串，时间使用带时区 ISO 8601。

写操作使用 UUID commandId；涉及现有对象时携带 expectedVersion。相同 commandId、相同内容返回原受理结果，不同内容冲突。回答、提示、跳过额外携带 questionId 和 turnId，拒绝旧问题的请求。后台任务受理返回 `accepted/commandId/resourceId/status/version`，不能因已受理返回“评价成功”。Java API 如保持 HTTP 200 包装，应以明确 accepted 字段表达异步语义。

错误至少区分：参数错误、未登录、对象不存在/不可访问、版本冲突、状态不允许、任务忙、文件过大、不支持文件、解析失败、模型超时/格式错误、检索不可用、持久化失败、恢复需人工处理。未知执行结果单独标记，不自动重复计费调用。前端显示可执行操作与 requestId，不展示内部堆栈或 Key。

### 数据结构

| 对象 | 必须字段与约束 |
| --- | --- |
| SetupDraft | id、version、catalogVersion、directionId、candidateProfile、jobSpec、depth、focusDimensions、knowledgeSources；分步编辑保存草稿，创建冻结快照 |
| ResumeSource | sourceId、ownerId、内容摘要、文件类型/大小、文本版本、解析器版本、提取状态；文件与解析结果只供本人使用 |
| ParseJob | id、ownerId、kind、sourceId、status、stage、progress、result、errorCode、requestId；阶段进度真实报告，不伪造精确百分比 |
| CandidateProfile | summary、skills、highlights、projects、focusAreas、concerns；每个项目含稳定 projectId、name、role、techStack、贡献、挑战和可考察锚点 |
| JobSpec | directionId、title、level、requirements、targetSkills、dimensions、focusDimensions、JD 来源及解析版本 |
| InterviewSession | id、ownerId、version、workflowVersion、setupSnapshot、status、phase、currentQuestion、progress、activeCommand、error、reportStatus |
| QuestionPrivate | questionId、turnId、kind、dimension、projectAnchor、来源题版本、questionContent、lockedContract、AskPlan、检索来源及策略信息 |
| QuestionPublic | questionId、turnId、kind、title、content、dimensionLabel、projectLabel、canHint、canSkip；不含参考答案、必答点、最低要求或内部提示词 |
| Turn | turnId、questionSnapshot、answerRaw、模型输入版本、hintEvents、skipReason、evaluation、verification、耗时/用量、status；原文与清洗/裁剪输入分别存储 |
| LockedContract | id、version、dimension、mustCover、minimumBar、acceptanceChecks、评分尺度、来源及内容摘要；出题前冻结，不随用户回答改标准 |
| Evaluation | contractId、score、dimension、passed、covered/missingAcceptanceItems、failureCategories、strengths、improvements、evidence、source、model/promptVersion |
| Verification | 检查状态、证据定位、修正项、最终评价版本；仅最终有效评价进入正式聚合和学习 |
| Report | reportVersion、status、coverage、维度分数/依据、结论、优点、薄弱点、关联 turnId、训练计划及训练状态 |

评分尺度显式保存并按上游合同核对。若前端展示百分制，记录转换规则，不继续把准确性/完整性/表达三项平均冒充多维能力评分。未考察维度标记“未覆盖”，跳过不伪造回答评价。

当前 `bankId/maxQuestions/background` 的 v1 契约仅用于旧简化会话。v2 的 knowledgeSources 为可选题库来源，directionId 是面试方向；创建输入使用已确认画像与岗位数据，不能继续让 Java 预截取前 N 题代表整场计划。

## 4. 简历、JD 和设置处理

上传支持上游已核查的 PDF、DOCX、TXT、MD，单文件上限 5 MiB；Java multipart 上限需含封装开销，Python 对文件内容单独计量。校验扩展名、内容类型和文件签名，DOCX 限制解压大小与条目，不能只信任文件名。扫描 PDF 提取不到文本时明确提示改用文本或补充 OCR，当前不能承诺 OCR 已可用。

粘贴文本拟限制 30,000 字符，JD 12,000 字符；这是面试蛙初始输入预算，并非上游实测极限。超限显示限制，不静默截断。画像采用上游边界作为初始契约：技能最多 40 项、项目最多 12 个、每项目考察锚点最多 8 个、简介最多 1,200 字符。其余长度在前后端共同 Schema 中定义。

解析流程：queued → extracting → parsing → validating → succeeded，或 failed/cancelled。受理后持久化再执行，任务查询校验归属；解析缓存键包含 ownerId、内容摘要及解析版本。失败保留用户输入，可重试、重新上传或手动编辑。手动路径必须标记来源和完成必要字段，不以虚构解析结果兜底。

上传在运行目录的私有存储保存，不依赖原预留 COS 文件上传接口；原文件解析成功后默认清理，失败保留最多 24 小时供重试，持久化文本与画像由用户删除或草稿清理任务清理。删除任务必须覆盖相关缓存和 ES 简历锚点。部署多实例前须改为共享私有存储，单机路径不作为多实例方案。

JD 同样异步解析，结果包括技能、岗位要求、级别建议及维度；建议需用户确认，不覆盖用户手工修改。草稿用 version 乐观锁，刷新恢复，开始面试冻结用户确认版本。

## 5. 深度、导演、选题和检索

深度基准采用上游 UI：short=5、standard=8、deep=12 个目标正式轮次。自我介绍独立计数；正式主问题与追问都占正式轮次，跳过的正式题也推进轮次。目标轮次不是保证固定问满，覆盖完成、预算耗尽、用户结束可提前完成并记录原因。

maxTurns 初始上限 20，turnBudget 上限 30，依据上游创建契约。执行预算与正式轮次分别统计；提示、格式修复及其他模型调用进入独立调用预算，不无条件生成无限追问。具体路由计数、深度追问槽位及 qualityThreshold 从上游配置提取版本化，不能凭名称自行猜测“深度”行为。

导演依据岗位、候选人画像、维度覆盖、有效评价、项目锚点、剩余预算生成 AskPlan。每轮记录 chosenAction、dimension、targetSkills、targetDifficulty、anchor、allowedActions、reasonCode、policyVersion；记录结构化决策依据，不要求模型输出隐式思维过程。

三类查询分别处理：

1. 结构化选题：按方向、技能、级别、维度、难度、已用题及评分元数据筛选题目，排除不适配候选题。
2. 简历项目关联：从当前用户冻结画像中选项目与锚点，必要时检索该用户的简历分块；不跨用户召回。
3. 知识检索：ES BM25 与真实 Embedding 向量各自召回，合并排序提供出题、评分依据或追问证据；每次记录用途、过滤、来源、版本和停止原因。

题库同步需提供分页、更新时间、删除标记与版本。Python 维护独立 AI 索引并记录同步水位；单场冻结已用来源。题目元数据含 mustCover、minimumBar、difficulty、dimension、skills，自动生成标准先标记为草稿，不冒充审核题。

ES 7.17.4 使用 dense_vector + script_score，向量维度需符合该版本限制。对话模型不充当 Embedding。Embedding 的模型、地址、Key、维度、归一化、分块和版本尚待配置与真实验证；不能用 stub 向量验收。向量不可用时明确显示检索能力状态，可在已声明的 BM25 模式下运行，不能报“混合检索成功”。没有合适题时可按上游策略生成问题及合同，并标记来源为 generated，或明确结束原因。

## 6. 工作流、提示与故障流转

```text
冻结设置 → resume_parse/已确认画像校验 → self_intro_question → wait_answer
  → self_intro_parse → director_sample → ask_question（包含冻结评分合同）
  → wait_answer → evaluator → verification → reward_update → turn_finalize
  → refine_followup/director_sample 或 final_report
  → training_plan → experience_extractor → completed
```

该图是对齐主线说明；适配时保留上游节点职责与条件路由语义，不能仅建立同名空节点。跳过不走正常评分，结束不评分占位回答，自我介绍不套技术题评分。

| 状态/阶段 | 用户操作 | 流转要求 |
| --- | --- | --- |
| preparing / parsing、planning、asking | 查询、取消/结束 | 模型和持久化完成后才能发布问题 |
| waiting_answer / self_intro | answer、skip、end | 答案用于画像补充；无内容不编造经历 |
| waiting_answer / technical | answer、hint、skip、end | 命令带版本和题目 ID；同一会话写操作串行 |
| processing / hinting | 查询 | 提示成功仍等待同一道题；提示失败不丢当前题 |
| processing / evaluating、verifying、advancing | 查询、登记 end 请求 | end 待当前安全提交点处理，不与评价并发覆盖状态 |
| reporting / report、training | 查询、受控重试 | 报告和训练分开记录，训练失败不隐藏已生成报告 |
| failed | retry/recover/end，按错误类型开放 | 不跨越未完成合同或验证；未知模型结果不盲目重放 |
| completed | 报告、回放、反馈、再练、删除 | 回答等推进命令拒绝；报告缺失单独允许修复 |
| deleting/deleted | 查询删除进度 | 终止执行归属，禁止旧 worker 写回；删除正文及关联索引 |

hint 命令只在正式题待答时允许，每次提示绑定 turnId，记录内容、次数、生成版本和用量；初始每题上限 2 次，可从上游行为核对后调整。提示不生成新正式轮次，不能自动提交回答。评价记录辅助作答事实，是否调整标准由版本化合同定义，不临时随意扣分。

retry 重试明确失败阶段；recover 恢复已有持久化检查点而非新建会话。旧图会话按 workflowVersion 路由到旧实现或只读回放。重启时 executing 命令与结果未知状态保持可见，正式存储失败不得回落内存 Saver。

上下文保存完整轮次，另建模型输入投影，按节点裁剪且保留当前题合同、关联项目、回答证据和追问缺口；不把整场题库塞入 prompt。记录输入摘要、模型、promptVersion、调用预算和实际用量。

## 7. 评价、报告与训练计划

合同在出题时锁定，包含稳定验收项 ID 和最低要求。评价逐项判断 covered/missing/uncertain，证据含 turnId、原文片段及字符位置；不存在的引用拒绝。验证先进行规则检查，再按上游配置执行必要模型复核，记录修正，不能把第二个模型视作人工真值。

多轮聚合参照上游 score_aggregation 和覆盖策略，保存 latest/best/average/adoptedScore、有效轮次数及采用原因；主问题与追问不简单当作独立用户样本重复加权。未覆盖、跳过、澄清和无效输出区分展示。最终报告及训练任务都链接到实际轮次证据。

报告独立页面展示结论、维度覆盖和分数、证据、优势、薄弱点、轮次回放、训练计划、反馈与再练。训练任务包含目标、练习动作、关联知识点/题目、完成标准和优先级；关联问题与证据能实际打开。

reportStatus 和 trainingStatus 独立为 pending/running/succeeded/failed；报告阶段失败允许按同一会话修复，不重新评分所有历史答案。用户反馈独立保存，不能直接改分或写成策略奖励真值。

## 8. 策略学习与经验数据

对齐 Thompson Sampling 的动作空间、上下文键、合法动作掩码、追问锁定、冷启动和奖励函数。单独保存策略版本及每轮采样结果，恢复不能重新采样并悄悄改变已发布题目。

拟建 MySQL 对象：`strategy_turn_facts`、`strategy_reward_events`、`bandit_posteriors`、`strategy_signals`、`strategy_memory`、`strategy_aggregation_jobs`。键分别覆盖会话/轮次/最终评价版本，奖励应用覆盖上下文键/动作/奖励事件，聚合覆盖窗口及策略版本。

流程：最终有效评价 → 持久化轮次事实和 reward event → 在事务中防重应用 posterior 更新。跳过、占位、澄清、无效评分不生成有效奖励。后验数据以持久化为权威，内存缓存仅作加速，重启可恢复。

报告后经验提取产生候选信号，独立聚合任务达到样本和置信门槛后推广到策略记忆；不能让一次模型判断直接改全局策略。模型自评分奖励只是策略信号，效果仍需人工基准验证。

开关独立：policySelectionEnabled、rewardLearningEnabled、experienceExtractionEnabled、strategyPromotionEnabled。关闭学习停止奖励更新，关闭推广只停止推广；任何开关不得仅改变 UI。学习写入失败与面试核心执行分开记录和补偿，不能重复推进用户会话。

## 9. 实施顺序和逐项验收

| 阶段 | 交付 | 必须通过的验收 |
| --- | --- | --- |
| 0 | 上游页面/接口基线、完整能力登记、v2 Schema、表迁移和图版本方案 | 每项有来源、目标、状态和测试步骤；已核查/未核查分别记录 |
| 1 | 三步设置、上传/粘贴、异步解析、画像编辑、JD、目录与岗位模板 | 支持格式、扫描 PDF、超限/伪装文件、错误恢复、刷新草稿、跨用户不可访问、编辑生效 |
| 2 | 自我介绍、画像更新、基础导演、结构化选题、合同 | 自我介绍不技术评分；岗位/方向影响计划；合同不可被作答修改；对外响应不泄露标准 |
| 3 | 评价验证、上下文、多轮追问、项目锚点、提示、真实 ES 混合检索 | 正确/错误/遗漏/提示后答案对照；伪证据拒绝；项目不编造；轮次和调用预算生效；检索来源可追溯 |
| 4 | 报告、训练、独立页、快照、分页历史、回放、删除、反馈 | 报告能追溯；未覆盖维度可见；训练失败仍可读报告；删除覆盖关联资源；重复操作防重 |
| 5 | 策略、经验、聚合和剩余上游能力 | 奖励防重复、重启恢复、开关语义、聚合门槛、语音/运营等逐项完成或明确未完成 |

所有阶段同步交付前端操作，按钮必须接入对应真实能力。最终发布要求所有约定功能完成；阶段通过不代表完整对齐通过。模型或第三方配置缺失登记为“需配置”，不当作功能已完成。

真实验收必须经浏览器 → Java → Nacos/Feign → Python → 模型/数据库/ES。另做重复命令、过期题目、并发提示和回答、用户隔离、服务重启、模型调用前后中断、落库失败、报告失败和旧版本历史兼容检查。

质量验收采用人工标注的固定正确、部分正确、错误、答非所问、项目深挖和提示后回答案例，记录题目/合同/模型/prompt 版本，检查覆盖判定、证据真实性、追问针对性与建议可执行性。上线前给每项制定可衡量门槛并报告结果，不能用合成案例分数高低代替准确性评测。

## 10. 当前配置缺口与实现状态

- 对话模型已有 deepseek-flash 配置；v2 各节点结构化输出、延迟及预算尚未真实验收。
- Embedding 模型、维度和接口尚未配置并验收；不能宣称已有向量 RAG。
- 简历解析依赖、私有文件存储和清理任务待实现；扫描 PDF 的 OCR 支持待核实。
- 语音/视频模型、实时网关及上游行为待核实；没有可用配置时记录真实缺口。
- 问镜完整运行体验尚未验证；当前仅简化版链路有历史验收记录。

本规格是最终交付目标，不把第一批实现视为完整验收。第一批已新增解析任务表并重启本机服务，尚未推送 GitHub。复用上游代码和大段提示词时保留 MIT 许可及版权，在 THIRD_PARTY_NOTICES 登记来源、版本和改动。

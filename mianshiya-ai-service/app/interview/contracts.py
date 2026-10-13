"""新面试接口契约，用户身份仅由已认证的 Java 服务提供。"""
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StrictStr, field_validator

Skill = Annotated[StrictStr, Field(min_length=1, max_length=80)]
ProfileItem = Annotated[StrictStr, Field(min_length=1, max_length=500)]


class ProjectProfile(BaseModel):
    """候选人确认后的项目；模型不得凭空添加不存在的工作经历。"""
    model_config = ConfigDict(extra="forbid")
    name: StrictStr = Field(min_length=1, max_length=120)
    role: StrictStr = Field(default="", max_length=80)
    techStack: list[Skill] = Field(default_factory=list, max_length=40)
    contributions: StrictStr = Field(default="", max_length=1200)
    challenges: StrictStr = Field(default="", max_length=1200)


class CandidateProfile(BaseModel):
    """解析与手动编辑共用的画像结构，所有内容均视作不可信资料。"""
    model_config = ConfigDict(extra="forbid")
    summary: StrictStr = Field(default="", max_length=1200)
    skills: list[Skill] = Field(default_factory=list, max_length=40)
    projects: list[ProjectProfile] = Field(default_factory=list, max_length=12)
    concerns: list[StrictStr] = Field(default_factory=list, max_length=10)

    @field_validator("skills", "concerns")
    @classmethod
    def bounded_items(cls, value):
        if any(not item.strip() or len(item) > 240 for item in value):
            raise ValueError("Invalid profile item")
        return value


class JobProfile(BaseModel):
    """岗位解析结果由用户确认；维度 ID 必须属于当前方向目录。"""
    model_config = ConfigDict(extra="forbid")
    title: StrictStr = Field(min_length=1, max_length=80)
    requirements: list[ProfileItem] = Field(default_factory=list, max_length=20)
    skills: list[Skill] = Field(default_factory=list, max_length=40)
    dimensions: list[Skill] = Field(default_factory=list, max_length=12)


class SetupJobRequest(BaseModel):
    """持久化解析任务；文件由 Java 限量读取并通过内部接口转发。"""
    model_config = ConfigDict(extra="forbid")
    commandId: UUID
    ownerId: StrictStr = Field(pattern=r"^[0-9]{1,20}$")
    kind: Literal["resume", "jd"]
    directionId: StrictStr = Field(max_length=80)
    text: StrictStr = Field(default="", max_length=30000)
    filename: StrictStr = Field(default="", max_length=200)
    fileBase64: StrictStr = Field(default="", max_length=7000000)


class QuestionSnapshot(BaseModel):
    """创建时冻结题目及参考答案；参考答案不会出现在待答题响应里。"""
    model_config = ConfigDict(extra="forbid")
    id: StrictStr = Field(pattern=r"^[0-9]{1,20}$")
    title: StrictStr = Field(min_length=1, max_length=500)
    content: StrictStr = Field(max_length=12000)
    referenceAnswer: StrictStr = Field(min_length=1, max_length=16000)
    sourceVersion: StrictStr = Field(min_length=1, max_length=100)


class InterviewCreate(BaseModel):
    """内部创建请求；Java 从本地题库读取 questions，浏览器不提供评分依据。"""
    model_config = ConfigDict(extra="forbid")
    commandId: UUID
    ownerId: StrictStr = Field(pattern=r"^[0-9]{1,20}$")
    bankId: StrictStr = Field(pattern=r"^[0-9]{1,20}$")
    bankTitle: StrictStr = Field(min_length=1, max_length=200)
    jobPosition: StrictStr = Field(min_length=1, max_length=80)
    experience: Literal["应届生", "1-3 年", "3-5 年", "5 年以上"]
    difficulty: Literal["基础", "进阶", "深入"]
    maxQuestions: int = Field(ge=1, le=20)
    allowFollowup: bool = True
    background: StrictStr = Field(default="", max_length=6000)
    jobDescription: StrictStr = Field(default="", max_length=6000)
    questions: list[QuestionSnapshot] = Field(min_length=1, max_length=100)
    # v1 默认值保持旧检查点语义；新页面显式提交 v2，进入画像和自我介绍流程。
    workflowVersion: Literal["v1", "v2"] = "v1"
    directionId: StrictStr = Field(default="java_backend", max_length=80)
    depth: Literal["short", "standard", "deep"] = "standard"
    level: Literal["junior", "mid", "senior"] = "junior"
    candidateProfile: CandidateProfile = Field(default_factory=CandidateProfile)
    jobProfile: JobProfile | None = None

    @field_validator("jobPosition")
    @classmethod
    def nonblank(cls, value):
        if not value.strip():
            raise ValueError("Job position must not be blank")
        return value


class InterviewCommand(BaseModel):
    """版本和题目 ID 共同拒绝过期页面答题，commandId 用于请求防重。"""
    model_config = ConfigDict(extra="forbid")
    commandId: UUID
    expectedVersion: int = Field(ge=0)
    questionId: StrictStr | None = Field(default=None, max_length=100)
    action: Literal["answer", "skip", "end", "retry", "hint"]
    answer: StrictStr = Field(default="", max_length=8000)


class Evaluation(BaseModel):
    """固定评分结构；引用必须能在回答原文找到，解析失败不能伪造评价。"""
    model_config = ConfigDict(extra="forbid")
    accuracy: int = Field(ge=0, le=100)
    completeness: int = Field(ge=0, le=100)
    expression: int = Field(ge=0, le=100)
    strengths: list[StrictStr] = Field(max_length=5)
    improvements: list[StrictStr] = Field(max_length=5)
    evidence: list[StrictStr] = Field(max_length=5)
    followup: StrictStr = Field(default="", max_length=1000)

"""Pydantic v2 schemas for fresh model output (not historical DB snapshots)."""
from __future__ import annotations

from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

Text = Annotated[str, Field(strict=True, min_length=1, pattern=r"\S")]
Score = Annotated[float, Field(strict=True, ge=0, le=10, allow_inf_nan=False)]
Confidence = Annotated[float, Field(strict=True, ge=0, le=1, allow_inf_nan=False)]
Verdict = Literal["yes", "partial", "no"]
BarLevel = Literal["intro", "standard", "deep_probe"]


class OutputModel(BaseModel):
    # Preserve optional evolution fields; consumed fields are declared and strict.
    model_config = ConfigDict(strict=True, extra="allow", allow_inf_nan=False)


class CheckOutput(OutputModel):
    verdict: Verdict
    evidence: list[str] = Field(default_factory=list)


class EvaluationOutput(OutputModel):
    score: Score
    passed: bool = False
    strengths: list[str] = Field(default_factory=list)
    weaknesses: list[str] = Field(default_factory=list)
    improvements: list[str] = Field(default_factory=list)
    missing_points: list[str] = Field(default_factory=list)
    rationale: str = ""
    feedback: str = ""
    acceptance_check_results: dict[str, CheckOutput | Verdict] = Field(default_factory=dict)
    rubric_coverage: dict[str, Literal["covered", "partial", "missing"]] = Field(default_factory=dict)
    recommended_next: Literal["advance", "refine"] | None = None
    recommended_next_plan: Literal["simple", "adaptive", "deep_probe"] | None = None
    recommended_probe_intent: str | None = None
    failure_reason: str | None = None
    failure_categories: list[str] = Field(default_factory=list)


class ContractOutput(OutputModel):
    must_cover: list[Text] = Field(default_factory=list)
    acceptable_if_missing: list[str] = Field(default_factory=list)
    acceptance_checks: list[Text] = Field(default_factory=list)
    rubric_points: list[Text] = Field(default_factory=list)
    minimum_bar: str = ""
    review_focus: list[str] = Field(default_factory=list)
    bar_level: BarLevel = "standard"

    @model_validator(mode="after")
    def has_criteria(self) -> ContractOutput:
        if not (self.must_cover or self.acceptance_checks or self.rubric_points):
            raise ValueError("At least one scoring criterion is required")
        return self


class QuestionOutput(OutputModel):
    question: Annotated[str, Field(min_length=1, pattern=r"\S")]
    dimension: str = ""
    rationale: str = ""
    rubric_points: list[Text] = Field(default_factory=list)
    proposed_contract: ContractOutput | None = None


class VerificationOutput(OutputModel):
    verdict: Literal["pass", "partial", "fail"]
    confidence: Confidence
    reasons_to_doubt: list[str] = Field(default_factory=list)
    would_ask_next: str = ""
    rationale: str = ""


class GuardOutput(OutputModel):
    allowed: bool
    categories: list[str] = Field(default_factory=list)
    reasons: list[str] = Field(default_factory=list)
    redacted_text: str = ""


class SeedReviewOutput(OutputModel):
    variant_id: Text | None
    reason: str = ""


class QuestionReviewOutput(OutputModel):
    grounded: bool
    duplicate: bool
    focused_followup: bool
    contract_aligned: bool
    reason: str = ""


class ResumeProjectOutput(OutputModel):
    id: str = ""
    name: str = ""
    role: str = ""
    tech_stack: list[str] = Field(default_factory=list)
    responsibilities: list[str] = Field(default_factory=list)
    achievements: list[str] = Field(default_factory=list)
    question_anchors: list[str] = Field(default_factory=list)


class ResumeFocusOutput(OutputModel):
    id: str = ""
    label: str = ""
    project_id: str | None = None
    dimensions: list[str] = Field(default_factory=list)
    skills: list[str] = Field(default_factory=list)
    priority: int = Field(default=1, ge=0)


class ResumeOutput(OutputModel):
    candidate_name: str = ""
    candidate_profile: dict[str, Any] = Field(default_factory=dict)
    summary: str = ""
    skills: list[str] = Field(default_factory=list)
    highlights: list[str] = Field(default_factory=list)
    projects: list[ResumeProjectOutput] = Field(default_factory=list)
    focus_areas: list[ResumeFocusOutput] = Field(default_factory=list)
    concerns: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def has_resume_fields(self) -> ResumeOutput:
        if not self.model_fields_set.intersection(type(self).model_fields):
            raise ValueError("At least one resume field is required")
        return self


class JobOutput(OutputModel):
    required_skills: list[str]
    rubric_dimensions: list[Text]
    suggested_level: Literal["junior", "mid", "senior", "staff", "principal"] | None = None
    rationale: str = ""
    unmapped_requirements: list[str] = Field(default_factory=list)


class IntroAnchorOutput(OutputModel):
    kind: Literal["project", "responsibility", "tech", "difficulty", "result", "claim"]
    title: str = ""
    text: Text
    tech_keywords: list[str] = Field(default_factory=list)


class IntroCommunicationOutput(OutputModel):
    structure: str = ""
    notes: list[str] = Field(default_factory=list)


class SelfIntroOutput(OutputModel):
    summary: str = ""
    emphasized_projects: list[str] = Field(default_factory=list)
    emphasized_skills: list[str] = Field(default_factory=list)
    preferred_focus: list[str] = Field(default_factory=list)
    clarification_targets: list[str] = Field(default_factory=list)
    communication_signal: IntroCommunicationOutput = Field(default_factory=IntroCommunicationOutput)
    anchor_cards: list[IntroAnchorOutput] = Field(default_factory=list)

    @model_validator(mode="after")
    def has_profile_fields(self) -> SelfIntroOutput:
        if not self.model_fields_set.intersection(type(self).model_fields):
            raise ValueError("At least one self-introduction profile field is required")
        return self


class SummaryEntryOutput(OutputModel):
    progression: str = ""
    key_evidence: list[str] = Field(default_factory=list)
    gaps: list[str] = Field(default_factory=list)


class SummaryOutput(OutputModel):
    by_dimension: dict[str, SummaryEntryOutput] = Field(min_length=1)
    overall_trajectory: str = ""
    summary_version: int = Field(default=1, ge=1)


class PlanStepOutput(OutputModel):
    step_id: int = Field(ge=1)
    kind: Literal["select_structured_question", "retrieve_rag", "retrieve_strategy",
                  "retrieve_skills", "retrieve_candidate_anchors", "draft_question",
                  "negotiate_contract", "challenge_with_reference", "guardrail_check"]
    goal: str = ""
    success_criteria: str = ""
    optional: bool = False
    dependencies: list[int] = Field(default_factory=list)
    produced_keys: list[str] = Field(default_factory=list)


class AskPlanOutput(OutputModel):
    template: Literal["simple", "adaptive", "deep_probe", "quick_review"]
    steps: list[PlanStepOutput] = Field(min_length=2, max_length=9)
    rationale: str = ""


class DiagnosisOutput(OutputModel):
    overall_readiness: str = ""
    target_level_gap: str = ""
    top_patterns: list[str] = Field(default_factory=list)


class WeaknessOutput(OutputModel):
    dimension: str = ""
    focus: str = ""
    evidence: list[str] = Field(default_factory=list)
    why_it_matters: str = ""


class PracticeOutput(OutputModel):
    dimension: str = ""
    task: str = ""
    rationale: str = ""
    steps: list[str] = Field(default_factory=list)
    success_criteria: list[str] = Field(default_factory=list)
    estimated_hours: Annotated[float, Field(ge=0, allow_inf_nan=False)] = 2.0


class TrainingPlanOutput(OutputModel):
    diagnosis: DiagnosisOutput = Field(default_factory=DiagnosisOutput)
    priority_weaknesses: list[WeaknessOutput] = Field(default_factory=list)
    practice_plan: list[PracticeOutput] = Field(default_factory=list)
    goals_30_60_90: dict[str, list[str]] = Field(default_factory=dict)
    signal_summary: str = ""

    @model_validator(mode="after")
    def has_plan(self) -> TrainingPlanOutput:
        if not self.model_fields_set.intersection(
            {"diagnosis", "priority_weaknesses", "practice_plan", "goals_30_60_90", "signal_summary"}
        ):
            raise ValueError("At least one training plan field is required")
        return self

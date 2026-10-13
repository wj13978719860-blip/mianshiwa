"use client";
import { useEffect, useRef, useState } from "react";
import { Alert, Button, Card, Empty, Form, Input, List, Radio, Select, Skeleton, Space, Steps, Tabs, Tag, Typography, Upload, message } from "antd";
import { PlusOutlined, RocketOutlined, UploadOutlined } from "@ant-design/icons";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useSelector } from "react-redux";
import { RootState } from "@/stores";
import { BRAND_LOGO } from "@/constants/brand";
import { CandidateProfile, InterviewCatalog, InterviewHistory, InterviewSetup, SetupJob, interviewApi, interviewError, interviewStatus } from "@/api/aiInterviewController";
import "@/components/Interview/interview.css";

const emptyProfile: CandidateProfile = { summary: "", skills: [], projects: [], concerns: [] };
/** 问镜三步设置：方向、个人画像、目标岗位；用户编辑后的结果进入面试快照。 */
export default function InterviewSetupPage() {
  const router = useRouter();
  const user = useSelector((state: RootState) => state.loginUser);
  const [form] = Form.useForm();
  const [step, setStep] = useState(0);
  const [tab, setTab] = useState("setup");
  const [catalog, setCatalog] = useState<InterviewCatalog>();
  const [sources, setSources] = useState<{ id: string; title: string }[]>([]);
  const [history, setHistory] = useState<InterviewHistory[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [historyError, setHistoryError] = useState("");
  const [resumeText, setResumeText] = useState("");
  const [file, setFile] = useState<File>();
  const [job, setJob] = useState<SetupJob>();
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState("");
  const pending = useRef<{ fingerprint: string; id: string }>();
  const parsePending = useRef<{ fingerprint: string; id: string }>();
  const activeUser = useRef(user.id); activeUser.current = user.id;
  const directionId = Form.useWatch("directionId", form);
  const selected = catalog?.directions.find(d => d.direction === directionId);
  const draftKey = user.id ? `mianshiwa:setup:v2:${user.id}` : "";
  const busy = parsing || Boolean(job && ["queued", "running"].includes(job.status));

  const save = (nextStep = step, nextJob = job) => {
    // 私有资料按用户隔离；只保存编辑结果，不保存原始文件/Base64。
    if (!draftKey) return;
    try { localStorage.setItem(draftKey, JSON.stringify({ values: form.getFieldsValue(true), step: nextStep, job: nextJob })); }
    catch { /* 存储不可用仍允许创建。 */ }
  };
  const load = async () => {
    if (!user.id) return;
    const owner = user.id;
    setLoading(true); setError(""); setHistoryError("");
    const result = await Promise.allSettled([interviewApi.catalog(), interviewApi.sources(), interviewApi.history()]);
    if (activeUser.current !== owner) return;
    if (result[0].status === "fulfilled") setCatalog(result[0].value.data); else setError(interviewError(result[0].reason));
    if (result[1].status === "fulfilled") {
      setSources(result[1].value.data);
      // 题库排序不代表与方向匹配，让用户明确选择，避免 Java 面试默认拿 JavaScript 题。
    } else setError(interviewError(result[1].reason));
    if (result[2].status === "fulfilled") setHistory(result[2].value.data); else setHistoryError(interviewError(result[2].reason));
    setLoading(false);
  };
  useEffect(() => {
    form.resetFields(); setStep(0); setJob(undefined); setFile(undefined); setResumeText(""); setHistory([]); setSources([]); setCatalog(undefined);
    try {
      const saved = draftKey && localStorage.getItem(draftKey);
      if (saved) { const data = JSON.parse(saved); form.setFieldsValue(data.values); setStep(Math.max(0, Math.min(2, Number(data.step) || 0))); if (data.job?.id) setJob(data.job); }
    } catch { /* 历史草稿失效时重新填写。 */ }
    void load();
  }, [user.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!job || !["queued", "running"].includes(job.status) || !user.id) return;
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const result = (await interviewApi.setupJob(job.id, controller.signal)).data;
        if (controller.signal.aborted) return;
        if (["queued", "running"].includes(result.status)) timer = setTimeout(poll, 1200);
        else {
          setJob(result);
          if (result.status === "succeeded") { form.setFieldValue(result.kind === "resume" ? "candidateProfile" : "jobProfile", result.result); setFile(undefined); setResumeText(""); message.success("解析完成，请检查并调整结果"); }
          else setParseError(result.message || "解析失败，可重试或手动填写");
          save(step, result);
        }
      } catch (cause) { if (!controller.signal.aborted) { setParseError(interviewError(cause)); timer = setTimeout(poll, 3000); } }
    };
    void poll(); return () => { controller.abort(); clearTimeout(timer); };
  }, [job?.id, job?.status, user.id, form]); // eslint-disable-line react-hooks/exhaustive-deps

  const parse = async (kind: "resume" | "jd") => {
    if (busy || !selected) return;
    const owner = user.id; setParsing(true); setParseError("");
    try {
      let fileBase64 = "";
      if (kind === "resume" && file) fileBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(",")[1]); reader.onerror = () => reject(new Error("读取文件失败")); reader.readAsDataURL(file);
      });
      const body = { kind, directionId, text: kind === "resume" ? (file ? "" : resumeText) : form.getFieldValue("jobDescription") || "", filename: kind === "resume" ? file?.name || "" : "", fileBase64 };
      const fingerprint = JSON.stringify(body);
      if (parsePending.current?.fingerprint !== fingerprint || job?.status === "failed") parsePending.current = { fingerprint, id: crypto.randomUUID() };
      const result = await interviewApi.setup({ ...body, commandId: parsePending.current.id });
      if (activeUser.current === owner) { setJob(result.data); save(step, result.data); }
    } catch (cause) { setParseError(interviewError(cause)); } finally { setParsing(false); }
  };
  const next = async () => {
    try { await form.validateFields(step === 0 ? ["directionId"] : [["candidateProfile", "summary"]]); save(step + 1); setStep(s => s + 1); }
    catch { /* 字段错误由表单展示。 */ }
  };
  const start = async () => {
    try {
      await form.validateFields(); const v = form.getFieldsValue(true);
      const level = v.level as "junior" | "mid" | "senior";
      const settings: InterviewSetup = { bankId: v.bankId, jobPosition: v.jobProfile.title,
        experience: ({ junior: "应届生", mid: "1-3 年", senior: "5 年以上" } as const)[level],
        difficulty: ({ junior: "基础", mid: "进阶", senior: "深入" } as const)[level],
        maxQuestions: catalog?.depths.find(d => d.id === v.depth)?.turns || 8, allowFollowup: true,
        background: v.candidateProfile.summary, jobDescription: v.jobDescription || "", workflowVersion: "v2",
        directionId: v.directionId, depth: v.depth, level, candidateProfile: v.candidateProfile, jobProfile: v.jobProfile };
      const fingerprint = JSON.stringify(settings);
      if (pending.current?.fingerprint !== fingerprint) pending.current = { fingerprint, id: crypto.randomUUID() };
      setSubmitting(true); setError(""); save();
      const response = await interviewApi.create(settings, pending.current.id); router.push(`/mockInterview/chat/${response.data.id}`);
    } catch (cause) { if (cause instanceof Error) setError(interviewError(cause)); setSubmitting(false); }
  };

  return <main className="interview-page"><div className="interview-hero"><div>
    <span className="interview-brand"><Image src={BRAND_LOGO} width={26} height={26} alt="面试蛙" /> AI 模拟面试</span>
    <Typography.Title level={1}>让面试官先了解你，再问适合你的问题</Typography.Title>
    <Typography.Paragraph type="secondary">选择方向，确认个人画像和目标岗位，从自我介绍开始。</Typography.Paragraph></div></div>
    {!user.id && <Alert type="info" showIcon message="登录后开始面试" action={<Button onClick={() => router.push(`/user/login?redirect=${encodeURIComponent(window.location.origin + "/mockInterview/add")}`)}>去登录</Button>} />}
    <Tabs activeKey={tab} onChange={setTab} items={[{ key: "setup", label: "开始面试" }, { key: "history", label: "面试记录" }]} />
    {tab === "history" ? <Card title="最近的面试" extra={<Button onClick={load}>刷新</Button>}>
      {historyError && <Alert type="error" message={historyError} />}
      <List loading={loading} dataSource={history} locale={{ emptyText: <Empty description="还没有面试记录" /> }} renderItem={item => <List.Item><div className="interview-history-item">
        <div><Space><Typography.Text strong>{item.settings.jobPosition}</Typography.Text><Tag>{interviewStatus[item.status]}</Tag></Space><p>{new Date(item.createdAt).toLocaleString("zh-CN")}</p></div>
        <Button onClick={() => router.push(`/mockInterview/chat/${item.id}`)}>{item.status === "completed" ? "查看报告" : "继续面试"}</Button></div></List.Item>} />
    </Card> : <div className="interview-setup-grid"><Card className="interview-setup-card">
      <Steps size="small" current={step} items={[{ title: "选择方向" }, { title: "你是谁" }, { title: "目标岗位" }]} />
      {error && <Alert type="error" showIcon message={error} action={<Button onClick={load}>重新加载</Button>} />}
      {loading ? <Skeleton active /> : <Form form={form} layout="vertical" onValuesChange={() => save()} initialValues={{ directionId: "java_backend", candidateProfile: emptyProfile,
        jobProfile: { title: "Java 后端开发工程师", skills: [], requirements: [], dimensions: ["technical_depth", "project_experience"] }, level: "junior", depth: "standard", jobDescription: "" }}>
        <section hidden={step !== 0}><Typography.Title level={3}>你想练习哪个方向？</Typography.Title>
          <Form.Item name="directionId" rules={[{ required: true }]}><Radio.Group className="interview-direction-grid" onChange={event => {
            const d = catalog?.directions.find(x => x.direction === event.target.value);
            if (d) form.setFieldsValue({ jobDescription: "", jobProfile: { title: d.default_title, requirements: [], skills: d.skills, dimensions: d.dimension_catalog.map(x => x.id).slice(0, 5) } });
            setJob(undefined); setParseError("");
          }}>{catalog?.directions.map(d => <Radio.Button key={d.direction} value={d.direction}>{d.label}</Radio.Button>)}</Radio.Group></Form.Item>
          <Typography.Text type="secondary">方向决定考察能力，题库作为知识来源。</Typography.Text></section>
        <section hidden={step !== 1}><Typography.Title level={3}>让面试官了解你</Typography.Title>
          <Upload accept=".pdf,.docx,.txt,.md" maxCount={1} disabled={busy} fileList={file ? [{ uid: "resume", name: file.name, status: "done" }] : []}
            beforeUpload={f => { if (f.size > 5 * 1024 * 1024 || !/\.(pdf|docx|txt|md)$/i.test(f.name)) { message.error("支持 5 MiB 以内 PDF、DOCX、TXT、MD"); return Upload.LIST_IGNORE; } setFile(f); setResumeText(""); return false; }} onRemove={() => { setFile(undefined); return true; }}>
            <Button icon={<UploadOutlined />}>上传简历</Button></Upload><p>或粘贴文字；扫描 PDF 暂不支持 OCR。</p>
          <Input.TextArea rows={4} maxLength={30000} showCount value={resumeText} disabled={busy || Boolean(file)} onChange={e => setResumeText(e.target.value)} placeholder="粘贴简历，或手动填写下方画像" />
          <Button type="primary" style={{ margin: "16px 0" }} loading={busy && job?.kind !== "jd"} disabled={busy || (!file && !resumeText.trim())} onClick={() => parse("resume")}>解析简历</Button>
          <Form.Item name={["candidateProfile", "summary"]} label="个人概述" rules={[{ required: true, whitespace: true, message: "请解析简历或填写个人概述" }]}><Input.TextArea rows={3} maxLength={1200} /></Form.Item>
          <Form.Item name={["candidateProfile", "skills"]} label="技能（可编辑）"><Select mode="tags" maxCount={40} tokenSeparators={[",", "，"]} /></Form.Item>
          <Form.Item name={["candidateProfile", "concerns"]} label="希望重点练习的内容"><Select mode="tags" maxCount={10} /></Form.Item>
          <Form.List name={["candidateProfile", "projects"]}>{(fields, { add, remove }) => <>{fields.map(field => <Card size="small" key={field.key} title={`项目 ${field.name + 1}`} style={{ marginBottom: 16 }} extra={<Button danger type="text" onClick={() => remove(field.name)}>删除</Button>}>
            <Form.Item name={[field.name, "name"]} label="项目名称" rules={[{ required: true }]}><Input maxLength={120} /></Form.Item>
            <Form.Item name={[field.name, "role"]} label="你的职责"><Input maxLength={80} /></Form.Item>
            <Form.Item name={[field.name, "techStack"]} label="技术栈"><Select mode="tags" maxCount={40} /></Form.Item>
            <Form.Item name={[field.name, "contributions"]} label="你做了什么"><Input.TextArea maxLength={1200} /></Form.Item>
            <Form.Item name={[field.name, "challenges"]} label="项目难点"><Input.TextArea maxLength={1200} /></Form.Item>
          </Card>)}<Button icon={<PlusOutlined />} disabled={fields.length >= 12} onClick={() => add({ name: "", role: "", techStack: [], contributions: "", challenges: "" })}>添加项目</Button></>}</Form.List></section>
        <section hidden={step !== 2}><Typography.Title level={3}>你想应聘什么岗位？</Typography.Title>
          <Form.Item name={["jobProfile", "title"]} label="岗位名称" rules={[{ required: true, whitespace: true }]}><Input maxLength={80} /></Form.Item>
          <Form.Item name="level" label="岗位级别"><Radio.Group options={[{ value: "junior", label: "初级 / 应届" }, { value: "mid", label: "中级" }, { value: "senior", label: "高级" }]} /></Form.Item>
          <Form.Item name="jobDescription" label="岗位描述 JD（选填）"><Input.TextArea rows={4} maxLength={6000} showCount /></Form.Item>
          <Space style={{ marginBottom: 20 }}><Button disabled={busy} onClick={() => { form.setFieldValue("jobDescription", selected?.template || ""); save(); }}>使用通用岗位模板</Button><Button loading={busy && job?.kind === "jd"} disabled={busy} onClick={() => parse("jd")}>解析 JD</Button></Space>
          <Form.Item name={["jobProfile", "skills"]} label="岗位技能"><Select mode="tags" maxCount={40} /></Form.Item>
          <Form.Item name={["jobProfile", "requirements"]} label="岗位要求"><Select mode="tags" maxCount={20} /></Form.Item>
          <Form.Item name={["jobProfile", "dimensions"]} label="考察维度" rules={[{ required: true, type: "array", min: 1 }]}><Select mode="multiple" options={selected?.dimension_catalog.map(d => ({ value: d.id, label: d.label }))} /></Form.Item>
          <Form.Item name="depth" label="面试深度"><Radio.Group options={catalog?.depths.map(d => ({ value: d.id, label: `${d.label} · 目标 ${d.turns} 轮` }))} /></Form.Item>
          <Form.Item name="bankId" label="知识来源题库" rules={[{ required: true }]}><Select options={sources.map(s => ({ value: s.id, label: s.title }))} /></Form.Item>
          <Alert type="info" message="从自我介绍开始；主问题和追问都计入正式轮次。" /></section>
        {parseError && <Alert type="warning" showIcon message={parseError} style={{ marginTop: 16 }} />}
        {busy && <Alert type="info" showIcon message="资料解析中，可以离开后回来查看" style={{ marginTop: 16 }} />}
        <div className="interview-form-actions"><Button disabled={step === 0 || submitting || busy} onClick={() => { save(step - 1); setStep(s => s - 1); }}>上一步</Button>
          {step < 2 ? <Button type="primary" disabled={!user.id || !catalog || busy} onClick={next}>下一步</Button> : <Button type="primary" icon={<RocketOutlined />} loading={submitting} disabled={busy || !user.id} onClick={start}>开始面试</Button>}</div>
      </Form>}
    </Card><aside><Card title="这一场会如何进行"><ol className="interview-guide">{[["确认画像", "解析后调整技能、项目与个人职责。"], ["真实对话", "自我介绍后围绕岗位与项目逐轮考察。"], ["反馈与训练", "查看回答证据、薄弱点与训练建议。"]].map(([title, text]) => <li key={title}><div><strong>{title}</strong><p>{text}</p></div></li>)}</ol></Card></aside></div>}
  </main>;
}

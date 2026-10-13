"use server";
import { getErrorMessage } from "@/libs/error";
import Title from "antd/es/typography/Title";
import { message } from "antd";
import { searchQuestionVoByPageUsingPost } from "@/api/questionController";
import QuestionTable from "@/components/QuestionTable";
import "./index.css";

/**
 * 题目列表页面
 * @constructor
 */
export default async function QuestionsPage({ searchParams }: { searchParams: { q?: string } }) {
  // 获取 url 的查询参数
  const { q: searchText } = searchParams;
  // 题目列表和总数
  let questionList: API.QuestionVO[] = [];
  let total = 0;

  try {
    const res = await searchQuestionVoByPageUsingPost({
      searchText,
      pageSize: 12,
      sortField: "createTime",
      sortOrder: "descend",
    });
    questionList = res.data?.records ?? [];
    total = res.data?.total ?? 0;
  } catch (e) {
    console.error("获取题目列表失败，" + getErrorMessage(e));
  }

  return (
    <div id="questionsPage" className="max-width-content">
      <Title level={3}>题目大全</Title>
      <QuestionTable
        defaultQuestionList={questionList}
        defaultTotal={total}
        defaultSearchParams={{
          title: searchText,
        }}
      />
    </div>
  );
}

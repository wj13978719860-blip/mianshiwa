"use client";

import React from "react";
import { Button, Result } from "antd";
import { useSelector } from "react-redux";
import { RootState } from "@/stores";
import ACCESS_ENUM from "@/access/accessEnum";

/** 问镜会话归属于面试蛙账号，未登录时提示登录而不是发请求拿 401。 */
export default function AuthGate({ children }: { children: React.ReactNode }) {
  const loginUser = useSelector((state: RootState) => state.loginUser);
  if (loginUser?.userRole && loginUser.userRole !== ACCESS_ENUM.NOT_LOGIN) {
    // 账号切换时重新挂载页面，清除上一账号仍留在 React 内存中的简历和回答。
    return <React.Fragment key={String(loginUser.id)}>{children}</React.Fragment>;
  }
  const toLogin = () => {
    const redirect = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.href = `/user/login?redirect=${redirect}`;
  };
  return (
    <Result
      status="403"
      title="请先登录"
      subTitle="AI 模拟面试的记录会保存到你的账号下，登录后即可开始。"
      extra={
        <Button type="primary" onClick={toLogin}>
          去登录
        </Button>
      }
    />
  );
}

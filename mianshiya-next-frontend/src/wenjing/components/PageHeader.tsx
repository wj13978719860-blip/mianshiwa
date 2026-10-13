"use client";

import React from "react";
import { Space, Typography } from "antd";

interface Props {
  icon?: React.ReactNode;
  eyebrow: string;
  title: string;
  description?: React.ReactNode;
  extra?: React.ReactNode;
}

export default function PageHeader({ icon, eyebrow, title, description, extra }: Props) {
  return (
    <div className="wenjing-page-header">
      <Space size={8} style={{ color: "#10b981", fontSize: 12, letterSpacing: 2 }}>
        {icon}
        <span>{eyebrow}</span>
      </Space>
      <Typography.Title level={2} style={{ margin: "8px 0 4px" }}>
        {title}
      </Typography.Title>
      {description ? (
        <Typography.Paragraph type="secondary" style={{ maxWidth: 640, marginBottom: 0 }}>
          {description}
        </Typography.Paragraph>
      ) : null}
      {extra ? <div style={{ marginTop: 12 }}>{extra}</div> : null}
    </div>
  );
}

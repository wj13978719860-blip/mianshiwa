import React from "react";
import "./index.css";
import { BRAND_NAME, PROJECT_AUTHOR, PROJECT_GITHUB_URL } from "@/constants/brand";

/**
 * 全局底部栏组件
 * @constructor
 */
export default function GlobalFooter() {
  const currentYear = new Date().getFullYear();

  return (
    <div className="global-footer">
      <div>© {currentYear} {BRAND_NAME}</div>
      <div>
        <a href={PROJECT_GITHUB_URL} target="_blank" rel="noopener noreferrer">
          作者：{PROJECT_AUTHOR}
        </a>
      </div>
    </div>
  );
}

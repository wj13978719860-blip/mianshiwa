import React from "react";
import "./index.css";
import { BRAND_NAME } from "@/constants/brand";

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
        <a href="https://www.code-nav.cn" target="_blank">
          原项目来源：编程导航 - 程序员鱼皮
        </a>
      </div>
    </div>
  );
}

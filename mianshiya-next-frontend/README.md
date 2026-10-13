# 面试蛙前端

维护者：[程序员条条](https://github.com/wj13978719860-blip/mianshiwa)

使用 Next.js 14、React 18、TypeScript、Ant Design 和 Redux Toolkit，提供刷题、用户中心、管理页面及 AI 文字面试。

## 页面与代码

- `src/app/interview/setup`：简历、岗位描述与面试设置。
- `src/app/interview/[sessionId]`：面试房间，回答、跳题、暂停和恢复。
- `src/app/interview/history`：历史列表；会话下的 `report`、`replay`、`trace` 分别展示报告、回放和流程记录。
- `src/wenjing`：面试组件、API、轮询与本地存储；关键适配逻辑带中文注释。
- `src/wenjing/lib/storage/userStorage.ts`：以 Java 用户 ID 隔离草稿和恢复凭证；退出或切换账号清理上一账号缓存。旧无归属草稿会清理，服务端历史保留。
- `src/constants/brand.ts`、`public/assets/logo.svg`：面试蛙品牌与 Logo。

旧 `/mockInterview/*` 入口重定向至新面试页面，旧会话 ID 与新服务不通用。

## 启动与构建

在项目根目录运行 `./scripts/start-frontend.ps1`，默认开发模式，地址 http://localhost:3000。生产运行使用 `./scripts/start-frontend.ps1 -Production -Build`。

也可在本目录安装依赖后执行：

```powershell
npm install
npm run dev
```

类型检查与独立构建：

```powershell
npx tsc --noEmit
$env:NEXT_BUILD_DIR='.next-build-check'
npm run build
Remove-Item Env:NEXT_BUILD_DIR
```

生产构建保留 TypeScript 检查，独立目录避免覆盖正在运行的开发缓存。品牌为“面试蛙”，内部目录名和 npm 包名保留 `mianshiya`。

AI 功能依赖 Java 登录网关与 Python 服务，完整环境说明见 [项目 README](../README.md)，验证范围见 [文字面试验收](../docs/问镜文字面试补齐与验收.md)。

/** @type {import('next').NextConfig} */
const nextConfig = {
    // 构建验收使用独立目录，避免覆盖正在运行的开发服务器缓存。
    distDir: process.env.NEXT_BUILD_DIR || ".next",
    output: "standalone",
    // 旧的简化版模拟面试已由问镜替代；旧会话 ID 与问镜不通用，统一落到“我的面试”。
    async redirects() {
        return [
            { source: "/mockInterview/add", destination: "/interview/setup", permanent: false },
            { source: "/mockInterview/chat/:id", destination: "/interview/history", permanent: false },
            { source: "/mockInterview/report/:id", destination: "/interview/history", permanent: false },
        ];
    },
};

export default nextConfig;

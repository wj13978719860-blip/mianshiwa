/** @type {import('next').NextConfig} */
const nextConfig = {
    output: "standalone",
    typescript: {
        // !! WARN !!
        // Dangerously allow production builds to successfully complete even if
        // your project has type errors.
        // !! WARN !!
        ignoreBuildErrors: true,
    },
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

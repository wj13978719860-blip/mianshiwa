package com.yupi.mianshiya.ai;

import java.util.Arrays;
import java.util.List;
import java.util.regex.Pattern;

/**
 * 问镜第一期对浏览器开放的上游接口白名单（路径相对 /api/v1/）。
 * 注册登录、管理端、语音、积分申请不在名单内，由 Python 侧路由也不会挂载。
 */
public final class WenjingRoutes {
    private static final String SID = "[A-Za-z0-9._:-]{1,64}";
    private static final String JOB = "[A-Za-z0-9_-]{1,128}";
    private static final List<Route> ROUTES = Arrays.asList(
            new Route("GET", "interview/(dimensions|directions|waiting-tips|job-template)"),
            new Route("POST", "interview/jd/parse"),
            new Route("GET", "interview/resume/parse-jobs/" + JOB),
            new Route("POST", "interview/sessions"),
            new Route("DELETE", "interview/sessions/" + SID),
            new Route("POST", "interview/sessions/" + SID + "/(recover|answer|skip-question|hint|retry-question|feedback)"),
            new Route("GET", "interview/sessions/" + SID + "/(question|metadata|setup-snapshot|report|replay|trace|resume)"),
            new Route("GET", "account/interview-sessions"));
    /** 由控制器单独接收文件后重新组装 multipart 转发。 */
    public static final List<String> UPLOADS = Arrays.asList("interview/resume/parse-jobs", "interview/resume/parse");
    private static final Pattern QUERY = Pattern.compile("[A-Za-z0-9_=&.-]{0,256}");

    private WenjingRoutes() {
    }

    public static boolean allowed(String method, String path) {
        if (path == null || path.contains("..")) {
            return false;
        }
        return ROUTES.stream().anyMatch(route -> route.method.equals(method) && route.pattern.matcher(path).matches());
    }

    public static boolean validQuery(String query) {
        return query == null || QUERY.matcher(query).matches();
    }

    private static final class Route {
        private final String method;
        private final Pattern pattern;

        private Route(String method, String regex) {
            this.method = method;
            this.pattern = Pattern.compile(regex);
        }
    }
}

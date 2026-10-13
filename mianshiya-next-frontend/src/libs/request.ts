import axios, { AxiosRequestConfig } from "axios";

// 创建 Axios 实例
// 区分开发和生产环境
const DEV_BASE_URL = "http://localhost:8101";
const PROD_BASE_URL = "http://xx.xx.xx.xx";
const myAxios = axios.create({
  baseURL: DEV_BASE_URL,
  timeout: 60000,
  withCredentials: true,
});

// 创建请求拦截器
myAxios.interceptors.request.use(
  function (config) {
    // 请求执行前执行
    return config;
  },
  function (error) {
    // 处理请求错误
    return Promise.reject(error);
  },
);

// 创建响应拦截器
myAxios.interceptors.response.use(
  // 2xx 响应触发
  function (response) {
    // 处理响应数据
    const { data } = response;
    // 未登录
    if (data.code === 40100) {
      // 不是获取用户信息接口，或者不是登录页面，则跳转到登录页面
      if (
        typeof window !== "undefined" &&
        !response.config.url?.includes("user/get/login") &&
        !window.location.pathname.includes("/user/login")
      ) {
        window.location.href = `/user/login?redirect=${window.location.href}`;
      }
    } else if (data.code !== 0) {
      // 其他错误
      throw new Error(data.message ?? "服务器错误");
    }
    return data;
  },
  // 非 2xx 响应触发
  function (error) {
    // 处理响应错误
    return Promise.reject(error);
  },
);

/** 响应拦截器已经解包为业务正文，类型也必须返回正文，不能仍声明 AxiosResponse。 */
function request<T, R = T>(url: string, options?: AxiosRequestConfig & { requestType?: string }): Promise<R> {
  // requestType 是旧生成器参数；Axios 根据 FormData 自动设置 multipart boundary。
  const { requestType, ...config } = options ?? {};
  return myAxios.request<T, R>({ ...config, url });
}

// 保留已有手写 AI 接口的 post 调用形式。
request.post = <T, R = T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<R> =>
  myAxios.post<T, R>(url, data, config);

export default request;

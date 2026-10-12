package com.yupi.mianshiya.blackfilter;

import cn.hutool.core.collection.CollUtil;
import cn.hutool.core.util.StrUtil;
import lombok.extern.slf4j.Slf4j;
import org.yaml.snakeyaml.Yaml;

import java.util.List;
import java.util.Map;
import java.util.Collections;
import java.util.HashSet;
import java.util.Set;

/**
 * 黑名单过滤工具类
 *
 * @author <a href="https://github.com/liyupi">程序员鱼皮</a>
 * @from <a href="https://www.code-nav.cn">编程导航学习圈</a>
 */
@Slf4j
public class BlackIpUtils {

    private static volatile Set<String> blackIps = Collections.emptySet();

    // 判断 ip 是否在黑名单里
    public static boolean isBlackIp(String ip) {
        return blackIps.contains(ip);
    }

    /**
     * 重建 ip 黑名单
     *
     * @param configInfo
     */
    public static void rebuildBlackIp(String configInfo) {
        if (StrUtil.isBlank(configInfo)) {
            configInfo = "{}";
        }
        // 解析 yaml 文件
        Yaml yaml = new Yaml();
        Map map = yaml.loadAs(configInfo, Map.class);
        // 获取 IP 黑名单
        List<String> blackIpList = (List<String>) map.get("blackIpList");
        // 构建后原子替换，避免布隆过滤器误拦截及错误容量导致内存耗尽。
        blackIps = CollUtil.isEmpty(blackIpList) ? Collections.emptySet()
                : Collections.unmodifiableSet(new HashSet<>(blackIpList));
    }
}

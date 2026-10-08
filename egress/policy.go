// Package egress centralizes destinations that ARTEX must never contact.
package egress

import (
	"fmt"
	"net"
	"net/url"
	"os"
	"strings"
	"sync"
)

// blockedSuffixes covers the China country-code namespace and the public
// domains of China-operated cloud, model, messaging, search, and package
// services previously referenced by this project. Suffix matching includes the
// apex itself. Operators may add entries with ARTEX_EGRESS_DENY_HOSTS.
var blockedSuffixes = []string{
	"cn",
	"npmmirror.com", "deepseek.com", "aliyun.com", "aliyuncs.com", "alibabacloud.com", "alibaba.com",
	"dingtalk.com", "feishu.cn", "weixin.qq.com", "weixin.com", "qq.com", "tencent.com", "qcloud.com", "myqcloud.com",
	"baidu.com", "bdstatic.com", "bytecdn.cn", "bytedance.com", "volcengine.com",
	"huaweicloud.com", "huawei.com", "jd.com", "xiaomi.com", "mi.com", "bilibili.com", "kuaishou.com", "ksyun.com",
}

var (
	cidrOnce sync.Once
	deniedIP []*net.IPNet
)

// CheckURL rejects a URL whose hostname is forbidden by policy.
func CheckURL(raw string) error {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return fmt.Errorf("invalid URL: %w", err)
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return fmt.Errorf("egress URL scheme %q is not allowed", u.Scheme)
	}
	if u.Hostname() == "" {
		return fmt.Errorf("URL has no hostname")
	}
	return CheckHost(u.Hostname())
}

// CheckHost rejects known China-linked domains and operator-supplied CIDRs.
func CheckHost(raw string) error {
	host := strings.ToLower(strings.TrimSuffix(strings.TrimSpace(raw), "."))
	if host == "" {
		return fmt.Errorf("hostname is empty")
	}
	for _, suffix := range configuredSuffixes() {
		if host == suffix || strings.HasSuffix(host, "."+suffix) {
			return fmt.Errorf("egress destination %q is blocked by policy", host)
		}
	}
	if ip := net.ParseIP(host); ip != nil {
		loadCIDRs()
		for _, network := range deniedIP {
			if network.Contains(ip) {
				return fmt.Errorf("egress address %q is blocked by policy", host)
			}
		}
	}
	return nil
}

func configuredSuffixes() []string {
	out := append([]string(nil), blockedSuffixes...)
	for _, value := range strings.Split(os.Getenv("ARTEX_EGRESS_DENY_HOSTS"), ",") {
		value = strings.ToLower(strings.Trim(strings.TrimSpace(value), "."))
		if value != "" {
			out = append(out, value)
		}
	}
	return out
}

func loadCIDRs() {
	cidrOnce.Do(func() {
		for _, raw := range strings.Split(os.Getenv("ARTEX_EGRESS_DENY_CIDRS"), ",") {
			if _, network, err := net.ParseCIDR(strings.TrimSpace(raw)); err == nil {
				deniedIP = append(deniedIP, network)
			}
		}
	})
}

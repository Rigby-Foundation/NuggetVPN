// Package sbconfig turns a selected profile plus the user's settings into a
// complete sing-box configuration document.
package sbconfig

import (
	"encoding/json"
	"fmt"
	"net"
	"runtime"
	"strings"

	"github.com/Rigby-Foundation/NuggetVPN/internal/link"
	"github.com/Rigby-Foundation/NuggetVPN/internal/models"
)

const (
	// ExitTag is the tag of the outbound traffic finally leaves through.
	ExitTag = "proxy"
	// DirectTag is the tag of the bypass outbound.
	DirectTag = "direct"

	dnsProxyTag  = "dns-proxy"
	dnsDirectTag = "dns-direct"
	dnsFakeTag   = "dns-fake"

	// fakeIPRange must not overlap the TUN interface address below.
	fakeIPRange = "198.18.0.0/15"
	tunAddress  = "172.19.0.1/30"

	// winboxPort is routed through the proxy even in split mode, matching the
	// behaviour of the previous builds.
	winboxPort = 8291
)

// Request describes one connection attempt.
type Request struct {
	Profile  models.Profile
	Profiles []models.Profile
	Settings models.AppSettings

	// MixedPort exposes a local HTTP/SOCKS proxy; zero disables the inbound.
	MixedPort int
	// CacheFilePath persists the fake-IP mapping across restarts.
	CacheFilePath string
}

// Result is a generated configuration plus the details the caller reports back
// to the UI.
type Result struct {
	JSON       []byte
	Verbatim   bool
	ChainHops  int
	SplitRules int
}

// Build produces the sing-box configuration for a profile.
//
// A profile holding a complete sing-box config (one that declares its own
// inbounds) is passed through untouched — that is the escape hatch for users
// who want full control.
func Build(request Request) (Result, error) {
	settings := request.Settings
	settings.Normalize()

	if raw, ok := link.FullConfig(request.Profile.ConfigLink); ok {
		encoded, err := json.MarshalIndent(raw, "", "  ")
		if err != nil {
			return Result{}, fmt.Errorf("failed to encode custom sing-box config: %w", err)
		}
		return Result{JSON: encoded, Verbatim: true}, nil
	}

	exit, err := link.ParseOutbound(request.Profile.ConfigLink, settings)
	if err != nil {
		return Result{}, err
	}

	outbounds := []map[string]any{}
	endpoints := []map[string]any{}

	// Build the chain first so the exit outbound can detour through its tail.
	chainTags, chainErr := appendChain(&outbounds, &endpoints, request, settings)
	if chainErr != nil {
		return Result{}, chainErr
	}

	exit["tag"] = ExitTag
	if len(chainTags) > 0 {
		exit["detour"] = chainTags[len(chainTags)-1]
	}
	if exit.IsEndpoint() {
		endpoints = append(endpoints, stripProbeFields(exit))
	} else {
		outbounds = append(outbounds, exit)
	}

	outbounds = append(outbounds, map[string]any{"type": "direct", "tag": DirectTag})

	splitTunnel := settings.SplitTunnelling()
	routeRules, splitRuleCount := buildRouteRules(settings, splitTunnel)

	config := map[string]any{
		"log": map[string]any{
			"level":     "info",
			"timestamp": true,
		},
		"dns":      buildDNS(settings, splitTunnel, proxyServerDomains(outbounds, endpoints)),
		"inbounds": buildInbounds(settings, request.MixedPort),
		"outbounds": func() []map[string]any {
			return outbounds
		}(),
		"route": map[string]any{
			"rules":                   routeRules,
			"final":                   finalOutbound(splitTunnel),
			"auto_detect_interface":   true,
			"default_domain_resolver": map[string]any{"server": dnsDirectTag},
		},
	}
	if len(endpoints) > 0 {
		config["endpoints"] = endpoints
	}
	if experimental := buildExperimental(request); len(experimental) > 0 {
		config["experimental"] = experimental
	}

	encoded, err := json.MarshalIndent(config, "", "  ")
	if err != nil {
		return Result{}, fmt.Errorf("failed to encode sing-box config: %w", err)
	}
	return Result{JSON: encoded, ChainHops: len(chainTags), SplitRules: splitRuleCount}, nil
}

// appendChain materialises the proxy chain, returning the tags in dial order.
func appendChain(
	outbounds *[]map[string]any,
	endpoints *[]map[string]any,
	request Request,
	settings models.AppSettings,
) ([]string, error) {
	if !settings.ProxyChainEnabled || len(settings.ProxyChain) == 0 {
		return nil, nil
	}

	byID := make(map[string]models.Profile, len(request.Profiles))
	for _, profile := range request.Profiles {
		byID[profile.ID] = profile
	}

	var tags []string
	seen := map[string]bool{}

	for _, chainID := range settings.ProxyChain {
		if chainID == request.Profile.ID || seen[chainID] {
			continue
		}
		seen[chainID] = true

		profile, ok := byID[chainID]
		if !ok {
			continue
		}
		hop, err := link.ParseOutbound(profile.ConfigLink, settings)
		if err != nil {
			return nil, fmt.Errorf("proxy chain hop %q: %w", profile.Name, err)
		}

		tag := fmt.Sprintf("chain-%d", len(tags)+1)
		hop["tag"] = tag
		if len(tags) > 0 {
			hop["detour"] = tags[len(tags)-1]
		}
		if hop.IsEndpoint() {
			*endpoints = append(*endpoints, stripProbeFields(hop))
		} else {
			*outbounds = append(*outbounds, hop)
		}
		tags = append(tags, tag)
	}
	return tags, nil
}

// buildInbounds returns the TUN interface plus an optional local mixed proxy.
func buildInbounds(settings models.AppSettings, mixedPort int) []map[string]any {
	inbounds := make([]map[string]any, 0, 2)

	if mixedPort > 0 {
		inbounds = append(inbounds, map[string]any{
			"type":        "mixed",
			"tag":         "mixed-in",
			"listen":      "127.0.0.1",
			"listen_port": mixedPort,
		})
	}

	tun := map[string]any{
		"type":       "tun",
		"tag":        "tun-in",
		"address":    []string{tunAddress},
		"mtu":        settings.MTU,
		"auto_route": true,
		"stack":      "gvisor",
	}
	// strict_route is only implemented on Linux and Windows.
	if runtime.GOOS != "darwin" {
		tun["strict_route"] = true
	}
	inbounds = append(inbounds, tun)
	return inbounds
}

// buildDNS wires the resolver.
//
// Full tunnel uses fake-IP so DNS never leaks and the proxy resolves names at
// the exit. Split tunnelling cannot use fake-IP, because direct traffic needs
// real addresses, so it resolves locally and sends only the proxied domains
// through the tunnel.
func buildDNS(settings models.AppSettings, splitTunnel bool, serverDomains []string) map[string]any {
	servers := []map[string]any{
		{"type": "udp", "tag": dnsProxyTag, "server": settings.DNS, "detour": ExitTag},
		// No detour: sing-box rejects detouring to an empty direct outbound.
		{"type": "udp", "tag": dnsDirectTag, "server": settings.DNS},
	}

	var rules []map[string]any

	// The proxy's own hostname must always resolve for real, or the tunnel
	// would try to dial a fake address.
	if len(serverDomains) > 0 {
		rules = append(rules, map[string]any{
			"domain": serverDomains,
			"server": dnsDirectTag,
		})
	}

	dns := map[string]any{
		"strategy":          "ipv4_only",
		"independent_cache": true,
	}

	if splitTunnel {
		if domains := cleanList(settings.RoutingDomains); len(domains) > 0 && settings.IncludeDomains() {
			rules = append(rules, map[string]any{
				"domain_suffix": domains,
				"server":        dnsProxyTag,
			})
		}
		dns["final"] = dnsDirectTag
	} else {
		servers = append(servers, map[string]any{
			"type":        "fakeip",
			"tag":         dnsFakeTag,
			"inet4_range": fakeIPRange,
		})
		rules = append(rules, map[string]any{
			"query_type": []string{"A", "AAAA"},
			"server":     dnsFakeTag,
		})
		dns["final"] = dnsProxyTag
	}

	dns["servers"] = servers
	if len(rules) > 0 {
		dns["rules"] = rules
	}
	return dns
}

// buildRouteRules returns the routing table and how many split-tunnel rules it
// contains, which the UI reports in the log pane.
func buildRouteRules(settings models.AppSettings, splitTunnel bool) ([]map[string]any, int) {
	rules := []map[string]any{
		// Sniffing gives the router real domains for fake-IP traffic.
		{"action": "sniff"},
		{"protocol": "dns", "action": "hijack-dns"},
		{"ip_is_private": true, "outbound": DirectTag},
	}
	if !splitTunnel {
		return rules, 0
	}

	splitCount := 0

	if settings.IncludeApps() {
		processPaths := extractProcessPaths(settings.RoutingApps)
		processNames := mergeProcessNames(expandProcessNames(settings.RoutingApps), processPaths)

		if len(processNames) > 0 {
			rules = append(rules, map[string]any{
				"process_name": processNames,
				"outbound":     ExitTag,
			})
			splitCount += len(processNames)
		}
		if len(processPaths) > 0 {
			rules = append(rules, map[string]any{
				"process_path": processPaths,
				"outbound":     ExitTag,
			})
			splitCount += len(processPaths)
		}
	}

	if settings.IncludeDomains() {
		if domains := cleanList(settings.RoutingDomains); len(domains) > 0 {
			rules = append(rules, map[string]any{
				"domain_suffix": domains,
				"outbound":      ExitTag,
			})
			splitCount += len(domains)
		}
	}

	rules = append(rules, map[string]any{
		"port":     []int{winboxPort},
		"outbound": ExitTag,
	})
	return rules, splitCount
}

func buildExperimental(request Request) map[string]any {
	experimental := map[string]any{}
	// An empty clash_api block builds sing-box's traffic accounting without
	// starting its HTTP listener. The app reads the counters in-process, over
	// the control socket it already has.
	//
	// Setting external_controller here instead would publish an unauthenticated
	// control plane for a *root* process on loopback, and sing-box serves it
	// with permissive CORS, so every local program and every web page the user
	// visits could read the live connection list and drive the core.
	experimental["clash_api"] = map[string]any{}
	if request.CacheFilePath != "" {
		experimental["cache_file"] = map[string]any{
			"enabled":      true,
			"path":         request.CacheFilePath,
			"store_fakeip": true,
		}
	}
	return experimental
}

func finalOutbound(splitTunnel bool) string {
	if splitTunnel {
		return DirectTag
	}
	return ExitTag
}

// proxyServerDomains lists the hostnames the tunnel itself dials, so they can
// be excluded from fake-IP resolution.
func proxyServerDomains(outbounds, endpoints []map[string]any) []string {
	var domains []string
	collect := func(entries []map[string]any) {
		for _, entry := range entries {
			server, _ := entry["server"].(string)
			server = strings.TrimSpace(server)
			if server == "" || net.ParseIP(server) != nil {
				continue
			}
			domains = append(domains, server)
		}
	}
	collect(outbounds)
	collect(endpoints)
	return dedupe(domains)
}

// stripProbeFields removes the server/server_port hints the parser keeps on
// WireGuard endpoints for the ping helpers; sing-box rejects them there.
func stripProbeFields(outbound link.Outbound) map[string]any {
	result := make(map[string]any, len(outbound))
	for key, value := range outbound {
		if key == "server" || key == "server_port" {
			continue
		}
		result[key] = value
	}
	return result
}

func cleanList(values []string) []string {
	result := make([]string, 0, len(values))
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			result = append(result, trimmed)
		}
	}
	return dedupe(result)
}

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
	dnsLocalTag  = "dns-local"

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

	// LocalRuleSets maps a geo rule-set tag (see RuleSetTag) to a source
	// rule-set file written from the user's own geoip.dat or geosite.dat.
	LocalRuleSets map[string]string
	// CustomGeo marks the geo kinds ("geoip", "geosite") the user supplied a
	// file for. For those, a code the file does not have is dropped rather
	// than fetched from the built-in sets: the two use different codes, and
	// quietly mixing them would route by a list the user never chose.
	CustomGeo map[string]bool
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
	serverDomains := proxyServerDomains(outbounds, endpoints)
	geo := geoSources{local: request.LocalRuleSets, custom: request.CustomGeo}
	routeRules, splitRuleCount := buildRouteRules(settings, serverDomains, geo)

	config := map[string]any{
		"log": map[string]any{
			"level":     "info",
			"timestamp": true,
		},
		"dns":      buildDNS(settings, splitTunnel, serverDomains),
		"inbounds": buildInbounds(settings, request.MixedPort),
		"outbounds": func() []map[string]any {
			return outbounds
		}(),
		"route": buildRouteSection(settings, routeRules, geo),
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

	// No `stack`: the core has its own TCP/IP stack as of 1.15, and its docs
	// say to omit the option to get it. Naming a stack pins the legacy gvisor
	// or system path, which is deprecated and scheduled for removal in 1.17 —
	// and on this core that meant running the old stack underneath a core built
	// around the new one.
	tun := map[string]any{
		"type":       "tun",
		"tag":        "tun-in",
		"address":    []string{tunAddress},
		"mtu":        settings.MTU,
		"auto_route": true,
		// The 1.15 way to capture DNS. It replaces guessing at DNS by sniffing
		// the protocol on every connection, which mistook other traffic for
		// DNS and filled the log with unpack errors.
		"dns_mode": "hijack",
		// Keep the local network off the tunnel at the interface rather than
		// routing it back out afterwards: the printer and the router stay
		// reachable even if a routing rule is wrong.
		"route_exclude_address": privateRanges,
	}
	// strict_route is only implemented on Linux and Windows.
	if runtime.GOOS != "darwin" {
		tun["strict_route"] = true
	}
	if name := tunInterfaceNameFor(runtime.GOOS); name != "" {
		tun["interface_name"] = name
	}
	inbounds = append(inbounds, tun)
	return inbounds
}

// buildDNS wires the resolver.
//
// Names resolve for real, through the tunnel, rather than through fake-IP.
// Fake-IP hands out synthetic addresses and maps them back when a connection
// arrives, which saves a round trip but means every connection depends on a
// mapping surviving in the cache file — and a client that resolves names its
// own way (Windows and the browsers both do DNS-over-HTTPS by default) never
// asks for one, so the mechanism is bypassed exactly when it would matter.
// Sending queries through the proxy keeps them off the local network just the
// same, and `reverse_mapping` still recovers the domain for logs and rules.
func buildDNS(settings models.AppSettings, splitTunnel bool, serverDomains []string) map[string]any {
	servers := []map[string]any{
		{"type": "udp", "tag": dnsProxyTag, "server": settings.DNS, "server_port": 53, "detour": ExitTag},
		// No detour: this is the bootstrap used to resolve the proxy's own
		// hostname, which cannot go through the tunnel it is dialing.
		{"type": "udp", "tag": dnsDirectTag, "server": settings.DNS, "server_port": 53},
		// The system resolver, for names only the local network knows.
		{"type": "local", "tag": dnsLocalTag},
	}

	rules := []map[string]any{
		{"domain_suffix": localSuffixes, "server": dnsLocalTag},
	}

	// The proxy's own hostname must resolve outside the tunnel, or the tunnel
	// has to be up before it can be established.
	if len(serverDomains) > 0 {
		rules = append(rules, map[string]any{
			"domain": serverDomains,
			"server": dnsDirectTag,
		})
	}

	dns := map[string]any{
		"strategy":          "ipv4_only",
		"independent_cache": true,
		// Recovers the domain behind an address for logging and rule matching
		// now that there is no fake-IP mapping to consult.
		"reverse_mapping": true,
	}

	if splitTunnel {
		// Domains the graph sends through the tunnel must also be resolved
		// through it, or the exit dials an address the local resolver picked.
		if exact, suffixes := proxiedDomains(settings); len(exact)+len(suffixes) > 0 {
			rule := map[string]any{"server": dnsProxyTag}
			if len(exact) > 0 {
				rule["domain"] = exact
			}
			if len(suffixes) > 0 {
				rule["domain_suffix"] = suffixes
			}
			rules = append(rules, rule)
		}
		dns["final"] = dnsDirectTag
	} else {
		dns["final"] = dnsProxyTag
	}

	dns["servers"] = servers
	dns["rules"] = rules
	return dns
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
			"store_dns":    true,
			"store_fakeip": false,
		}
	}
	return experimental
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

// tunInterfaceNameFor returns the adapter name to request, or "" to let the
// core choose.
//
// Naming the adapter makes it identifiable in the OS network list, but Darwin
// will not have it: the utun control only accepts utun<number>, and the core
// passes a configured name straight through, so anything else fails the
// interface with "bad tun name" and the tunnel never starts. Left empty, the
// core picks the next free utun itself.
//
// Linux takes the name as given (netlink, up to IFNAMSIZ), and on Windows it
// is the Wintun adapter name.
func tunInterfaceNameFor(goos string) string {
	switch goos {
	case "darwin", "ios":
		return ""
	default:
		return "NuggetVPN"
	}
}

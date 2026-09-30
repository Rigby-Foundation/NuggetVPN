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

	// RuleLists are the rule lists from URLs that the app downloaded and
	// converted, by URL. A list the core reads natively (.srs, .json) is
	// fetched by the core and needs no entry.
	RuleLists map[string]RuleList

	// Alternatives are other servers the core may move to. With any, the
	// exit becomes a group that keeps measuring every server's latency and
	// sends traffic through the fastest, switching as that changes.
	Alternatives []models.Profile

	// Dial, when set, replaces parsing a profile into an outbound: it is how
	// another program (Xray) takes over talking to the servers. It then also
	// owns the proxy chain, so Build does not build one.
	Dial func(models.Profile) (link.Outbound, error)
	// ServerDomains returns server hostnames to resolve without the tunnel,
	// for servers Build does not dial itself. Asked after every server has
	// gone through Dial.
	ServerDomains func() []string
	// Bypass, when set, is a loopback entry point whose traffic goes
	// straight out: how the engine dialing the servers (Xray, in this same
	// process) reaches them without its connections being routed back into
	// itself.
	Bypass *Bypass
}

// Bypass is a password-protected SOCKS entry point on loopback.
type Bypass struct {
	Port     int
	Username string
	Password string
}

// BypassTag is the bypass entry point's inbound.
const BypassTag = "bypass-in"

// Result is a generated configuration plus the details the caller reports back
// to the UI.
type Result struct {
	JSON       []byte
	Verbatim   bool
	ChainHops  int
	SplitRules int
	// RuleOwners maps each route rule, by index, to the id of the user rule
	// that produced it; "" for the rules the app adds itself.
	RuleOwners []string
	// Warnings are parts of the routing that could not be applied.
	Warnings []string
	// ServerFor maps each outbound tag that leaves through a server to that
	// server's profile id, so a connection can be shown with the server it
	// actually went through.
	ServerFor map[string]string
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

	dial := func(profile models.Profile) (link.Outbound, error) {
		return link.ParseOutbound(profile.ConfigLink, settings)
	}
	if request.Dial != nil {
		dial = request.Dial
	}
	exit, err := dial(request.Profile)
	if err != nil {
		return Result{}, err
	}

	outbounds := []map[string]any{}
	endpoints := []map[string]any{}

	// Build the chain first so the exit outbound can detour through its tail.
	var chainTags []string
	if request.Dial == nil {
		var chainErr error
		chainTags, chainErr = appendChain(&outbounds, &endpoints, request, settings)
		if chainErr != nil {
			return Result{}, chainErr
		}
	}

	// Each server traffic can leave through: the connected one, and any
	// alternatives the exit may switch to.
	exitTags := map[string]string{}
	addExit := func(outbound link.Outbound, tag string) {
		outbound["tag"] = tag
		if len(chainTags) > 0 {
			outbound["detour"] = chainTags[len(chainTags)-1]
		}
		if outbound.IsEndpoint() {
			endpoints = append(endpoints, stripProbeFields(outbound))
		} else {
			outbounds = append(outbounds, outbound)
		}
	}
	if len(request.Alternatives) == 0 {
		addExit(exit, ExitTag)
	} else {
		members := []string{"exit-1"}
		addExit(exit, "exit-1")
		exitTags["exit-1"] = request.Profile.ID
		for _, alternative := range request.Alternatives {
			if alternative.ID == request.Profile.ID {
				continue
			}
			// One that cannot be used is left out of the group; the rest
			// still switch.
			if _, full := link.FullConfig(alternative.ConfigLink); full {
				continue
			}
			outbound, err := dial(alternative)
			if err != nil {
				continue
			}
			tag := fmt.Sprintf("exit-%d", len(members)+1)
			addExit(outbound, tag)
			exitTags[tag] = alternative.ID
			members = append(members, tag)
		}
		outbounds = append(outbounds, map[string]any{
			"type":      "urltest",
			"tag":       ExitTag,
			"outbounds": members,
			// A tiny page that exists to be fetched for this purpose.
			"url":      "https://www.gstatic.com/generate_204",
			"interval": "3m",
			// Stay on the current server unless another is clearly faster;
			// hopping for a few milliseconds would drop connections for
			// nothing.
			"tolerance":                   80,
			"interrupt_exist_connections": false,
		})
	}

	// Rules and the default can send traffic through servers other than the
	// connected one; each gets an outbound of its own.
	outboundFor, serverWarnings := appendRuleServers(&outbounds, &endpoints, request, settings, chainTags, dial)

	outbounds = append(outbounds, map[string]any{"type": "direct", "tag": DirectTag})

	splitTunnel := settings.SplitTunnelling()
	serverDomains := proxyServerDomains(outbounds, endpoints)
	if request.ServerDomains != nil {
		serverDomains = dedupe(append(serverDomains, request.ServerDomains()...))
	}
	geo := geoSources{local: request.LocalRuleSets, custom: request.CustomGeo}
	plan := newRoutePlan(settings, geo, request.RuleLists, outboundFor)
	plan.bypass = request.Bypass != nil
	plan.warnings = append(plan.warnings, serverWarnings...)
	routeRules, owners, splitRuleCount := plan.buildRouteRules(serverDomains)
	dns := plan.buildDNS(splitTunnel, serverDomains)

	config := map[string]any{
		"log": buildLog(settings),
		"dns":      dns,
		"inbounds": buildInbounds(settings, request.MixedPort, request.Bypass),
		"outbounds": func() []map[string]any {
			return outbounds
		}(),
		"route": plan.buildRouteSection(routeRules),
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
	return Result{
		JSON:       encoded,
		ChainHops:  len(chainTags),
		SplitRules: splitRuleCount,
		RuleOwners: owners,
		Warnings:   plan.warnings,
		ServerFor:  merge(invert(outboundFor, request.Profile.ID), exitTags),
	}, nil
}

// invert turns profile id → tag into tag → profile id. A server that could
// not be used falls back to the exit tag too, so the exit is set explicitly:
// traffic through it goes through the connected server.
func invert(outboundFor map[string]string, connected string) map[string]string {
	result := map[string]string{}
	for id, tag := range outboundFor {
		if tag != ExitTag {
			result[tag] = id
		}
	}
	result[ExitTag] = connected
	return result
}

// merge adds extra's entries to base.
func merge(base, extra map[string]string) map[string]string {
	for key, value := range extra {
		base[key] = value
	}
	return base
}

// buildLog configures the core's log. With logging off the core does not
// produce one at all — cheaper than formatting every connection only for the
// app to throw the line away, and nothing to leak if a line were ever kept.
func buildLog(settings models.AppSettings) map[string]any {
	if !settings.LoggingOn() {
		return map[string]any{"disabled": true}
	}
	return map[string]any{
		"level":     "info",
		"timestamp": true,
	}
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
func buildInbounds(settings models.AppSettings, mixedPort int, bypass *Bypass) []map[string]any {
	inbounds := make([]map[string]any, 0, 3)

	if bypass != nil {
		inbounds = append(inbounds, map[string]any{
			"type":        "socks",
			"tag":         BypassTag,
			"listen":      "127.0.0.1",
			"listen_port": bypass.Port,
			// A password, so no other program can use it to leave the tunnel.
			"users": []map[string]any{{"username": bypass.Username, "password": bypass.Password}},
		})
	}

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
func (p *routePlan) buildDNS(splitTunnel bool, serverDomains []string) map[string]any {
	settings := p.settings
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
		"strategy": "ipv4_only",
		// No independent_cache: since 1.14 the cache is always kept per
		// server, and official sing-box 1.15 refuses the old option outright.
		// Recovers the domain behind an address for logging and rule matching
		// now that there is no fake-IP mapping to consult.
		"reverse_mapping": true,
	}

	// Where a name is resolved when no rule says otherwise: locally in split
	// mode, otherwise at the far end of wherever unmatched traffic goes.
	viaTags := map[string]string{ExitTag: dnsProxyTag}
	via := func(outbound string) string {
		if tag, ok := viaTags[outbound]; ok {
			return tag
		}
		tag := "dns-via-" + outbound
		servers = append(servers, map[string]any{
			"type": "udp", "tag": tag, "server": settings.DNS, "server_port": 53, "detour": outbound,
		})
		viaTags[outbound] = tag
		return tag
	}
	final := dnsDirectTag
	if !splitTunnel {
		final = via(p.finalOutbound())
	}

	// A rule's own resolver, where it names one; otherwise a proxied rule's
	// names resolve at the far end of the server it goes through, or the exit
	// dials an address a resolver elsewhere picked — for a CDN, one near the
	// wrong country.
	custom := map[string]string{}
	for _, rule := range settings.UsableRules() {
		if rule.Action == models.ActionBlock || rule.Action == models.ActionDrop {
			continue
		}
		outbound := DirectTag
		if rule.Action == models.ActionProxy {
			outbound = p.proxyOutbound(rule.Server)
		}

		server := ""
		if rule.DNS != "" {
			parsed, ok := models.ParseDNSServer(rule.DNS)
			if !ok {
				p.warnings = append(p.warnings, fmt.Sprintf("DNS server %q in a routing rule is not an address this app understands; the rule uses the default resolver", rule.DNS))
			} else {
				key := rule.DNS + "|" + outbound
				if tag, seen := custom[key]; seen {
					server = tag
				} else {
					server = fmt.Sprintf("dns-rule-%d", len(custom)+1)
					custom[key] = server
					servers = append(servers, dnsServer(server, parsed, outbound))
				}
			}
		}
		if server == "" && rule.Action == models.ActionProxy {
			server = via(outbound)
		}
		if server == "" || server == final {
			continue
		}

		matcher, ok := p.domainMatcher(rule)
		if !ok {
			continue
		}
		matcher["server"] = server
		rules = append(rules, matcher)
	}
	dns["final"] = final

	dns["servers"] = servers
	dns["rules"] = rules
	return dns
}

// dnsServer declares a resolver a rule named. Its queries leave the way the
// rule's traffic does: through the rule's server, or straight out for a
// direct rule. A resolver named by hostname is looked up with the bootstrap
// resolver, which never depends on the tunnel.
func dnsServer(tag string, parsed models.DNSServer, outbound string) map[string]any {
	if parsed.Type == "local" {
		return map[string]any{"type": "local", "tag": tag}
	}
	server := map[string]any{
		"type":        parsed.Type,
		"tag":         tag,
		"server":      parsed.Server,
		"server_port": parsed.Port,
	}
	if parsed.Path != "" {
		server["path"] = parsed.Path
	}
	if outbound != DirectTag {
		server["detour"] = outbound
	}
	if net.ParseIP(parsed.Server) == nil {
		server["domain_resolver"] = dnsDirectTag
	}
	return server
}

// appendRuleServers adds an outbound for every server the graph sends traffic
// through other than the connected one, and maps each profile id to the tag
// traffic for it should use. Those servers are reached through the same proxy
// chain as the connected one.
//
// A server that cannot be used — deleted, or a profile holding a complete
// config of its own — is left out with a warning, and its traffic falls back
// to the connected server rather than failing the connection.
func appendRuleServers(
	outbounds *[]map[string]any,
	endpoints *[]map[string]any,
	request Request,
	settings models.AppSettings,
	chainTags []string,
	dial func(models.Profile) (link.Outbound, error),
) (map[string]string, []string) {
	outboundFor := map[string]string{request.Profile.ID: ExitTag}
	var warnings []string

	wanted := []string{}
	if settings.DefaultAction == models.ActionProxy && settings.DefaultServer != "" {
		wanted = append(wanted, settings.DefaultServer)
	}
	for _, rule := range settings.UsableRules() {
		if rule.Action == models.ActionProxy && rule.Server != "" {
			wanted = append(wanted, rule.Server)
		}
	}

	byID := make(map[string]models.Profile, len(request.Profiles))
	for _, profile := range request.Profiles {
		byID[profile.ID] = profile
	}

	for _, id := range wanted {
		if _, done := outboundFor[id]; done {
			continue
		}
		profile, ok := byID[id]
		if !ok {
			warnings = append(warnings, "a routing rule points at a server that no longer exists; its traffic goes through the connected server")
			outboundFor[id] = ExitTag
			continue
		}
		if _, full := link.FullConfig(profile.ConfigLink); full {
			warnings = append(warnings, fmt.Sprintf("%s is a complete sing-box config and cannot be a routing destination; its traffic goes through the connected server", profile.Name))
			outboundFor[id] = ExitTag
			continue
		}
		outbound, err := dial(profile)
		if err != nil {
			warnings = append(warnings, fmt.Sprintf("%s cannot be a routing destination (%v); its traffic goes through the connected server", profile.Name, err))
			outboundFor[id] = ExitTag
			continue
		}
		tag := fmt.Sprintf("server-%d", len(outboundFor))
		outbound["tag"] = tag
		if len(chainTags) > 0 {
			outbound["detour"] = chainTags[len(chainTags)-1]
		}
		if outbound.IsEndpoint() {
			*endpoints = append(*endpoints, stripProbeFields(outbound))
		} else {
			*outbounds = append(*outbounds, outbound)
		}
		outboundFor[id] = tag
	}
	return outboundFor, warnings
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

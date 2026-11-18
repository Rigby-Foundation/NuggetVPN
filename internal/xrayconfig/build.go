package xrayconfig

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net"
	"os"
	"runtime"
	"sort"
	"strconv"
	"strings"

	"github.com/Rigby-Foundation/Kage/internal/link"
	"github.com/Rigby-Foundation/Kage/internal/models"
)

const (
	ExitTag      = "proxy"
	DirectTag    = "direct"
	DefaultOwner = "__default"
	TunTag       = "tun-in"
	MixedTag     = "mixed-in"
)

type Request struct {
	Profile       models.Profile
	Profiles      []models.Profile
	Settings      models.AppSettings
	MixedPort     int
	LocalRuleSets map[string]string
	CustomGeo     map[string]bool
	RuleLists     map[string]RuleList
	Alternatives  []models.Profile
	Resolve       func([]string) map[string][]string
	// DisableTUN is for local proxy integrations and unprivileged tests.
	DisableTUN bool
}

type Result struct {
	JSON       []byte
	Script     string
	RuleOwners []string
	ServerFor  map[string]string
	Warnings   []string
}

// RuleList points to the app's cached, parsed list, not a second core.
type RuleList struct{ Path, DomainsPath string }

func RuleSetTag(kind, value string) string { return kind + "-" + value }
func ListTag(address string) string {
	sum := sha256.Sum256([]byte(address))
	return "list-" + hex.EncodeToString(sum[:5])
}

func Build(request Request) (Result, error) {
	settings := request.Settings
	settings.Normalize()
	if err := validateRoutingCapabilities(settings.RoutingRules); err != nil {
		return Result{}, err
	}
	request.Settings = settings
	result := Result{ServerFor: map[string]string{}}
	outbounds := []map[string]any{}
	domains := []string{}
	chainTag := ""
	appendProfile := func(profile models.Profile, tag, via string) error {
		source, err := link.ParseOutbound(profile.ConfigLink, settings)
		if err != nil {
			return err
		}
		outbound, err := convert(source)
		if err != nil {
			return fmt.Errorf("%s: %w", profile.Name, err)
		}
		outbound["tag"] = tag
		stream, _ := outbound["streamSettings"].(map[string]any)
		if stream == nil {
			stream = map[string]any{}
			outbound["streamSettings"] = stream
		}
		socket, _ := stream["sockopt"].(map[string]any)
		if socket == nil {
			socket = map[string]any{}
			stream["sockopt"] = socket
		}
		// Server names use Xray's pre-resolved hosts/bootstrap DNS, never
		// the system resolver after that resolver has been routed into TUN.
		socket["domainStrategy"] = "UseIP"
		if stream, ok := outbound["streamSettings"].(map[string]any); ok {
			if settings.TLSFragment && (stream["network"] == "tcp" || stream["network"] == "raw") {
				stream["finalmask"] = map[string]any{"tcp": []any{map[string]any{"type": "fragment", "settings": map[string]any{"packets": "tlshello", "length": settings.TLSFragmentSize, "delay": settings.TLSFragmentSleep}}}}
			}
			if settings.TLSMixedSNICase {
				for _, key := range []string{"tlsSettings", "realitySettings"} {
					if tls, ok := stream[key].(map[string]any); ok {
						name := []byte(str(tls["serverName"]))
						for i, letter := range name {
							if i%2 == 0 && letter >= 'a' && letter <= 'z' {
								name[i] = letter - ('a' - 'A')
							}
						}
						tls["serverName"] = string(name)
					}
				}
			}
		}
		if via != "" {
			stream, _ := outbound["streamSettings"].(map[string]any)
			if stream == nil {
				stream = map[string]any{}
				outbound["streamSettings"] = stream
			}
			socket["dialerProxy"] = via
		}
		outbounds = append(outbounds, outbound)
		result.ServerFor[tag] = profile.ID
		if host := str(source["server"]); host != "" && net.ParseIP(host) == nil {
			domains = append(domains, host)
		}
		for _, peer := range list(source["peers"]) {
			if host := str(peer["address"]); host != "" && net.ParseIP(host) == nil {
				domains = append(domains, host)
			}
		}
		if transport, ok := source["transport"].(map[string]any); ok {
			if downlink, ok := transport["downloadSettings"].(map[string]any); ok {
				if host := str(downlink["server"]); host != "" && net.ParseIP(host) == nil {
					domains = append(domains, host)
				}
			}
		}
		return nil
	}
	if settings.ProxyChainEnabled {
		for _, id := range settings.ProxyChain {
			if id == request.Profile.ID {
				continue
			}
			for _, p := range request.Profiles {
				if p.ID == id {
					tag := fmt.Sprintf("hop-%d", len(outbounds))
					if err := appendProfile(p, tag, chainTag); err != nil {
						return result, err
					}
					chainTag = tag
					break
				}
			}
		}
	}
	if err := appendProfile(request.Profile, ExitTag, chainTag); err != nil {
		return result, err
	}
	// The first outbound is Xray's default. Routing normally makes that explicit.
	sort.SliceStable(outbounds, func(i, j int) bool { return str(outbounds[i]["tag"]) == ExitTag && str(outbounds[j]["tag"]) != ExitTag })
	servers := map[string]string{request.Profile.ID: ExitTag}
	targetRules := settings.UsableRules()
	targetRules = append(targetRules, models.RoutingRule{Action: models.ActionProxy, Server: settings.DefaultServer})
	for _, rule := range targetRules {
		if rule.Action != models.ActionProxy || rule.Server == "" || servers[rule.Server] != "" {
			continue
		}
		for _, p := range request.Profiles {
			if p.ID == rule.Server {
				tag := "server-" + strconv.Itoa(len(servers))
				if err := appendProfile(p, tag, chainTag); err != nil {
					return result, err
				}
				servers[p.ID] = tag
				break
			}
		}
	}
	var selectors []string
	if len(request.Alternatives) > 1 {
		selectors = append(selectors, ExitTag)
		for _, alternative := range request.Alternatives {
			if alternative.ID == request.Profile.ID {
				continue
			}
			tag := "alternative-" + strconv.Itoa(len(selectors))
			if err := appendProfile(alternative, tag, chainTag); err != nil {
				return result, err
			}
			selectors = append(selectors, tag)
		}
	}
	outbounds = append(outbounds,
		map[string]any{"tag": DirectTag, "protocol": "freedom", "settings": map[string]any{"domainStrategy": "UseIP"}},
		map[string]any{"tag": "block", "protocol": "blackhole", "settings": map[string]any{"response": map[string]any{"type": "http"}}},
		map[string]any{"tag": "drop", "protocol": "blackhole"},
		map[string]any{"tag": "dns-out", "protocol": "dns"},
	)
	script, owners, err := buildRouting(request, servers, false)
	if err != nil {
		return result, err
	}
	result.Script, result.RuleOwners = script, owners
	dns, err := buildDNS(request, domains)
	if err != nil {
		return result, err
	}
	config := map[string]any{"log": buildLog(settings), "inbounds": buildInbounds(settings, request.MixedPort, !request.DisableTUN, runtime.GOOS), "outbounds": outbounds, "dns": dns}
	if len(selectors) > 1 {
		config["routing"] = map[string]any{"balancers": []any{map[string]any{"tag": "fastest", "selector": selectors, "fallbackTag": ExitTag, "strategy": map[string]any{"type": "leastPing"}}}}
		config["observatory"] = map[string]any{"subjectSelector": selectors, "probeURL": "https://www.gstatic.com/generate_204", "probeInterval": "3m", "enableConcurrency": true}
	}
	result.JSON, err = json.MarshalIndent(config, "", "  ")
	return result, err
}

func buildLog(settings models.AppSettings) map[string]any {
	level := "warning"
	if !settings.LoggingOn() {
		level = "none"
	}
	return map[string]any{"loglevel": level}
}

func buildInbounds(settings models.AppSettings, port int, tun bool, platform string) []map[string]any {
	inbounds := []map[string]any{}
	sniff := map[string]any{"enabled": true, "destOverride": []string{"http", "tls", "quic"}, "routeOnly": true}
	if tun {
		options := map[string]any{"MTU": settings.MTU, "gateway": []string{"172.19.0.1/30", "fdfe:dcba:9876::1/126"}, "dns": []string{"172.19.0.2"}}
		if platform == "ios" || platform == "android" {
			// Mobile receives an existing VPN descriptor. A name avoids Xray's
			// unused-name discovery, which Android's sandbox cannot perform.
			options["name"] = "kage"
		} else {
			options["autoSystemRoutingTable"] = []string{"0.0.0.0/0", "::/0"}
			options["autoOutboundsInterface"] = "auto"
			if platform == "windows" {
				options["name"] = "NuggetVPN"
				options["autoSystemWfpBlockLeak"] = []string{"dns", "misconfigtun"}
			}
			if platform == "linux" {
				options["autoSystemDnsToGateway"] = true
			}
		}
		inbounds = append(inbounds, map[string]any{"tag": TunTag, "protocol": "tun", "settings": options, "sniffing": sniff})
	}
	if port > 0 {
		inbounds = append(inbounds, map[string]any{"tag": MixedTag, "listen": "127.0.0.1", "port": port, "protocol": "socks", "settings": map[string]any{"auth": "noauth", "udp": true}, "sniffing": sniff})
	}
	return inbounds
}

func buildDNS(request Request, domains []string) (map[string]any, error) {
	server, err := dnsAddress(request.Settings.DNS)
	if err != nil {
		return nil, err
	}
	hosts := map[string]any{}
	if request.Resolve != nil {
		for host, ips := range request.Resolve(dedupe(domains)) {
			if len(ips) > 0 {
				hosts[host] = ips
			}
		}
	}
	servers := []any{}
	if len(domains) > 0 {
		selectors := make([]string, 0, len(domains))
		for _, domain := range dedupe(domains) {
			selectors = append(selectors, "full:"+domain)
		}
		servers = append(servers, map[string]any{"address": "1.1.1.1", "domains": selectors, "tag": "dns-bootstrap", "skipFallback": true})
	}
	for _, rule := range request.Settings.UsableRules() {
		if rule.DNS == "" {
			continue
		}
		if rule.Invert || rule.Kind != models.SourceDomains {
			return nil, fmt.Errorf("rule %s: per-rule DNS requires a non-inverted domain rule", rule.ID)
		}
		address, err := dnsAddress(rule.DNS)
		if err != nil {
			return nil, err
		}
		address["domains"], address["skipFallback"] = domainValues(rule.Values), true
		servers = append(servers, address)
	}
	servers = append(servers, server)
	return map[string]any{"tag": "dns-query", "servers": servers, "hosts": hosts, "queryStrategy": "UseIP"}, nil
}

func dnsAddress(value string) (map[string]any, error) {
	dns, ok := models.ParseDNSServer(value)
	if !ok {
		return nil, fmt.Errorf("invalid DNS resolver %q", value)
	}
	switch dns.Type {
	case "udp":
		return map[string]any{"address": dns.Server, "port": dns.Port}, nil
	case "tcp", "https":
		return map[string]any{"address": dns.Type + "://" + net.JoinHostPort(dns.Server, strconv.Itoa(dns.Port)) + dns.Path}, nil
	default:
		return nil, fmt.Errorf("native Xray DNS does not support %s in tunneled mode; choose UDP, TCP or HTTPS", dns.Type)
	}
}

// Lockdown runs native Xray with a rejecting default while the app reconnects.
func Lockdown(settings models.AppSettings, ownPath string) (Result, error) {
	settings.Normalize()
	request := Request{Settings: settings}
	script, owners, err := buildRouting(request, nil, true)
	if err != nil {
		return Result{}, err
	}
	config := map[string]any{
		"log": buildLog(settings), "inbounds": buildInbounds(settings, 0, true, runtime.GOOS),
		"dns":       map[string]any{"tag": "dns-query", "servers": []any{map[string]any{"address": "1.1.1.1"}}},
		"outbounds": []any{map[string]any{"tag": "drop", "protocol": "blackhole"}, map[string]any{"tag": DirectTag, "protocol": "freedom"}, map[string]any{"tag": "dns-out", "protocol": "dns"}},
	}
	data, err := json.Marshal(config)
	return Result{JSON: data, Script: script, RuleOwners: owners}, err
}

func readList(file string) ([]string, []string, error) {
	data, err := os.ReadFile(file)
	if err != nil {
		return nil, nil, err
	}
	// Decode cached list keys explicitly; they remain readable across upgrades.
	var raw struct {
		Rules []map[string]json.RawMessage `json:"rules"`
	}
	if err = json.Unmarshal(data, &raw); err != nil {
		return nil, nil, err
	}
	var domains, ips []string
	for _, rule := range raw.Rules {
		for key, prefix := range map[string]string{"domain": "full:", "domain_suffix": "domain:", "domain_keyword": "keyword:", "domain_regex": "regexp:"} {
			var values []string
			_ = json.Unmarshal(rule[key], &values)
			for _, v := range values {
				if key == "domain_suffix" {
					domains = append(domains, domainValues([]string{v})...)
				} else {
					domains = append(domains, prefix+strings.TrimPrefix(v, "."))
				}
			}
		}
		var values []string
		_ = json.Unmarshal(rule["ip_cidr"], &values)
		ips = append(ips, values...)
	}
	return domains, ips, nil
}

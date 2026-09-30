// Package mihomo turns the app's servers and routing into a mihomo config.
//
// mihomo runs as the whole core: its own tunnel, DNS and rules. The routing
// graph is translated into Clash rules — combined and inverted rules into
// AND/OR/NOT, rule lists into inline rule providers, per-rule DNS into
// nameserver-policy — and whatever mihomo has no equivalent for is reported
// rather than silently dropped.
package mihomo

import (
	"encoding/json"
	"fmt"
	"os"
	"runtime"
	"strings"

	"gopkg.in/yaml.v3"

	"github.com/Rigby-Foundation/NuggetVPN/internal/link"
	"github.com/Rigby-Foundation/NuggetVPN/internal/models"
	"github.com/Rigby-Foundation/NuggetVPN/internal/sbconfig"
)

// Request describes one start.
type Request struct {
	Profile      models.Profile
	Profiles     []models.Profile
	Settings     models.AppSettings
	Alternatives []models.Profile
	MixedPort    int
	// RuleLists are the converted rule lists, by URL; see sbconfig.RuleList.
	RuleLists map[string]sbconfig.RuleList
}

// Result is the config and what the app needs to read mihomo's reports.
type Result struct {
	YAML []byte
	// Verbatim is set when the profile was a complete Clash config, run as
	// it is apart from the tunnel and the controller.
	Verbatim bool
	// ServerFor maps a proxy's name to its profile id.
	ServerFor map[string]string
	// RuleOwners maps a rule's payload, lowercased, to the routing rule it
	// came from; mihomo reports matched rules by payload.
	RuleOwners map[string]string
	Warnings   []string
}

// The same local names and addresses the built-in core keeps off the tunnel.
var (
	privateRanges = []string{"10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "169.254.0.0/16", "224.0.0.0/4", "255.255.255.255/32"}
	localSuffixes = []string{"local", "lan", "home.arpa", "msftconnecttest.com", "msftncsi.com"}
)

const proxyGroup = "PROXY"

// builder carries a build in progress.
type builder struct {
	request   Request
	settings  models.AppSettings
	proxies   []map[string]any
	names     map[string]bool
	serverFor map[string]string
	byProfile map[string]string
	chainTail string
	providers map[string]any
	owners    map[string]string
	policy    map[string]any
	warnings  []string
}

// Build produces mihomo's config for a profile.
func Build(request Request) (Result, error) {
	settings := request.Settings
	settings.Normalize()

	if config, ok := fullClashConfig(request.Profile.ConfigLink); ok {
		return buildVerbatim(config, request, settings)
	}

	b := &builder{
		request: request, settings: settings,
		names: map[string]bool{}, serverFor: map[string]string{}, byProfile: map[string]string{},
		providers: map[string]any{}, owners: map[string]string{}, policy: map[string]any{},
	}

	// The proxy chain: each hop dials through the previous one.
	if settings.ProxyChainEnabled {
		for _, id := range settings.ProxyChain {
			if id == request.Profile.ID {
				continue
			}
			hop, ok := profileByID(request.Profiles, id)
			if !ok {
				continue
			}
			name, err := b.addProxy(hop, b.chainTail)
			if err != nil {
				return Result{}, fmt.Errorf("proxy chain hop %q: %w", hop.Name, err)
			}
			b.chainTail = name
		}
	}

	exit, err := b.proxyFor(request.Profile)
	if err != nil {
		return Result{}, err
	}
	members := []string{exit}
	for _, alternative := range request.Alternatives {
		if alternative.ID == request.Profile.ID {
			continue
		}
		if name, err := b.proxyFor(alternative); err == nil {
			members = append(members, name)
		}
	}
	group := map[string]any{"name": proxyGroup, "type": "select", "proxies": members}
	if len(members) > 1 {
		group = map[string]any{
			"name": proxyGroup, "type": "url-test", "proxies": members,
			"url": "https://www.gstatic.com/generate_204", "interval": 180, "tolerance": 80,
		}
	}

	rules := b.rules()

	config := map[string]any{
		"mixed-port":          request.MixedPort,
		"allow-lan":           false,
		"bind-address":        "127.0.0.1",
		"mode":                "rule",
		"log-level":           logLevel(settings),
		"ipv6":                false,
		"find-process-mode":   "always",
		"unified-delay":       true,
		"tcp-concurrent":      true,
		"profile":             map[string]any{"store-selected": false, "store-fake-ip": false},
		"geo-auto-update":     false,
		"tun":                 tun(settings),
		"dns":                 b.dns(),
		"sniffer":             sniffer(),
		"proxies":             b.proxies,
		"proxy-groups":        []any{group},
		"rules":               rules,
	}
	if len(b.providers) > 0 {
		config["rule-providers"] = b.providers
	}
	if len(settings.GeoFiles) > 0 {
		b.warnings = append(b.warnings, "mihomo uses its own geo data; your geoip.dat and geosite.dat are used by the built-in core only")
	}

	data, err := yaml.Marshal(config)
	if err != nil {
		return Result{}, err
	}
	return Result{YAML: data, ServerFor: b.serverFor, RuleOwners: b.owners, Warnings: b.warnings}, nil
}

// proxyFor adds a server as a proxy, through the chain, once.
func (b *builder) proxyFor(profile models.Profile) (string, error) {
	if name, ok := b.byProfile[profile.ID]; ok {
		return name, nil
	}
	name, err := b.addProxy(profile, b.chainTail)
	if err != nil {
		return "", err
	}
	b.byProfile[profile.ID] = name
	b.serverFor[name] = profile.ID
	return name, nil
}

func (b *builder) addProxy(profile models.Profile, via string) (string, error) {
	name := strings.TrimSpace(profile.Name)
	if name == "" {
		name = "Server"
	}
	for base, index := name, 2; b.names[name] || name == proxyGroup || name == "DIRECT" || name == "REJECT"; index++ {
		name = fmt.Sprintf("%s (%d)", base, index)
	}

	var proxy map[string]any
	if single, ok := singleClashProxy(profile.ConfigLink); ok {
		// Already a mihomo proxy; only its name is ours.
		proxy = single
		proxy["name"] = name
	} else {
		if _, full := link.FullConfig(profile.ConfigLink); full {
			return "", fmt.Errorf("%s is a complete sing-box config, which mihomo cannot run", profile.Name)
		}
		outbound, err := link.ParseOutbound(profile.ConfigLink, b.settings)
		if err != nil {
			return "", err
		}
		proxy, err = proxyFrom(name, outbound)
		if err != nil {
			return "", fmt.Errorf("%s: %w", profile.Name, err)
		}
	}
	if via != "" {
		proxy["dialer-proxy"] = via
	}
	b.names[name] = true
	b.proxies = append(b.proxies, proxy)
	return name, nil
}

// target is where a rule sends its traffic, in mihomo's words.
func (b *builder) target(action, server string) string {
	switch action {
	case models.ActionDirect:
		return "DIRECT"
	case models.ActionBlock:
		return "REJECT"
	case models.ActionDrop:
		return "REJECT-DROP"
	}
	if server != "" {
		if profile, ok := profileByID(b.request.Profiles, server); ok {
			if name, err := b.proxyFor(profile); err == nil {
				return name
			} else {
				b.warnings = append(b.warnings, fmt.Sprintf("%s cannot be a routing destination (%v); its traffic goes through the connected server", profile.Name, err))
			}
		} else {
			b.warnings = append(b.warnings, "a routing rule points at a server that no longer exists; its traffic goes through the connected server")
		}
	}
	return proxyGroup
}

// rules translates the routing graph, after the fixed local rules.
func (b *builder) rules() []string {
	rules := []string{}
	for _, suffix := range localSuffixes {
		rules = append(rules, "DOMAIN-SUFFIX,"+suffix+",DIRECT")
	}
	for _, cidr := range privateRanges {
		rules = append(rules, "IP-CIDR,"+cidr+",DIRECT,no-resolve")
	}

	for _, rule := range b.settings.UsableRules() {
		target := b.target(rule.Action, rule.Server)
		lines, err := b.ruleLines(rule, target)
		if err != nil {
			b.warnings = append(b.warnings, err.Error())
			continue
		}
		rules = append(rules, lines...)
		b.addDNSPolicy(rule)
	}

	b.owners["match"] = sbconfig.DefaultOwner
	rules = append(rules, "MATCH,"+b.target(b.settings.DefaultAction, b.settings.DefaultServer))
	return rules
}

// atom is one mihomo matcher: "DOMAIN-SUFFIX,example.com".
type atom struct {
	kind, value string
	noResolve   bool
}

func (a atom) text() string { return a.kind + "," + a.value }

// reportedTypes are how mihomo names each rule type when it reports which
// rule a connection matched — "DomainSuffix", not "DOMAIN-SUFFIX". Read from
// a running mihomo 1.19.
var reportedTypes = map[string]string{
	"DOMAIN": "Domain", "DOMAIN-SUFFIX": "DomainSuffix", "DOMAIN-REGEX": "DomainRegex",
	"IP-CIDR": "IPCIDR", "IP-CIDR6": "IPCIDR", "DST-PORT": "DstPort", "NETWORK": "Network",
	"GEOSITE": "GeoSite", "GEOIP": "GeoIP", "RULE-SET": "RuleSet",
	"PROCESS-NAME": "ProcessName", "PROCESS-PATH": "ProcessPath",
}

// reported is the atom as mihomo prints it inside a combined rule.
func (a atom) reported() string { return "(" + reportedTypes[a.kind] + "," + a.value + ")" }

// written and reported are one rule expression in the form mihomo reads and
// the form it reports a match in; the second is how a connection is traced
// back to the routing rule.
type expr struct{ written, reported string }

// logical joins parts with AND or OR.
func logical(kind string, parts []expr) expr {
	written := make([]string, len(parts))
	reported := make([]string, len(parts))
	for index, part := range parts {
		written[index], reported[index] = part.written, part.reported
	}
	separator := " && "
	if kind == "OR" {
		separator = " || "
	}
	return expr{
		written:  "(" + kind + ",(" + strings.Join(written, ",") + "))",
		reported: "(" + kind + ",(" + strings.Join(reported, separator) + "))",
	}
}

// negate wraps an expression in NOT.
func negate(inner expr) expr {
	return expr{written: "(NOT,(" + inner.written + "))", reported: "(NOT,(!" + inner.reported + "))"}
}

// payloadOf strips "(KIND," and ")" off an expression, leaving what goes in
// a rule line after the kind.
func payloadOf(inner string) (kind, payload string) {
	body := strings.TrimSuffix(strings.TrimPrefix(inner, "("), ")")
	kind, payload, _ = strings.Cut(body, ",")
	return kind, payload
}

// atoms translates one condition, or explains why it cannot be.
func (b *builder) atoms(condition models.RoutingCondition) ([]atom, error) {
	var result []atom
	for _, value := range condition.CleanValues() {
		switch condition.Kind {
		case models.SourceApps:
			if strings.ContainsAny(value, `/\`) {
				result = append(result, atom{kind: "PROCESS-PATH", value: value})
				continue
			}
			result = append(result, atom{kind: "PROCESS-NAME", value: value})
			if runtime.GOOS == "windows" && !strings.Contains(value, ".") {
				result = append(result, atom{kind: "PROCESS-NAME", value: value + ".exe"})
			}
		case models.SourceDomains:
			domain := strings.TrimPrefix(strings.TrimPrefix(strings.ToLower(value), "*."), ".")
			result = append(result, atom{kind: "DOMAIN-SUFFIX", value: strings.TrimSuffix(domain, ".")})
		case models.SourceDomainRegex:
			result = append(result, atom{kind: "DOMAIN-REGEX", value: value})
		case models.SourceIP:
			cidr := value
			if !strings.Contains(cidr, "/") {
				if strings.Contains(cidr, ":") {
					cidr += "/128"
				} else {
					cidr += "/32"
				}
			}
			kind := "IP-CIDR"
			if strings.Contains(cidr, ":") {
				kind = "IP-CIDR6"
			}
			result = append(result, atom{kind: kind, value: cidr, noResolve: true})
		case models.SourcePort:
			result = append(result, atom{kind: "DST-PORT", value: value})
		case models.SourceNetwork:
			result = append(result, atom{kind: "NETWORK", value: strings.ToUpper(value)})
		case models.SourceGeoSite:
			result = append(result, atom{kind: "GEOSITE", value: value})
		case models.SourceGeoIP:
			result = append(result, atom{kind: "GEOIP", value: strings.ToUpper(value), noResolve: true})
		case models.SourceRuleSet:
			name, err := b.provider(value)
			if err != nil {
				return nil, err
			}
			result = append(result, atom{kind: "RULE-SET", value: name})
		case models.SourceProtocol:
			return nil, fmt.Errorf("mihomo cannot match by detected protocol (%s); that rule is left out", value)
		}
	}
	if len(result) == 0 {
		return nil, fmt.Errorf("a %s rule had nothing mihomo could use; it is left out", condition.Kind)
	}
	return result, nil
}

// expression writes a condition as a logical sub-rule: "(DOMAIN,a)", or
// "(OR,((DOMAIN,a),(DOMAIN,b)))" for several values, negated with NOT.
func expression(atoms []atom, invert bool) expr {
	var result expr
	if len(atoms) == 1 {
		result = expr{written: "(" + atoms[0].text() + ")", reported: atoms[0].reported()}
	} else {
		parts := make([]expr, len(atoms))
		for index, item := range atoms {
			parts[index] = expr{written: "(" + item.text() + ")", reported: item.reported()}
		}
		result = logical("OR", parts)
	}
	if invert {
		result = negate(result)
	}
	return result
}

// ruleLines translates one routing rule into mihomo rule lines.
func (b *builder) ruleLines(rule models.RoutingRule, target string) ([]string, error) {
	owner := func(payload string) {
		key := strings.ToLower(payload)
		if _, taken := b.owners[key]; !taken {
			b.owners[key] = rule.ID
		}
	}

	if rule.Kind != models.SourceLogical {
		atoms, err := b.atoms(rule.Matcher())
		if err != nil {
			return nil, err
		}
		if !rule.Invert {
			// The plain case: a line per value, as Clash rules are written.
			lines := make([]string, 0, len(atoms))
			for _, item := range atoms {
				line := item.kind + "," + item.value + "," + target
				if item.noResolve {
					line += ",no-resolve"
				}
				lines = append(lines, line)
				owner(item.value)
			}
			return lines, nil
		}
		// "Except these": NOT of the values together.
		kind, payload := payloadOf(negate(expression(atoms, false)).written)
		_, reported := payloadOf(negate(expression(atoms, false)).reported)
		owner(reported)
		return []string{kind + "," + payload + "," + target}, nil
	}

	parts := []expr{}
	for _, condition := range rule.UsableConditions() {
		atoms, err := b.atoms(condition)
		if err != nil {
			if rule.Mode == models.LogicalAnd {
				// Leaving out a condition of "all of" would widen the rule.
				return nil, err
			}
			b.warnings = append(b.warnings, err.Error())
			continue
		}
		parts = append(parts, expression(atoms, condition.Invert))
	}
	if len(parts) == 0 {
		return nil, fmt.Errorf("a combined rule had nothing mihomo could use; it is left out")
	}
	kind := "AND"
	if rule.Mode == models.LogicalOr {
		kind = "OR"
	}
	combined := logical(kind, parts)
	if rule.Invert {
		combined = negate(combined)
	}
	lineKind, payload := payloadOf(combined.written)
	_, reported := payloadOf(combined.reported)
	owner(reported)
	return []string{lineKind + "," + payload + "," + target}, nil
}

// provider makes a rule list available as an inline rule provider and
// returns its name. Only lists the app converted can be used: mihomo reads
// neither sing-box's compiled .srs nor its .json rule-sets.
func (b *builder) provider(address string) (string, error) {
	name := sbconfig.ListTag(address)
	if _, done := b.providers[name]; done {
		return name, nil
	}
	if _, native := sbconfig.NativeListFormat(address); native {
		return "", fmt.Errorf("mihomo cannot read the sing-box rule list %s; that rule is left out", address)
	}
	list, ok := b.request.RuleLists[address]
	if !ok {
		return "", fmt.Errorf("rule list %s is not downloaded; that rule is left out", address)
	}
	payload, err := classical(list.Path)
	if err != nil {
		return "", fmt.Errorf("rule list %s: %v", address, err)
	}
	b.providers[name] = map[string]any{"type": "inline", "behavior": "classical", "payload": payload}
	return name, nil
}

// classical turns a converted list (a sing-box source rule-set) into Clash
// rule lines.
func classical(path string) ([]string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var set struct {
		Rules []struct {
			Domain        []string `json:"domain"`
			DomainSuffix  []string `json:"domain_suffix"`
			DomainKeyword []string `json:"domain_keyword"`
			DomainRegex   []string `json:"domain_regex"`
			IPCIDR        []string `json:"ip_cidr"`
		} `json:"rules"`
	}
	if err := json.Unmarshal(data, &set); err != nil {
		return nil, err
	}
	var lines []string
	for _, rule := range set.Rules {
		for _, value := range rule.Domain {
			lines = append(lines, "DOMAIN,"+value)
		}
		for _, value := range rule.DomainSuffix {
			lines = append(lines, "DOMAIN-SUFFIX,"+strings.TrimPrefix(value, "."))
		}
		for _, value := range rule.DomainKeyword {
			lines = append(lines, "DOMAIN-KEYWORD,"+value)
		}
		for _, value := range rule.DomainRegex {
			lines = append(lines, "DOMAIN-REGEX,"+value)
		}
		for _, value := range rule.IPCIDR {
			kind := "IP-CIDR"
			if strings.Contains(value, ":") {
				kind = "IP-CIDR6"
			}
			lines = append(lines, kind+","+value+",no-resolve")
		}
	}
	return lines, nil
}

// addDNSPolicy sends a rule's domains to its own resolver.
func (b *builder) addDNSPolicy(rule models.RoutingRule) {
	if rule.DNS == "" || !rule.MatchesDomains() {
		return
	}
	parsed, ok := models.ParseDNSServer(rule.DNS)
	if !ok {
		b.warnings = append(b.warnings, fmt.Sprintf("DNS server %q is not an address this app understands; the rule uses the default resolver", rule.DNS))
		return
	}
	server := dnsAddress(parsed)
	for _, condition := range rule.Matchers() {
		if condition.Invert {
			continue
		}
		for _, value := range condition.Values {
			switch condition.Kind {
			case models.SourceDomains:
				domain := strings.TrimPrefix(strings.TrimPrefix(strings.ToLower(value), "*."), ".")
				b.policy["+."+domain] = server
			case models.SourceGeoSite:
				b.policy["geosite:"+value] = server
			case models.SourceRuleSet:
				if _, native := sbconfig.NativeListFormat(value); !native {
					b.policy["rule-set:"+sbconfig.ListTag(value)] = server
				}
			}
		}
	}
}

// dnsAddress writes a resolver the way mihomo takes it.
func dnsAddress(server models.DNSServer) string {
	host := server.Server
	if strings.Contains(host, ":") {
		host = "[" + host + "]"
	}
	switch server.Type {
	case "local":
		return "system"
	case "udp":
		return fmt.Sprintf("%s:%d", host, server.Port)
	case "https":
		return fmt.Sprintf("https://%s:%d%s", host, server.Port, server.Path)
	case "h3":
		return fmt.Sprintf("https://%s:%d%s#h3=true", host, server.Port, server.Path)
	default:
		return fmt.Sprintf("%s://%s:%d", server.Type, host, server.Port)
	}
}

func (b *builder) dns() map[string]any {
	resolver := strings.TrimSpace(b.settings.DNS)
	bootstrap := resolver
	if !isIP(bootstrap) {
		bootstrap = "1.1.1.1"
	}
	config := map[string]any{
		"enable":        true,
		"ipv6":          false,
		"enhanced-mode": "redir-host",
		// Queries follow the rules: a proxied site's name is looked up
		// through the proxy, at the far end, like the built-in core does.
		"respect-rules":           true,
		"default-nameserver":      []string{bootstrap},
		"proxy-server-nameserver": []string{resolver},
		"nameserver":              []string{resolver},
	}
	if len(b.policy) > 0 {
		config["nameserver-policy"] = b.policy
	}
	return config
}

func tun(settings models.AppSettings) map[string]any {
	config := map[string]any{
		"enable":                true,
		"stack":                 "mixed",
		"auto-route":            true,
		"auto-detect-interface": true,
		"dns-hijack":            []string{"any:53"},
		"mtu":                   settings.MTU,
		"route-exclude-address": privateRanges,
		"device":                "NuggetVPN",
	}
	// Same as the built-in core: strict routing is Linux and Windows only,
	// and macOS picks its own utun name.
	if runtime.GOOS != "darwin" {
		config["strict-route"] = true
	} else {
		delete(config, "device")
	}
	return config
}

func sniffer() map[string]any {
	return map[string]any{
		"enable": true,
		"sniff": map[string]any{
			"TLS":  map[string]any{"ports": []any{443, 8443}},
			"HTTP": map[string]any{"ports": []any{80, "8080-8880"}, "override-destination": true},
			"QUIC": map[string]any{"ports": []any{443, 8443}},
		},
	}
}

func logLevel(settings models.AppSettings) string {
	if !settings.LoggingOn() {
		return "silent"
	}
	return "info"
}

func profileByID(profiles []models.Profile, id string) (models.Profile, bool) {
	for _, profile := range profiles {
		if profile.ID == id {
			return profile, true
		}
	}
	return models.Profile{}, false
}

// fullClashConfig reports a profile that is a whole Clash config — proxies
// with rules or groups — rather than a single server.
func fullClashConfig(raw string) (map[string]any, bool) {
	trimmed := strings.TrimSpace(raw)
	if !strings.Contains(trimmed, "proxies:") {
		return nil, false
	}
	var config map[string]any
	if yaml.Unmarshal([]byte(trimmed), &config) != nil {
		return nil, false
	}
	_, rules := config["rules"]
	_, groups := config["proxy-groups"]
	if _, proxies := config["proxies"]; !proxies || (!rules && !groups) {
		return nil, false
	}
	return config, true
}

// singleClashProxy reports a profile saved as one Clash proxy entry.
func singleClashProxy(raw string) (map[string]any, bool) {
	trimmed := strings.TrimSpace(raw)
	if !strings.Contains(trimmed, "type:") || !strings.Contains(trimmed, "server:") {
		return nil, false
	}
	var root any
	if yaml.Unmarshal([]byte(trimmed), &root) != nil {
		return nil, false
	}
	switch value := root.(type) {
	case map[string]any:
		if proxies, ok := value["proxies"].([]any); ok && len(proxies) > 0 {
			if first, ok := proxies[0].(map[string]any); ok {
				return first, true
			}
		}
		if _, ok := value["type"]; ok {
			return value, true
		}
	case []any:
		if len(value) > 0 {
			if first, ok := value[0].(map[string]any); ok {
				return first, true
			}
		}
	}
	return nil, false
}

// buildVerbatim runs a complete Clash config as it is, except for what the
// app has to own: the tunnel and the local proxy port. Any API it asks for
// is dropped: mihomo runs inside the privileged service, which reads it
// directly.
func buildVerbatim(config map[string]any, request Request, settings models.AppSettings) (Result, error) {
	config["tun"] = tun(settings)
	for _, key := range []string{"external-controller", "external-controller-tls", "external-controller-unix",
		"external-controller-pipe", "external-controller-cors", "external-doh-server", "secret"} {
		delete(config, key)
	}
	config["mixed-port"] = request.MixedPort
	config["allow-lan"] = false
	config["find-process-mode"] = "always"
	delete(config, "external-ui")
	if _, ok := config["dns"]; !ok {
		b := &builder{settings: settings}
		config["dns"] = b.dns()
	}
	data, err := yaml.Marshal(config)
	if err != nil {
		return Result{}, err
	}
	return Result{YAML: data, Verbatim: true, ServerFor: map[string]string{}, RuleOwners: map[string]string{"match": sbconfig.DefaultOwner}}, nil
}

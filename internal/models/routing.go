package models

import (
	"net/netip"
	"net/url"
	"regexp"
	"strconv"
	"strings"
)

// The routing graph.
//
// A rule says "traffic matching this source goes to this destination". Rules
// are evaluated in order, and whatever matches nothing takes DefaultAction.
// That is the whole model: it maps directly onto sing-box route rules, and
// directly onto the node graph the UI draws.
//
// It replaces a three-way RoutingMode enum that could only express "send these
// apps and domains through the tunnel, everything else direct". There was no
// way to say "this goes direct", no way to block anything, and no way to match
// an IP range at all.

// Source kinds a rule can match on.
const (
	SourceApps        = "apps"
	SourceDomains     = "domains"
	SourceIP          = "ip"
	SourceDomainRegex = "domain_regex"
	SourcePort        = "port"
	SourceProtocol    = "protocol"
	SourceGeoSite     = "geosite"
	SourceGeoIP       = "geoip"
	// SourceNetwork matches the transport: "tcp" or "udp".
	SourceNetwork = "network"
	// SourceRuleSet matches a rule list downloaded from a URL.
	SourceRuleSet = "ruleset"
	// SourceLogical combines conditions: all of them, or any of them.
	SourceLogical = "logical"
)

// Networks a network rule may match.
const (
	NetworkTCP = "tcp"
	NetworkUDP = "udp"
)

// How a logical rule combines its conditions.
const (
	LogicalAnd = "and"
	LogicalOr  = "or"
)

// maxConditions bounds a logical rule. The UI builds them by hand; a hundred
// is far beyond anything readable.
const maxConditions = 100

// Protocols the core can identify by sniffing a connection.
var sniffableProtocols = []string{
	"tls", "http", "quic", "dns", "stun", "bittorrent", "dtls", "ssh", "rdp", "ntp",
}

// SniffableProtocols lists what a protocol rule may match, for the UI.
func SniffableProtocols() []string {
	return append([]string(nil), sniffableProtocols...)
}

// Destinations a rule can send traffic to.
const (
	ActionProxy  = "proxy"
	ActionDirect = "direct"
	// ActionBlock refuses the connection, so the app learns at once and
	// gives up or falls back.
	ActionBlock = "block"
	// ActionDrop discards the connection without answering. The app waits
	// until it times out, which slows down trackers that retry on refusal.
	ActionDrop = "drop"
)

// RoutingComment is a note on the routing canvas.
type RoutingComment struct {
	ID   string `json:"id"`
	Text string `json:"text"`
}

// maxCommentLength bounds a note, in characters.
const maxCommentLength = 2000

// Point is a node position on the routing canvas.
type Point struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

// RoutingRule is one source-to-destination edge in the graph.
type RoutingRule struct {
	ID   string `json:"id"`
	Kind string `json:"kind"`
	// Values are process names or paths, domains, or IP/CIDR entries,
	// depending on Kind.
	Values []string `json:"values"`
	Action string   `json:"action"`

	// Invert matches everything the entries do not: "every app except
	// these".
	Invert bool `json:"invert,omitempty"`
	// Server sends proxied traffic through this profile rather than the
	// connected one. Empty means the connected server. Only meaningful when
	// Action is ActionProxy; a profile that no longer exists falls back to
	// the connected server.
	Server string `json:"server,omitempty"`
	// DNS resolves the domains this rule matches with this server, instead
	// of the default resolver. See ParseDNSServer for what it accepts.
	DNS string `json:"dns,omitempty"`

	// Mode and Conditions are for SourceLogical: the conditions all have to
	// match (LogicalAnd) or any one of them (LogicalOr). Values is unused.
	Mode       string             `json:"mode,omitempty"`
	Conditions []RoutingCondition `json:"conditions,omitempty"`
}

// RoutingCondition is one part of a logical rule: a matcher with no
// destination of its own.
type RoutingCondition struct {
	Kind   string   `json:"kind"`
	Values []string `json:"values"`
	Invert bool     `json:"invert,omitempty"`
}

// ValidSourceKind reports whether kind is one this build understands.
func ValidSourceKind(kind string) bool {
	return validMatcherKind(kind) || kind == SourceLogical
}

// validMatcherKind reports whether kind matches on its own values, which is
// every kind but a logical one. Only these can be a logical rule's condition:
// the UI has no way to show a combination inside a combination.
func validMatcherKind(kind string) bool {
	switch kind {
	case SourceApps, SourceDomains, SourceIP,
		SourceDomainRegex, SourcePort, SourceProtocol,
		SourceGeoSite, SourceGeoIP, SourceNetwork, SourceRuleSet:
		return true
	}
	return false
}

// Matcher returns the rule as a single condition. For a logical rule it is
// meaningless; use Conditions.
func (r RoutingRule) Matcher() RoutingCondition {
	return RoutingCondition{Kind: r.Kind, Values: r.Values, Invert: r.Invert}
}

// UsableConditions returns the conditions of a logical rule that would match
// anything, cleaned.
func (r RoutingRule) UsableConditions() []RoutingCondition {
	result := make([]RoutingCondition, 0, len(r.Conditions))
	for _, condition := range r.Conditions {
		if !validMatcherKind(condition.Kind) {
			continue
		}
		values := condition.CleanValues()
		if len(values) == 0 {
			continue
		}
		condition.Values = values
		result = append(result, condition)
	}
	return result
}

// Domains reports whether the matcher is about domain names, which is what
// decides whether a per-rule DNS server has anything to resolve.
func (c RoutingCondition) Domains() bool {
	switch c.Kind {
	case SourceDomains, SourceDomainRegex, SourceGeoSite, SourceRuleSet:
		return true
	}
	return false
}

// ValidRuleSetURL accepts an http(s) address of a rule list.
func ValidRuleSetURL(value string) bool {
	parsed, err := url.Parse(value)
	if err != nil || parsed.Host == "" {
		return false
	}
	return parsed.Scheme == "https" || parsed.Scheme == "http"
}

// ValidPortValue accepts a single port or an inclusive range, "8000-8080".
//
// The bounds are checked here rather than left to the core because a rule the
// core refuses fails the whole configuration, taking every other rule with it.
func ValidPortValue(value string) bool {
	low, high, isRange := strings.Cut(value, "-")
	lowPort, ok := parsePort(low)
	if !ok {
		return false
	}
	if !isRange {
		return true
	}
	highPort, ok := parsePort(high)
	return ok && highPort >= lowPort
}

func parsePort(value string) (int, bool) {
	port, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil || port < 1 || port > 65535 {
		return 0, false
	}
	return port, true
}

// ValidProtocol reports whether the core can sniff for this protocol.
func ValidProtocol(value string) bool {
	for _, protocol := range sniffableProtocols {
		if protocol == strings.ToLower(strings.TrimSpace(value)) {
			return true
		}
	}
	return false
}

// validGeoToken accepts the category and country names used by rule-sets.
// They become part of a URL, so anything else is refused rather than fetched.
//
// site allows the two extra characters geosite.dat codes use: "geolocation-!cn",
// and "google@cn" for the entries carrying an attribute. Country codes have
// neither.
func validGeoToken(value string, site bool) bool {
	if value == "" || len(value) > 64 {
		return false
	}
	for _, char := range value {
		switch {
		case char >= 'a' && char <= 'z',
			char >= '0' && char <= '9',
			char == '-', char == '_':
		case site && (char == '!' || char == '@'):
		default:
			return false
		}
	}
	return true
}

// ValidAction reports whether action is a destination this build understands.
func ValidAction(action string) bool {
	switch action {
	case ActionProxy, ActionDirect, ActionBlock, ActionDrop:
		return true
	}
	return false
}

// CleanValues returns the rule's usable entries. A logical rule has none of
// its own.
func (r RoutingRule) CleanValues() []string {
	if r.Kind == SourceLogical {
		return nil
	}
	return r.Matcher().CleanValues()
}

// CleanValues trims the rule's entries and drops the ones that cannot match
// anything, so a half-typed row in the UI never reaches the config generator.
func (c RoutingCondition) CleanValues() []string {
	result := make([]string, 0, len(c.Values))
	seen := make(map[string]bool, len(c.Values))

	for _, value := range c.Values {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			continue
		}
		// Geo tokens and protocols are case-insensitive names; normalising
		// here means "US" and "us" are the same rule rather than two.
		switch c.Kind {
		case SourceGeoSite, SourceGeoIP, SourceProtocol, SourceNetwork:
			trimmed = strings.ToLower(trimmed)
		}
		if seen[trimmed] || !c.validValue(trimmed) {
			continue
		}
		seen[trimmed] = true
		result = append(result, trimmed)
	}
	return result
}

// validValue rejects an entry the core would refuse. A bad entry has to be
// dropped rather than passed along: the core fails the whole configuration
// over one malformed matcher, which would take every other rule down with it.
func (c RoutingCondition) validValue(value string) bool {
	switch c.Kind {
	case SourceIP:
		return validPrefix(value)
	case SourcePort:
		return ValidPortValue(value)
	case SourceProtocol:
		return ValidProtocol(value)
	case SourceGeoSite:
		return validGeoToken(value, true)
	case SourceGeoIP:
		return validGeoToken(value, false)
	case SourceDomainRegex:
		_, err := regexp.Compile(value)
		return err == nil
	case SourceNetwork:
		return value == NetworkTCP || value == NetworkUDP
	case SourceRuleSet:
		return ValidRuleSetURL(value)
	default:
		return true
	}
}

// Usable reports whether the rule would produce a sing-box rule.
func (r RoutingRule) Usable() bool {
	if !ValidSourceKind(r.Kind) || !ValidAction(r.Action) {
		return false
	}
	if r.Kind == SourceLogical {
		return len(r.UsableConditions()) > 0
	}
	return len(r.CleanValues()) > 0
}

// Matchers returns what the rule matches on, as conditions: its own entries,
// or a logical rule's parts.
func (r RoutingRule) Matchers() []RoutingCondition {
	if r.Kind == SourceLogical {
		return r.UsableConditions()
	}
	matcher := r.Matcher()
	matcher.Values = matcher.CleanValues()
	return []RoutingCondition{matcher}
}

// MatchesDomains reports whether a per-rule DNS server would have anything to
// resolve: the rule matches on domains, and nothing inverts that. "Every
// domain except these" is not a list of names to send anywhere.
func (r RoutingRule) MatchesDomains() bool {
	if r.Invert {
		return false
	}
	matchers := r.Matchers()
	if len(matchers) == 0 {
		return false
	}
	// A logical rule only has a domain list to hand the resolver when its
	// domain conditions are required (all of) or are its only conditions.
	domains := 0
	for _, matcher := range matchers {
		if matcher.Domains() && !matcher.Invert {
			domains++
		}
	}
	if r.Kind != SourceLogical || r.Mode == LogicalAnd {
		return domains > 0
	}
	return domains == len(matchers)
}

// validPrefix accepts both a bare address and a CIDR block, which is what the
// UI lets people type.
func validPrefix(value string) bool {
	if _, err := netip.ParsePrefix(value); err == nil {
		return true
	}
	_, err := netip.ParseAddr(value)
	return err == nil
}

// normalizeRouting validates the graph and, on first run after the upgrade,
// builds it from the old RoutingMode fields.
func (s *AppSettings) normalizeRouting() {
	if s.RoutingLayout == nil {
		s.RoutingLayout = map[string]Point{}
	}

	// Migrate only settings that predate the graph entirely: no rules key *and*
	// no default chosen. Keying off the rules alone would rebuild them from the
	// legacy fields — and overwrite the chosen default — for anyone who had
	// simply deleted every rule.
	if s.RoutingRules == nil && s.DefaultAction == "" {
		s.RoutingRules = migrateLegacyRouting(s)
	}
	if s.RoutingRules == nil {
		s.RoutingRules = []RoutingRule{}
	}
	if !ValidAction(s.DefaultAction) {
		s.DefaultAction = ActionProxy
	}

	kept := make([]RoutingRule, 0, len(s.RoutingRules))
	for index, rule := range s.RoutingRules {
		if !ValidSourceKind(rule.Kind) || !ValidAction(rule.Action) {
			continue
		}
		if rule.ID == "" {
			rule.ID = ruleID(rule.Kind, index)
		}
		if rule.Values == nil {
			rule.Values = []string{}
		}
		rule.Server = strings.TrimSpace(rule.Server)
		if rule.Action != ActionProxy {
			rule.Server = ""
		}
		rule.DNS = strings.TrimSpace(rule.DNS)
		if rule.Kind == SourceLogical {
			if rule.Mode != LogicalOr {
				rule.Mode = LogicalAnd
			}
			conditions := make([]RoutingCondition, 0, len(rule.Conditions))
			for _, condition := range rule.Conditions {
				if !validMatcherKind(condition.Kind) || len(conditions) == maxConditions {
					continue
				}
				if condition.Values == nil {
					condition.Values = []string{}
				}
				conditions = append(conditions, condition)
			}
			rule.Conditions = conditions
		} else {
			rule.Mode = ""
			rule.Conditions = nil
		}
		kept = append(kept, rule)
	}
	s.RoutingRules = kept

	s.DefaultServer = strings.TrimSpace(s.DefaultServer)
	if s.DefaultAction != ActionProxy {
		s.DefaultServer = ""
	}
	servers := make([]string, 0, len(s.RoutingServers))
	seenServers := map[string]bool{}
	for _, id := range s.RoutingServers {
		id = strings.TrimSpace(id)
		if id == "" || seenServers[id] {
			continue
		}
		seenServers[id] = true
		servers = append(servers, id)
	}
	s.RoutingServers = servers

	comments := make([]RoutingComment, 0, len(s.RoutingComments))
	for _, comment := range s.RoutingComments {
		if strings.TrimSpace(comment.ID) == "" {
			continue
		}
		if runes := []rune(comment.Text); len(runes) > maxCommentLength {
			comment.Text = string(runes[:maxCommentLength])
		}
		comments = append(comments, comment)
	}
	s.RoutingComments = comments
}

// migrateLegacyRouting turns the pre-graph settings into equivalent rules, so
// an upgrade keeps routing exactly the traffic it routed yesterday.
func migrateLegacyRouting(s *AppSettings) []RoutingRule {
	mode := s.RoutingMode
	if mode == RoutingSelected {
		mode = RoutingAppsDomains
	}

	// "all" meant a full tunnel: no rules, everything through the proxy.
	if mode == "" || mode == RoutingAll {
		s.DefaultAction = ActionProxy
		return []RoutingRule{}
	}

	// Every other mode meant "only the listed things are tunnelled".
	s.DefaultAction = ActionDirect

	rules := []RoutingRule{}
	if mode == RoutingApps || mode == RoutingAppsDomains {
		if len(s.RoutingApps) > 0 {
			rules = append(rules, RoutingRule{
				ID:     "migrated-apps",
				Kind:   SourceApps,
				Values: s.RoutingApps,
				Action: ActionProxy,
			})
		}
	}
	if mode == RoutingDomains || mode == RoutingAppsDomains {
		if len(s.RoutingDomains) > 0 {
			rules = append(rules, RoutingRule{
				ID:     "migrated-domains",
				Kind:   SourceDomains,
				Values: s.RoutingDomains,
				Action: ActionProxy,
			})
		}
	}
	return rules
}

func ruleID(kind string, index int) string {
	return kind + "-" + itoa(index+1)
}

func itoa(value int) string {
	if value == 0 {
		return "0"
	}
	var digits []byte
	for value > 0 {
		digits = append([]byte{byte('0' + value%10)}, digits...)
		value /= 10
	}
	return string(digits)
}

// SplitTunnelling reports whether any traffic avoids the proxy.
//
// It gates fake-IP DNS, which is only safe when every connection is resolved at
// the far end of the tunnel. One rule sending anything direct or to the bin is
// enough to make it unsafe.
func (s AppSettings) SplitTunnelling() bool {
	if s.DefaultAction != ActionProxy {
		return true
	}
	for _, rule := range s.RoutingRules {
		if rule.Action != ActionProxy {
			return true
		}
	}
	return false
}

// UsableRules returns the rules that will actually be emitted.
func (s AppSettings) UsableRules() []RoutingRule {
	result := make([]RoutingRule, 0, len(s.RoutingRules))
	for _, rule := range s.RoutingRules {
		if rule.Usable() {
			result = append(result, rule)
		}
	}
	return result
}

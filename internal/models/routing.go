package models

import (
	"net/netip"
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
)

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
	ActionBlock  = "block"
)

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
}

// ValidSourceKind reports whether kind is one this build understands.
func ValidSourceKind(kind string) bool {
	switch kind {
	case SourceApps, SourceDomains, SourceIP,
		SourceDomainRegex, SourcePort, SourceProtocol,
		SourceGeoSite, SourceGeoIP:
		return true
	}
	return false
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
func validGeoToken(value string) bool {
	if value == "" || len(value) > 64 {
		return false
	}
	for _, char := range value {
		switch {
		case char >= 'a' && char <= 'z',
			char >= '0' && char <= '9',
			char == '-', char == '_':
		default:
			return false
		}
	}
	return true
}

// ValidAction reports whether action is a destination this build understands.
func ValidAction(action string) bool {
	switch action {
	case ActionProxy, ActionDirect, ActionBlock:
		return true
	}
	return false
}

// CleanValues trims the rule's entries and drops the ones that cannot match
// anything, so a half-typed row in the UI never reaches the config generator.
func (r RoutingRule) CleanValues() []string {
	result := make([]string, 0, len(r.Values))
	seen := make(map[string]bool, len(r.Values))

	for _, value := range r.Values {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			continue
		}
		// Geo tokens and protocols are case-insensitive names; normalising
		// here means "US" and "us" are the same rule rather than two.
		switch r.Kind {
		case SourceGeoSite, SourceGeoIP, SourceProtocol:
			trimmed = strings.ToLower(trimmed)
		}
		if seen[trimmed] || !r.validValue(trimmed) {
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
func (r RoutingRule) validValue(value string) bool {
	switch r.Kind {
	case SourceIP:
		return validPrefix(value)
	case SourcePort:
		return ValidPortValue(value)
	case SourceProtocol:
		return ValidProtocol(value)
	case SourceGeoSite, SourceGeoIP:
		return validGeoToken(value)
	case SourceDomainRegex:
		_, err := regexp.Compile(value)
		return err == nil
	default:
		return true
	}
}

// Usable reports whether the rule would produce a sing-box rule.
func (r RoutingRule) Usable() bool {
	return ValidSourceKind(r.Kind) && ValidAction(r.Action) && len(r.CleanValues()) > 0
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
		kept = append(kept, rule)
	}
	s.RoutingRules = kept
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

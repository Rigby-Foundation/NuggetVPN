// Package models holds the data types shared between the UI, storage and the
// sing-box config generator. The JSON tags are deliberately identical to the
// ones the previous Rust build wrote, so existing profiles.json / settings.json
// files keep working after the migration.
package models

import "strings"

// Profile is a single saved proxy entry.
type Profile struct {
	ID              string  `json:"id"`
	Name            string  `json:"name"`
	Server          string  `json:"server"`
	Protocol        string  `json:"protocol"`
	ConfigLink      string  `json:"config_link"`
	SourceDomain    string  `json:"source_domain"`
	SubscriptionURL string  `json:"subscription_url"`
	TotalUp         *uint64 `json:"total_up"`
	TotalDown       *uint64 `json:"total_down"`
}

// NormalizedSourceDomain reports the grouping key for a profile; profiles that
// were added by hand report "local".
func (p Profile) NormalizedSourceDomain() string {
	if domain := strings.TrimSpace(p.SourceDomain); domain != "" {
		return domain
	}
	return "local"
}

// Legacy routing modes. These are read once, to migrate settings written before
// the routing graph existed, and then never again — see normalizeRouting.
const (
	RoutingAll         = "all"
	RoutingApps        = "apps"
	RoutingDomains     = "domains"
	RoutingAppsDomains = "apps_domains"
	RoutingSelected    = "selected" // older alias for apps_domains
)

// AppSettings mirrors the settings object the frontend owns.
type AppSettings struct {
	MTU              uint32 `json:"mtu"`
	DNS              string `json:"dns"`
	TLSFragment      bool   `json:"tls_fragment"`
	TLSFragmentSize  string `json:"tls_fragment_size"`
	TLSFragmentSleep string `json:"tls_fragment_sleep"`
	TLSMixedSNICase  bool   `json:"tls_mixed_sni_case"`
	TLSPadding       bool   `json:"tls_padding"`
	SNISpoofEnabled  bool   `json:"sni_spoof_enabled"`
	SNISpoofValue    string `json:"sni_spoof_value"`
	// IPCheckEnabled governs the public-address lookup, which is a request to a
	// third party. A pointer so an existing settings.json that predates the
	// setting is treated as "not chosen" and defaults to on, rather than
	// silently switching the feature off on upgrade.
	IPCheckEnabled    *bool   `json:"ip_check_enabled"`
	AuthServer        *string `json:"auth_server"`
	AuthToken         *string `json:"auth_token"`
	SkipAuth          bool    `json:"skip_auth"`
	PendingSyncUpload bool    `json:"pending_sync_upload"`

	// The routing graph. RoutingRules is nil (not empty) only on settings
	// written before it existed, which is what triggers the one-time migration
	// from the fields below it.
	RoutingRules  []RoutingRule    `json:"routing_rules"`
	DefaultAction string           `json:"default_action"`
	RoutingLayout map[string]Point `json:"routing_layout"`

	// Superseded by RoutingRules; kept so an upgrade can migrate them and so a
	// downgrade does not lose the user's old configuration.
	RoutingMode    string   `json:"routing_mode"`
	RoutingApps    []string `json:"routing_apps"`
	RoutingDomains []string `json:"routing_domains"`

	ProxyChainEnabled bool     `json:"proxy_chain_enabled"`
	ProxyChain        []string `json:"proxy_chain"`
	ProxyChainExit    string   `json:"proxy_chain_exit"`
}

// DefaultSettings is the configuration a fresh install starts from.
func DefaultSettings() AppSettings {
	enabled := true
	return AppSettings{
		MTU:              9000,
		DNS:              "1.1.1.1",
		TLSFragmentSize:  "100-200",
		TLSFragmentSleep: "10-20",
		IPCheckEnabled:   &enabled,
		RoutingRules:     []RoutingRule{},
		DefaultAction:    ActionProxy,
		RoutingLayout:    map[string]Point{},
		RoutingMode:      RoutingAll,
		RoutingApps:      []string{},
		RoutingDomains:   []string{},
		ProxyChain:       []string{},
	}
}

// Normalize fills in values that must never be empty once the settings reach
// the config generator, and migrates the routing graph on first load.
//
// This is the only place any of that happens: the renderer used to keep its own
// copy of the same rules, which is one contract in two languages waiting to
// drift apart.
func (s *AppSettings) Normalize() {
	if s.MTU == 0 {
		s.MTU = 9000
	}
	if strings.TrimSpace(s.DNS) == "" {
		s.DNS = "1.1.1.1"
	}
	if s.IPCheckEnabled == nil {
		enabled := true
		s.IPCheckEnabled = &enabled
	}
	if s.RoutingApps == nil {
		s.RoutingApps = []string{}
	}
	if s.RoutingDomains == nil {
		s.RoutingDomains = []string{}
	}
	if s.ProxyChain == nil {
		s.ProxyChain = []string{}
	}
	s.normalizeRouting()
}

// IPCheckOn reports whether the public-address lookup may run.
func (s AppSettings) IPCheckOn() bool {
	return s.IPCheckEnabled == nil || *s.IPCheckEnabled
}

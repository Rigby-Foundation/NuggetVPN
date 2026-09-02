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

// RoutingMode values accepted from the UI.
const (
	RoutingAll         = "all"
	RoutingApps        = "apps"
	RoutingDomains     = "domains"
	RoutingAppsDomains = "apps_domains"
	RoutingSelected    = "selected" // legacy alias for apps_domains
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
	IPCheckEnabled    *bool    `json:"ip_check_enabled"`
	AuthServer        *string  `json:"auth_server"`
	AuthToken         *string  `json:"auth_token"`
	SkipAuth          bool     `json:"skip_auth"`
	PendingSyncUpload bool     `json:"pending_sync_upload"`
	RoutingMode       string   `json:"routing_mode"`
	RoutingApps       []string `json:"routing_apps"`
	RoutingDomains    []string `json:"routing_domains"`
	ProxyChainEnabled bool     `json:"proxy_chain_enabled"`
	ProxyChain        []string `json:"proxy_chain"`
	ProxyChainExit    string   `json:"proxy_chain_exit"`
}

// DefaultSettings matches the previous Rust defaults.
func DefaultSettings() AppSettings {
	enabled := true
	return AppSettings{
		MTU:              9000,
		DNS:              "1.1.1.1",
		TLSFragmentSize:  "100-200",
		TLSFragmentSleep: "10-20",
		IPCheckEnabled:   &enabled,
		RoutingMode:      RoutingAll,
		RoutingApps:      []string{},
		RoutingDomains:   []string{},
		ProxyChain:       []string{},
	}
}

// Normalize fills in values that must never be empty once the settings reach
// the config generator, and collapses the legacy "selected" routing mode.
//
// This is the only place either of those happens: the renderer used to keep its
// own copy of the same rules, which is one contract in two languages waiting to
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
	switch s.RoutingMode {
	case RoutingAll, RoutingApps, RoutingDomains, RoutingAppsDomains:
	case RoutingSelected:
		s.RoutingMode = RoutingAppsDomains
	default:
		s.RoutingMode = RoutingAll
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
}

// IPCheckOn reports whether the public-address lookup may run.
func (s AppSettings) IPCheckOn() bool {
	return s.IPCheckEnabled == nil || *s.IPCheckEnabled
}

// SplitTunnelling reports whether traffic should default to DIRECT and only
// matched apps/domains go through the proxy.
func (s AppSettings) SplitTunnelling() bool { return s.RoutingMode != RoutingAll }

// IncludeApps reports whether per-process routing rules should be emitted.
func (s AppSettings) IncludeApps() bool {
	return s.RoutingMode == RoutingApps || s.RoutingMode == RoutingAppsDomains
}

// IncludeDomains reports whether per-domain routing rules should be emitted.
func (s AppSettings) IncludeDomains() bool {
	return s.RoutingMode == RoutingDomains || s.RoutingMode == RoutingAppsDomains
}

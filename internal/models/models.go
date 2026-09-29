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

	// How this client presents itself when fetching a subscription. Some
	// panels gate the endpoint on the User-Agent, and some count devices by
	// the x-hwid header and refuse the request without one — see identity.go.
	SubscriptionUserAgent string `json:"subscription_user_agent"`
	HWIDEnabled           *bool  `json:"hwid_enabled"`
	HWID                  string `json:"hwid"`
	DeviceOS              string `json:"device_os"`
	DeviceOSVersion       string `json:"device_os_version"`
	DeviceModel           string `json:"device_model"`

	// The routing graph. RoutingRules is nil (not empty) only on settings
	// written before it existed, which is what triggers the one-time migration
	// from the fields below it.
	RoutingRules  []RoutingRule    `json:"routing_rules"`
	DefaultAction string           `json:"default_action"`
	RoutingLayout map[string]Point `json:"routing_layout"`
	// RoutingComments are notes placed on the canvas. They change nothing
	// about routing; their positions are in RoutingLayout, by id.
	RoutingComments []RoutingComment `json:"routing_comments"`

	// Superseded by RoutingRules; kept so an upgrade can migrate them and so a
	// downgrade does not lose the user's old configuration.
	RoutingMode    string   `json:"routing_mode"`
	RoutingApps    []string `json:"routing_apps"`
	RoutingDomains []string `json:"routing_domains"`

	ProxyChainEnabled bool     `json:"proxy_chain_enabled"`
	ProxyChain        []string `json:"proxy_chain"`
	ProxyChainExit    string   `json:"proxy_chain_exit"`

	// BeamMigration records the answer to the first-start offer to import
	// from Beam, so it is asked once: "" (not yet asked), BeamMigrationDone
	// or BeamMigrationDismissed. Settings still offers it either way.
	BeamMigration string `json:"beam_migration"`

	// LastSelection is the server the user last picked, so reopening the app
	// lands on it rather than on the first subscription. Nil until one is
	// chosen.
	LastSelection *Selection `json:"last_selection"`

	// Behaviour.
	//
	// LaunchAtStartup is not really stored: the system owns it, and it can be
	// changed from outside the app, so it is read back from the system on
	// every load and applied to it on save. See internal/autostart.
	LaunchAtStartup bool `json:"launch_at_startup"`
	// AutoConnect connects to the last server when the app starts.
	AutoConnect bool `json:"auto_connect"`
	// SubscriptionAutoUpdate refreshes subscriptions at start and on a timer.
	// Off means never automatically, for every subscription — a refresh by
	// hand still works. A pointer so older settings default to on.
	SubscriptionAutoUpdate *bool `json:"subscription_auto_update"`
	// CloseAction is what closing the window does: CloseToTray,
	// CloseHideCompletely or CloseQuit.
	CloseAction string `json:"close_action"`

	// GeoFiles are the user's own geoip.dat / geosite.dat, keyed by kind
	// ("geoip", "geosite"). While one is present, geo rules of that kind use
	// it instead of the built-in rule-sets. The files themselves live in
	// storage.GeoDir; this records where each came from.
	GeoFiles map[string]GeoFile `json:"geo_files"`
}

// GeoFile describes an imported geoip.dat or geosite.dat.
type GeoFile struct {
	// Source is "file" for one picked from disk, "url" for one downloaded;
	// a URL can be downloaded again to update it.
	Source    string `json:"source"`
	Name      string `json:"name"`
	URL       string `json:"url,omitempty"`
	Codes     int    `json:"codes"`
	UpdatedAt int64  `json:"updated_at"`
}

// What closing the window does.
const (
	// CloseToTray hides the window; the tray icon brings it back.
	CloseToTray = "tray"
	// CloseHideCompletely hides the window and the tray icon too. The app
	// keeps running, and launching it again brings the window back.
	CloseHideCompletely = "hide"
	// CloseQuit exits, disconnecting on the way out.
	CloseQuit = "quit"
)

// Selection is which configuration and server the user is pointed at.
type Selection struct {
	Domain    string `json:"domain"`
	Mode      string `json:"mode"`
	ProfileID string `json:"profile_id"`
	// ProfileName is the fallback when the id is gone: a subscription that
	// changed a server's link keeps its name far more often than not.
	ProfileName string `json:"profile_name"`
}

// Answers to the Beam migration offer.
const (
	BeamMigrationDone      = "done"
	BeamMigrationDismissed = "dismissed"
)

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
	if s.GeoFiles == nil {
		s.GeoFiles = map[string]GeoFile{}
	}
	if s.SubscriptionAutoUpdate == nil {
		enabled := true
		s.SubscriptionAutoUpdate = &enabled
	}
	switch s.CloseAction {
	case CloseToTray, CloseHideCompletely, CloseQuit:
	default:
		// What closing has always done here.
		s.CloseAction = CloseToTray
	}
	s.normalizeRouting()
	s.normalizeIdentity()
}

// IPCheckOn reports whether the public-address lookup may run.
func (s AppSettings) IPCheckOn() bool {
	return s.IPCheckEnabled == nil || *s.IPCheckEnabled
}

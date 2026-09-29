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
	// Favorite pins the server to the top of its list.
	Favorite bool `json:"favorite,omitempty"`
	// SubscriptionInfo is what the subscription said about itself when it
	// was last fetched; the same for every profile of one subscription.
	SubscriptionInfo *SubscriptionInfo `json:"subscription_info,omitempty"`
}

// SubscriptionInfo is a subscription's account details, as its server
// reports them in response headers. Sizes are bytes; a zero Total means no
// data limit and a zero Expire no expiry date.
type SubscriptionInfo struct {
	Upload   int64 `json:"upload"`
	Download int64 `json:"download"`
	Total    int64 `json:"total"`
	// Expire is a unix time in seconds.
	Expire int64 `json:"expire"`
	// Title is the provider's name for the subscription.
	Title      string `json:"title,omitempty"`
	SupportURL string `json:"support_url,omitempty"`
	WebPageURL string `json:"web_page_url,omitempty"`
	// UpdatedAt is when this was read, in unix seconds.
	UpdatedAt int64 `json:"updated_at"`
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
	IPCheckEnabled *bool `json:"ip_check_enabled"`
	// LoggingEnabled keeps a log: the Logs screen, session.log and the
	// core's own log. Nil until chosen, which means on in a development
	// build and off in a release, where nobody asked for a record of what
	// they connected to.
	LoggingEnabled    *bool   `json:"logging_enabled"`
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
	// DefaultServer is the profile unmatched traffic goes through when
	// DefaultAction is ActionProxy; empty means the connected server.
	DefaultServer string `json:"default_server"`
	// RoutingServers are the server destinations placed on the canvas, by
	// profile id. A rule points at one through RoutingRule.Server; this list
	// keeps a destination on the canvas while nothing is wired to it yet.
	RoutingServers []string `json:"routing_servers"`

	// RoutingSetups are the saved routing graphs the user switches between.
	// The active one is edited in the fields above, and written back into
	// its entry here when another is switched to — so its entry here can be
	// out of date, and the fields above are the truth for it.
	RoutingSetups      []RoutingSetup `json:"routing_setups"`
	ActiveRoutingSetup string         `json:"active_routing_setup"`

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
	// AutoReconnect brings the tunnel back when it stops without being
	// asked to. A pointer so older settings default to on.
	AutoReconnect *bool `json:"auto_reconnect"`
	// KillSwitch blocks all traffic while the tunnel is being brought back,
	// so nothing leaves unprotected in the meantime.
	KillSwitch bool `json:"kill_switch"`
	// FastestServer, in automatic mode, lets the core keep measuring the
	// best servers and move traffic to whichever is fastest.
	FastestServer bool `json:"fastest_server"`
	// Notifications shows a system notification when the connection drops
	// and when it comes back. A pointer so older settings default to on.
	Notifications *bool `json:"notifications"`
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
	if s.LoggingEnabled == nil {
		enabled := DevBuild
		s.LoggingEnabled = &enabled
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
	if s.Notifications == nil {
		enabled := true
		s.Notifications = &enabled
	}
	if s.AutoReconnect == nil {
		enabled := true
		s.AutoReconnect = &enabled
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
	s.normalizeSetups()
	s.normalizeIdentity()
}

// LoggingOn reports whether logs are kept; see LoggingEnabled.
func (s AppSettings) LoggingOn() bool {
	if s.LoggingEnabled == nil {
		return DevBuild
	}
	return *s.LoggingEnabled
}

// IPCheckOn reports whether the public-address lookup may run.
func (s AppSettings) IPCheckOn() bool {
	return s.IPCheckEnabled == nil || *s.IPCheckEnabled
}

package beam

import (
	"context"
	"encoding/json"
	"fmt"
	"net/netip"
	"net/url"
	"regexp"
	"strings"

	"github.com/google/uuid"

	"github.com/Rigby-Foundation/NuggetVPN/internal/models"
)

// Item is one line of "what comes across" or "what does not", for the UI.
type Item struct {
	Label  string `json:"label"`
	Detail string `json:"detail"`
}

// SubscriptionPreview describes one Beam profile without exposing its URL,
// which is the credential for that subscription.
type SubscriptionPreview struct {
	Name     string `json:"name"`
	Provider string `json:"provider"`
	// Host is empty for a profile that was added by hand rather than from a
	// subscription.
	Host string `json:"host"`
	// CachedNodes counts the usable servers Beam had saved, placeholders
	// excluded.
	CachedNodes int   `json:"cached_nodes"`
	ExpiresAt   int64 `json:"expires_at"`
	DataUsed    int64 `json:"data_used"`
	DataLimit   int64 `json:"data_limit"`
}

// Preview is what a migration would do, computed without doing any of it.
type Preview struct {
	Subscriptions []SubscriptionPreview `json:"subscriptions"`
	Carried       []Item                `json:"carried"`
	Skipped       []Item                `json:"skipped"`
	// Theme is the NuggetVPN preset matching Beam's theme, or empty. It lives
	// in the renderer rather than in settings.json, so the UI applies it.
	Theme string `json:"theme"`
	// Appearance holds the font, corner and transition choices, mapped onto
	// this app's option ids; like the theme, the UI applies them.
	Appearance Appearance `json:"appearance"`
}

// Appearance is Beam's look, in this app's option ids. An empty field means
// Beam's choice had no equivalent, and the current one is kept.
type Appearance struct {
	Font   string `json:"font"`
	Radius string `json:"radius"`
	Motion string `json:"motion"`
}

// NewPreview summarises data for the offer dialog.
func NewPreview(data *Data) Preview {
	preview := Preview{Subscriptions: []SubscriptionPreview{}}
	for _, profile := range data.Profiles {
		preview.Subscriptions = append(preview.Subscriptions, SubscriptionPreview{
			Name:        strings.TrimSpace(profile.Name),
			Provider:    strings.TrimSpace(profile.Provider),
			Host:        hostOf(profile.URL),
			CachedNodes: len(usableNodes(profile)),
			ExpiresAt:   profile.ExpiresAt,
			DataUsed:    profile.DataUsed,
			DataLimit:   profile.DataLimit,
		})
	}

	// The preview applies the settings to a throwaway default, purely to find
	// out what would be carried; nothing is saved.
	_, preview.Carried, preview.Skipped = ApplySettings(models.DefaultSettings(), data.Settings)
	preview.Theme, _ = themeFor(data.Settings)
	preview.Appearance = appearanceFor(data.Settings)
	if data.Settings != nil && preview.Theme == "" && strings.TrimSpace(data.Settings.Appearance.Theme) != "" {
		preview.Skipped = append(preview.Skipped, Item{
			Label:  "Theme",
			Detail: fmt.Sprintf("Beam's %q theme has no equivalent here.", data.Settings.Appearance.Theme),
		})
	}
	if len(data.Unreadable) > 0 {
		preview.Skipped = append(preview.Skipped, Item{
			Label:  "Unreadable profiles",
			Detail: strings.Join(data.Unreadable, ", "),
		})
	}
	return preview
}

// happVersion is what a Happ version string may look like. Anything else is
// replaced with the default rather than sent to a provider verbatim.
var happVersion = regexp.MustCompile(`^[0-9]+(\.[0-9]+){0,3}$`)

// ApplySettings carries Beam's settings onto current and reports what it did.
func ApplySettings(current models.AppSettings, beam *Settings) (models.AppSettings, []Item, []Item) {
	carried := []Item{}
	skipped := []Item{}
	if beam == nil {
		return current, carried, skipped
	}
	next := current

	// Identity first, and it is the part that matters most. Providers that cap
	// devices count them by this id: arriving with a new one takes a second
	// slot, and on a plan that is already full the subscription is refused.
	compat := beam.HappCompat
	if hwid := strings.TrimSpace(compat.HWID); hwid != "" {
		if models.ValidHWID(hwid) {
			next.HWID = hwid
			carried = append(carried, Item{
				Label:  "Device id",
				Detail: "Kept, so providers that limit devices see the same device, not a new one.",
			})
		} else {
			skipped = append(skipped, Item{
				Label:  "Device id",
				Detail: "Not in a format providers accept, so NuggetVPN's own is used.",
			})
		}
	}
	switch strings.ToLower(strings.TrimSpace(compat.HWIDMode)) {
	case "off", "disabled", "none", "false":
		off := false
		next.HWIDEnabled = &off
		carried = append(carried, Item{Label: "Device headers", Detail: "Off, as in Beam."})
	}
	if compat.Enabled {
		version := strings.TrimSpace(compat.UserAgentVersion)
		agent := models.HappUserAgent
		if happVersion.MatchString(version) {
			agent = "Happ/" + version
		}
		next.SubscriptionUserAgent = agent
		carried = append(carried, Item{Label: "Client identity", Detail: agent})
	}

	if dns := strings.TrimSpace(beam.Connection.PrimaryDNS); dns != "" {
		next.DNS = dns
		carried = append(carried, Item{Label: "DNS server", Detail: dns})
	}
	if mtu := beam.Connection.MTU; mtu >= 576 && mtu <= 65535 {
		next.MTU = uint32(mtu)
		carried = append(carried, Item{Label: "MTU", Detail: fmt.Sprint(mtu)})
	}

	next, carried, skipped = applySplitTunnel(next, beam, carried, skipped)

	if len(beam.ProTunGraph.Nodes) > 0 {
		skipped = append(skipped, Item{
			Label:  "Advanced routing graph",
			Detail: "Beam's graph has no direct translation; rebuild it on the Routing page.",
		})
	}
	return next, carried, skipped
}

// applySplitTunnel turns Beam's split tunnel into routing rules.
//
// "exclude" sends the listed traffic around the tunnel; "include" sends only
// the listed traffic through it, which here is the same rules pointing the
// other way with the default flipped to direct.
func applySplitTunnel(next models.AppSettings, beam *Settings, carried, skipped []Item) (models.AppSettings, []Item, []Item) {
	split := beam.SplitTunnel
	if !split.Enabled {
		return next, carried, skipped
	}

	sources := []struct {
		kind   string
		values []string
	}{
		{models.SourceApps, appNames(split.Apps)},
		{models.SourceDomains, cleanList(split.Domains)},
		{models.SourceIP, cleanList(split.IPs)},
	}
	total := 0
	for _, source := range sources {
		total += len(source.values)
	}
	if total == 0 {
		return next, carried, skipped
	}

	var ruleAction, defaultAction, summary string
	switch strings.ToLower(strings.TrimSpace(split.Mode)) {
	case "exclude":
		ruleAction, defaultAction = models.ActionDirect, models.ActionProxy
		summary = "the listed apps and sites bypass the VPN"
	case "include":
		ruleAction, defaultAction = models.ActionProxy, models.ActionDirect
		summary = "only the listed apps and sites use the VPN"
	default:
		skipped = append(skipped, Item{
			Label:  "Split tunnelling",
			Detail: fmt.Sprintf("Unrecognised mode %q.", split.Mode),
		})
		return next, carried, skipped
	}

	// Rules someone already built here are theirs; the migration does not
	// merge into them or overwrite them.
	if len(next.RoutingRules) > 0 {
		skipped = append(skipped, Item{
			Label:  "Split tunnelling",
			Detail: "You already have routing rules here, so they were left alone.",
		})
		return next, carried, skipped
	}

	rules := []models.RoutingRule{}
	for _, source := range sources {
		if len(source.values) == 0 {
			continue
		}
		rules = append(rules, models.RoutingRule{
			ID:     "beam-" + source.kind,
			Kind:   source.kind,
			Values: source.values,
			Action: ruleAction,
		})
	}
	next.RoutingRules = rules
	next.DefaultAction = defaultAction
	carried = append(carried, Item{
		Label:  "Split tunnelling",
		Detail: fmt.Sprintf("%d entries; %s.", total, summary),
	})
	return next, carried, skipped
}

// appNames reads Beam's app list, which may hold plain names or objects.
func appNames(raw []json.RawMessage) []string {
	names := []string{}
	for _, item := range raw {
		var name string
		if json.Unmarshal(item, &name) == nil {
			names = append(names, name)
			continue
		}
		var object map[string]any
		if json.Unmarshal(item, &object) != nil {
			continue
		}
		for _, key := range []string{"path", "process", "name", "exe"} {
			if value, ok := object[key].(string); ok && strings.TrimSpace(value) != "" {
				names = append(names, value)
				break
			}
		}
	}
	return cleanList(names)
}

func cleanList(values []string) []string {
	seen := map[string]bool{}
	cleaned := []string{}
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" || seen[trimmed] {
			continue
		}
		seen[trimmed] = true
		cleaned = append(cleaned, trimmed)
	}
	return cleaned
}

// themeAliases maps Beam theme ids onto NuggetVPN presets. Only "rose" has
// been seen in a real settings file; the rest follow the names Beam shows in
// its picker, with the obvious spellings of each.
var themeAliases = map[string]string{
	"system": "system",
	"light":  "light",
	"dark":   "dark",
	"amoled": "oled", "oled": "oled", "black": "oled",
	"cosmic": "cosmos", "cosmos": "cosmos", "space": "cosmos", "blue": "cosmos",
	"purple": "violet", "violet": "violet",
	"slate":   "slate",
	"stone":   "stone",
	"emerald": "emerald", "green": "emerald",
	"sunset": "sunset",
	"nord":   "nord",
	"rose":   "rose", "pink": "rose",
	"mocha": "mocha",
}

// Font, corner and transition ids. Beam's are "rubik", "medium" and "slide"
// in a real settings file; the aliases cover the other names its picker shows.
var (
	fontAliases = map[string]string{
		"rubik": "rubik", "manrope": "manrope", "geologica": "geologica", "onest": "onest",
		"system": "system",
	}
	radiusAliases = map[string]string{
		"small": "small", "medium": "medium", "large": "large",
		"round": "round", "rounded": "round", "full": "round",
	}
	motionAliases = map[string]string{
		"slide": "slide", "bottom": "rise", "up": "rise", "rise": "rise",
		"fade": "fade", "none": "none", "off": "none",
	}
)

func appearanceFor(beam *Settings) Appearance {
	if beam == nil {
		return Appearance{}
	}
	lookup := func(aliases map[string]string, value string) string {
		return aliases[strings.ToLower(strings.TrimSpace(value))]
	}
	return Appearance{
		Font:   lookup(fontAliases, beam.Appearance.Font),
		Radius: lookup(radiusAliases, beam.Appearance.Radius),
		Motion: lookup(motionAliases, beam.Appearance.Animation),
	}
}

func themeFor(beam *Settings) (string, bool) {
	if beam == nil {
		return "", false
	}
	theme, ok := themeAliases[strings.ToLower(strings.TrimSpace(beam.Appearance.Theme))]
	return theme, ok
}

// ---------------------------------------------------------------------------
// Migration
// ---------------------------------------------------------------------------

// Fetch retrieves a subscription's profiles using the given settings, which
// carry the identity headers.
type Fetch func(ctx context.Context, settings models.AppSettings, subscriptionURL string) ([]models.Profile, error)

// Where a migrated subscription's servers came from.
const (
	// SourceFetched: fetched fresh from the provider.
	SourceFetched = "fetched"
	// SourceCached: Beam's saved copy, because the fetch failed. It will be
	// replaced on the next successful refresh.
	SourceCached = "cached"
	// SourceFailed: neither worked, and nothing was imported.
	SourceFailed = "failed"
	// SourceLocal: servers added to Beam by hand; there is nothing to fetch.
	SourceLocal = "local"
)

// Outcome reports what happened to one Beam profile.
type Outcome struct {
	Name     string `json:"name"`
	Host     string `json:"host"`
	Profiles int    `json:"profiles"`
	Source   string `json:"source"`
	Note     string `json:"note,omitempty"`
}

// Selection is the server Beam had selected, located among the new profiles.
type Selection struct {
	Domain    string `json:"domain"`
	ProfileID string `json:"profile_id"`
}

// Result is the state after a migration, ready to be saved.
type Result struct {
	Profiles   []models.Profile
	Settings   models.AppSettings
	Outcomes   []Outcome
	Selection  *Selection
	Theme      string
	Appearance Appearance
}

// Migrate carries data onto the current profiles and settings.
//
// Settings are applied before any subscription is fetched, and the fetch is
// made with them. That ordering is the point: the provider has to see Beam's
// device id and client identity, or the migration registers this app as a new
// device — which, on a plan with a device limit, can be the request that gets
// refused.
//
// A subscription is fetched fresh rather than trusting Beam's copy, which may
// be days old. Beam's copy is the fallback when the fetch fails, so migrating
// offline still produces a working client.
func Migrate(
	ctx context.Context,
	data *Data,
	profiles []models.Profile,
	settings models.AppSettings,
	fetch Fetch,
) Result {
	next, _, _ := ApplySettings(settings, data.Settings)
	next.Normalize()

	result := Result{Settings: next, Outcomes: []Outcome{}}
	result.Theme, _ = themeFor(data.Settings)
	result.Appearance = appearanceFor(data.Settings)

	existing := append([]models.Profile(nil), profiles...)
	var added []models.Profile
	hostsSeen := map[string]bool{}

	for _, beamProfile := range data.Profiles {
		subURL := strings.TrimSpace(beamProfile.URL)
		host := hostOf(subURL)
		outcome := Outcome{Name: displayName(beamProfile), Host: host}

		var imported []models.Profile
		var nodeProfiles map[string]string // Beam node id -> new profile id

		if host == "" {
			outcome.Source = SourceLocal
			imported, nodeProfiles = convertNodes(beamProfile, "local", "")
			imported = withoutDuplicates(imported, existing, added)
		} else {
			fetched, err := fetch(ctx, next, subURL)
			switch {
			case err == nil && len(fetched) > 0:
				outcome.Source = SourceFetched
				imported = fetched
			default:
				imported, nodeProfiles = convertNodes(beamProfile, host, subURL)
				if len(imported) > 0 {
					outcome.Source = SourceCached
				} else {
					outcome.Source = SourceFailed
				}
				if err != nil {
					outcome.Note = err.Error()
				} else {
					outcome.Note = "The provider returned no servers."
				}
			}

			// This app keys a subscription by its host, so two from the same
			// host share one refresh URL and the next refresh would fold them
			// into one. Say so rather than let that happen silently.
			if hostsSeen[host] && len(imported) > 0 {
				outcome.Note = strings.TrimSpace(outcome.Note + " Another Beam subscription uses the same host; " +
					"NuggetVPN refreshes one subscription per host, so they will merge on refresh.")
			}
			hostsSeen[host] = true

			// Profiles that were already here from this host are replaced, as
			// a refresh would. Those added earlier in this run are kept.
			if len(imported) > 0 {
				existing = withoutSource(existing, host)
			}
		}

		outcome.Profiles = len(imported)
		added = append(added, imported...)
		result.Outcomes = append(result.Outcomes, outcome)

		if beamProfile.FileID != "" && beamProfile.FileID == data.ActiveID && result.Selection == nil {
			result.Selection = locateSelection(beamProfile, imported, nodeProfiles, host)
		}
	}

	result.Profiles = append(existing, added...)
	return result
}

// convertNodes turns Beam's saved servers into profiles, keeping each
// outbound verbatim as the profile's link.
func convertNodes(profile Profile, sourceDomain, subURL string) ([]models.Profile, map[string]string) {
	converted := []models.Profile{}
	ids := map[string]string{}
	for _, node := range usableNodes(profile) {
		outbound := make(map[string]any, len(node.Outbound))
		for key, value := range node.Outbound {
			// The config builder assigns its own tags and chain wiring.
			if key == "tag" || key == "detour" {
				continue
			}
			outbound[key] = value
		}
		encoded, err := json.Marshal(outbound)
		if err != nil {
			continue
		}

		name := strings.TrimSpace(node.Name)
		if name == "" {
			name = fmt.Sprintf("%v %v", outbound["type"], outbound["server"])
		}
		zero := uint64(0)
		id := uuid.NewString()
		ids[node.ID] = id
		converted = append(converted, models.Profile{
			ID:              id,
			Name:            name,
			Server:          "Auto",
			Protocol:        strings.ToLower(fmt.Sprint(outbound["type"])),
			ConfigLink:      string(encoded),
			SourceDomain:    sourceDomain,
			SubscriptionURL: subURL,
			TotalUp:         &zero,
			TotalDown:       &zero,
		})
	}
	return converted, ids
}

// usableNodes drops what cannot be dialled.
//
// Providers pad subscriptions with informational entries — "expires on …",
// "3 of 5 devices" — pointed at 0.0.0.0 or a loopback address with a zero
// UUID, and Beam saves them like any other node. Importing them would give the
// user servers that cannot possibly connect.
func usableNodes(profile Profile) []Node {
	usable := []Node{}
	for _, node := range profile.Nodes {
		if dialable(node.Outbound) {
			usable = append(usable, node)
		}
	}
	return usable
}

func dialable(outbound map[string]any) bool {
	if outbound == nil {
		return false
	}
	kind, _ := outbound["type"].(string)
	switch strings.ToLower(strings.TrimSpace(kind)) {
	case "", "direct", "block", "dns", "selector", "urltest", "fallback":
		return false
	}

	server, _ := outbound["server"].(string)
	server = strings.TrimSpace(server)
	if server == "" {
		return false
	}
	if address, err := netip.ParseAddr(strings.Trim(server, "[]")); err == nil {
		if address.IsUnspecified() || address.IsLoopback() {
			return false
		}
	}

	port, _ := outbound["server_port"].(float64)
	if port < 1 || port > 65535 {
		return false
	}

	if id, ok := outbound["uuid"].(string); ok && strings.Trim(id, "0-") == "" {
		return false
	}
	return true
}

// locateSelection finds the new profile for the node Beam had selected.
//
// Beam's own copy maps by node id. A fresh fetch has new ids, so it maps by
// name instead — subscription entries carry their display name in the link,
// which is where Beam got the node name from in the first place.
func locateSelection(profile Profile, imported []models.Profile, nodeProfiles map[string]string, host string) *Selection {
	if len(imported) == 0 {
		return nil
	}
	domain := host
	if domain == "" {
		domain = "local"
	}

	// The mapped profile may have been dropped as a duplicate of one already
	// here, so it only counts if it actually made it into the import.
	if id, ok := nodeProfiles[profile.SelectedID]; ok {
		for _, candidate := range imported {
			if candidate.ID == id {
				return &Selection{Domain: domain, ProfileID: id}
			}
		}
	}
	for _, node := range profile.Nodes {
		if node.ID != profile.SelectedID {
			continue
		}
		for _, candidate := range imported {
			if strings.TrimSpace(candidate.Name) == strings.TrimSpace(node.Name) {
				return &Selection{Domain: domain, ProfileID: candidate.ID}
			}
		}
	}
	// The server is gone from the fresh list; the subscription is still the
	// right one to land on.
	return &Selection{Domain: domain}
}

func withoutSource(profiles []models.Profile, sourceDomain string) []models.Profile {
	kept := make([]models.Profile, 0, len(profiles))
	for _, profile := range profiles {
		if strings.TrimSpace(profile.SourceDomain) != sourceDomain {
			kept = append(kept, profile)
		}
	}
	return kept
}

// withoutDuplicates drops hand-added servers that are already present, so
// running the migration twice does not list everything twice.
func withoutDuplicates(candidates []models.Profile, groups ...[]models.Profile) []models.Profile {
	seen := map[string]bool{}
	for _, group := range groups {
		for _, profile := range group {
			seen[strings.TrimSpace(profile.ConfigLink)] = true
		}
	}
	kept := candidates[:0]
	for _, profile := range candidates {
		if !seen[strings.TrimSpace(profile.ConfigLink)] {
			kept = append(kept, profile)
		}
	}
	return kept
}

func hostOf(rawURL string) string {
	parsed, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return ""
	}
	return parsed.Hostname()
}

func displayName(profile Profile) string {
	for _, candidate := range []string{profile.Name, profile.Provider, hostOf(profile.URL)} {
		if trimmed := strings.TrimSpace(candidate); trimmed != "" {
			return trimmed
		}
	}
	return "Beam profile"
}

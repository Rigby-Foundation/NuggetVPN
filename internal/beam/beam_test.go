package beam

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Rigby-Foundation/NuggetVPN/internal/models"
)

// encodeBeam writes a profile the way Beam does: magic, version 2, gzip JSON.
func encodeBeam(t *testing.T, profile map[string]any) []byte {
	t.Helper()
	payload, err := json.Marshal(profile)
	if err != nil {
		t.Fatal(err)
	}
	var buffer bytes.Buffer
	buffer.WriteString("BEAM")
	buffer.WriteByte(2)
	writer := gzip.NewWriter(&buffer)
	if _, err := writer.Write(payload); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return buffer.Bytes()
}

func node(id, name, server string, port int) map[string]any {
	return map[string]any{
		"id": id, "categoryId": "c1", "name": name, "type": "vless",
		"outbound": map[string]any{
			"type": "vless", "tag": "proxy", "server": server, "server_port": port,
			"uuid": "11111111-2222-3333-4444-555555555555",
		},
	}
}

// placeholder is the kind of entry providers pad subscriptions with.
func placeholder(id, name string) map[string]any {
	n := node(id, name, "0.0.0.0", 1)
	n["outbound"].(map[string]any)["uuid"] = "00000000-0000-0000-0000-000000000000"
	return n
}

const beamHWID = "1e10b0c7-9c9f-43bc-9045-eedb2f5473dd"

const settingsJSON = `{
  "SchemaVersion": 2,
  "Connection": {"MTU": 1500, "PrimaryDNS": "8.8.8.8"},
  "Appearance": {"Theme": "rose"},
  "SplitTunnel": {"enabled": false, "mode": "exclude", "apps": [], "domains": [], "ips": []},
  "RoutingMode": "easy",
  "ProTunGraph": {"nodes": [], "edges": []},
  "HappCompat": {"Enabled": true, "UserAgentVersion": "4.14.0", "HWIDMode": "auto", "HWID": "` + beamHWID + `"}
}`

// writeBeamDir lays out a Beam data directory.
func writeBeamDir(t *testing.T, settings string, active string, profiles map[string][]byte) string {
	t.Helper()
	dir := t.TempDir()
	if settings != "" {
		if err := os.WriteFile(filepath.Join(dir, "settings.json"), []byte(settings), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	if active != "" {
		state := `{"activeId":"` + active + `"}`
		if err := os.WriteFile(filepath.Join(dir, "state.json"), []byte(state), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.MkdirAll(filepath.Join(dir, "profiles"), 0o755); err != nil {
		t.Fatal(err)
	}
	for id, raw := range profiles {
		if err := os.WriteFile(filepath.Join(dir, "profiles", id+".beam"), raw, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	return dir
}

func TestDirPerPlatform(t *testing.T) {
	home := func() (string, error) { return "/home/u", nil }
	env := func(values map[string]string) func(string) string {
		return func(key string) string { return values[key] }
	}

	cases := []struct {
		goos string
		env  map[string]string
		want string
	}{
		{"darwin", nil, filepath.Join("/home/u", "Library", "Application Support", "Beam")},
		{"windows", map[string]string{"APPDATA": `C:\Users\u\AppData\Roaming`},
			filepath.Join(`C:\Users\u\AppData\Roaming`, "Beam")},
		{"windows", nil, filepath.Join("/home/u", "AppData", "Roaming", "Beam")},
		{"linux", nil, filepath.Join("/home/u", ".config", "Beam")},
	}
	for _, c := range cases {
		if got := dirFor(c.goos, env(c.env), home); got != c.want {
			t.Errorf("%s: got %q, want %q", c.goos, got, c.want)
		}
	}
}

func TestDecodeProfileFormats(t *testing.T) {
	profile := map[string]any{"version": 2, "name": "Sub", "nodes": []any{node("n1", "A", "203.0.113.5", 443)}}

	decoded, err := DecodeProfile(encodeBeam(t, profile))
	if err != nil {
		t.Fatalf("BEAM v2 gzip: %v", err)
	}
	if decoded.Name != "Sub" || len(decoded.Nodes) != 1 {
		t.Fatalf("decoded wrong profile: %+v", decoded)
	}

	plain, _ := json.Marshal(profile)
	if _, err := DecodeProfile(plain); err != nil {
		t.Errorf("plain JSON without magic should decode: %v", err)
	}
	if _, err := DecodeProfile(append([]byte("BEAM\x03"), plain...)); err != nil {
		t.Errorf("magic followed by plain JSON should decode: %v", err)
	}

	for name, raw := range map[string][]byte{
		"truncated":      []byte("BEAM"),
		"unknown format": []byte("BEAM\x07\x00\x01\x02garbage"),
		"empty":          nil,
	} {
		if _, err := DecodeProfile(raw); err == nil {
			t.Errorf("%s: expected an error", name)
		}
	}
}

func TestLoadKeepsGoingPastACorruptProfile(t *testing.T) {
	good := encodeBeam(t, map[string]any{"name": "Good", "nodes": []any{}})
	dir := writeBeamDir(t, settingsJSON, "good", map[string][]byte{
		"good": good,
		"bad":  []byte("BEAM\x02not gzip"),
	})

	data, err := Load(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(data.Profiles) != 1 || data.Profiles[0].FileID != "good" {
		t.Fatalf("profiles = %+v", data.Profiles)
	}
	if len(data.Unreadable) != 1 || data.Unreadable[0] != "bad.beam" {
		t.Errorf("unreadable = %v", data.Unreadable)
	}
	if data.ActiveID != "good" || data.Settings == nil {
		t.Errorf("state or settings not read: active=%q settings=%v", data.ActiveID, data.Settings)
	}
}

func TestLoadReportsNothingToMigrate(t *testing.T) {
	if _, err := Load(t.TempDir()); !errors.Is(err, ErrNotFound) {
		t.Errorf("empty directory: got %v, want ErrNotFound", err)
	}
	if _, err := Load(filepath.Join(t.TempDir(), "missing")); !errors.Is(err, ErrNotFound) {
		t.Errorf("missing directory: got %v, want ErrNotFound", err)
	}
}

func TestPlaceholderNodesAreDropped(t *testing.T) {
	profile := Profile{Nodes: []Node{
		{ID: "real", Outbound: map[string]any{"type": "vless", "server": "203.0.113.5", "server_port": float64(443), "uuid": "abc-123"}},
		{ID: "zero", Outbound: map[string]any{"type": "vless", "server": "0.0.0.0", "server_port": float64(1), "uuid": "abc-123"}},
		{ID: "loop", Outbound: map[string]any{"type": "vless", "server": "127.0.0.1", "server_port": float64(443), "uuid": "abc-123"}},
		{ID: "nouuid", Outbound: map[string]any{"type": "vless", "server": "203.0.113.5", "server_port": float64(443), "uuid": "00000000-0000-0000-0000-000000000000"}},
		{ID: "noport", Outbound: map[string]any{"type": "vless", "server": "203.0.113.5"}},
		{ID: "direct", Outbound: map[string]any{"type": "direct", "server": "203.0.113.5", "server_port": float64(443)}},
		{ID: "host", Outbound: map[string]any{"type": "trojan", "server": "example.com", "server_port": float64(443), "password": "x"}},
	}}

	var kept []string
	for _, n := range usableNodes(profile) {
		kept = append(kept, n.ID)
	}
	if strings.Join(kept, ",") != "real,host" {
		t.Errorf("kept %v, want [real host]", kept)
	}
}

func TestApplySettingsCarriesIdentity(t *testing.T) {
	var beam Settings
	if err := json.Unmarshal([]byte(settingsJSON), &beam); err != nil {
		t.Fatal(err)
	}

	next, carried, _ := ApplySettings(models.DefaultSettings(), &beam)
	if next.HWID != beamHWID {
		t.Errorf("HWID = %q, want Beam's %q", next.HWID, beamHWID)
	}
	if next.SubscriptionUserAgent != "Happ/4.14.0" {
		t.Errorf("user agent = %q", next.SubscriptionUserAgent)
	}
	if next.DNS != "8.8.8.8" || next.MTU != 1500 {
		t.Errorf("DNS/MTU = %q/%d", next.DNS, next.MTU)
	}
	if len(carried) == 0 {
		t.Error("nothing reported as carried")
	}
}

func TestApplySettingsRefusesBadValues(t *testing.T) {
	beam := &Settings{}
	beam.HappCompat.HWID = "has spaces and is not valid!"
	beam.HappCompat.Enabled = true
	beam.HappCompat.UserAgentVersion = "4.14.0\r\nX-Injected: yes"
	beam.HappCompat.HWIDMode = "off"
	beam.Connection.MTU = 12

	start := models.DefaultSettings()
	start.HWID = "original-hwid-value"
	next, _, skipped := ApplySettings(start, beam)

	if next.HWID != "original-hwid-value" {
		t.Errorf("invalid Beam HWID replaced ours: %q", next.HWID)
	}
	if next.SubscriptionUserAgent != models.HappUserAgent {
		t.Errorf("malformed version went into the header: %q", next.SubscriptionUserAgent)
	}
	if next.HWIDOn() {
		t.Error("HWIDMode off should turn the device headers off")
	}
	if next.MTU != start.MTU {
		t.Errorf("implausible MTU was applied: %d", next.MTU)
	}
	if len(skipped) == 0 {
		t.Error("the refused HWID should be reported")
	}
}

func TestSplitTunnelBecomesRules(t *testing.T) {
	for _, c := range []struct {
		mode, ruleAction, defaultAction string
	}{
		{"exclude", models.ActionDirect, models.ActionProxy},
		{"include", models.ActionProxy, models.ActionDirect},
	} {
		beam := &Settings{}
		beam.SplitTunnel.Enabled = true
		beam.SplitTunnel.Mode = c.mode
		beam.SplitTunnel.Apps = []json.RawMessage{json.RawMessage(`"Telegram.exe"`), json.RawMessage(`{"path":"C:\\x\\game.exe"}`)}
		beam.SplitTunnel.Domains = []string{" example.com ", "example.com"}

		next, _, _ := ApplySettings(models.DefaultSettings(), beam)
		if next.DefaultAction != c.defaultAction {
			t.Errorf("%s: default = %q", c.mode, next.DefaultAction)
		}
		if len(next.RoutingRules) != 2 {
			t.Fatalf("%s: rules = %+v", c.mode, next.RoutingRules)
		}
		for _, rule := range next.RoutingRules {
			if rule.Action != c.ruleAction {
				t.Errorf("%s: rule %s action = %q", c.mode, rule.Kind, rule.Action)
			}
		}
		if got := next.RoutingRules[0].Values; len(got) != 2 || got[1] != `C:\x\game.exe` {
			t.Errorf("%s: app values = %v", c.mode, got)
		}
		if got := next.RoutingRules[1].Values; len(got) != 1 || got[0] != "example.com" {
			t.Errorf("%s: domains not trimmed and deduplicated: %v", c.mode, got)
		}
	}
}

func TestSplitTunnelLeavesExistingRulesAlone(t *testing.T) {
	beam := &Settings{}
	beam.SplitTunnel.Enabled = true
	beam.SplitTunnel.Mode = "exclude"
	beam.SplitTunnel.Domains = []string{"example.com"}

	start := models.DefaultSettings()
	start.RoutingRules = []models.RoutingRule{{ID: "mine", Kind: models.SourceDomains, Values: []string{"a.test"}, Action: models.ActionBlock}}

	next, _, skipped := ApplySettings(start, beam)
	if len(next.RoutingRules) != 1 || next.RoutingRules[0].ID != "mine" {
		t.Errorf("existing rules changed: %+v", next.RoutingRules)
	}
	if len(skipped) == 0 {
		t.Error("the skipped split tunnel should be reported")
	}
}

// TestFetchUsesBeamIdentity is the invariant the ordering in Migrate exists
// for: the provider must see Beam's device id, or the migration registers a
// new device.
func TestFetchUsesBeamIdentity(t *testing.T) {
	dir := writeBeamDir(t, settingsJSON, "p1", map[string][]byte{
		"p1": encodeBeam(t, map[string]any{"name": "Sub", "url": "https://sub.example.com/abc", "nodes": []any{}}),
	})
	data, err := Load(dir)
	if err != nil {
		t.Fatal(err)
	}

	start := models.DefaultSettings()
	start.Normalize() // gives this install its own random HWID, as a real first start does

	var seen models.AppSettings
	fetch := func(_ context.Context, settings models.AppSettings, _ string) ([]models.Profile, error) {
		seen = settings
		return []models.Profile{{ID: "x", Name: "A", SourceDomain: "sub.example.com"}}, nil
	}
	Migrate(context.Background(), data, nil, start, fetch)

	headers := seen.SubscriptionHeaders()
	if headers["x-hwid"] != beamHWID {
		t.Errorf("fetch sent x-hwid %q, want Beam's %q", headers["x-hwid"], beamHWID)
	}
	if headers["User-Agent"] != "Happ/4.14.0" {
		t.Errorf("fetch sent User-Agent %q", headers["User-Agent"])
	}
}

func TestMigrateFallsBackToBeamsCopy(t *testing.T) {
	dir := writeBeamDir(t, settingsJSON, "p1", map[string][]byte{
		"p1": encodeBeam(t, map[string]any{
			"name": "Cached", "url": "https://sub.example.com/abc", "selectedId": "n2",
			"nodes": []any{placeholder("n0", "Expires soon"), node("n1", "Frankfurt", "203.0.113.5", 443), node("n2", "Tokyo", "203.0.113.6", 443)},
		}),
		"p2": encodeBeam(t, map[string]any{
			"name": "Dead", "url": "https://dead.example.com/x",
			"nodes": []any{placeholder("d0", "Expired")},
		}),
	})
	data, err := Load(dir)
	if err != nil {
		t.Fatal(err)
	}

	offline := func(context.Context, models.AppSettings, string) ([]models.Profile, error) {
		return nil, errors.New("network unreachable")
	}
	result := Migrate(context.Background(), data, nil, models.DefaultSettings(), offline)

	outcomes := map[string]Outcome{}
	for _, outcome := range result.Outcomes {
		outcomes[outcome.Name] = outcome
	}
	if got := outcomes["Cached"]; got.Source != SourceCached || got.Profiles != 2 || got.Note == "" {
		t.Errorf("Cached outcome = %+v", got)
	}
	if got := outcomes["Dead"]; got.Source != SourceFailed || got.Profiles != 0 {
		t.Errorf("Dead outcome = %+v", got)
	}
	if len(result.Profiles) != 2 {
		t.Fatalf("profiles = %+v", result.Profiles)
	}

	for _, profile := range result.Profiles {
		if profile.SourceDomain != "sub.example.com" || profile.SubscriptionURL != "https://sub.example.com/abc" {
			t.Errorf("cached profile not attached to its subscription, so refresh would miss it: %+v", profile)
		}
		var outbound map[string]any
		if err := json.Unmarshal([]byte(profile.ConfigLink), &outbound); err != nil {
			t.Fatalf("link is not the outbound JSON: %v", err)
		}
		if _, hasTag := outbound["tag"]; hasTag {
			t.Error("tag should be stripped; the config builder owns tags")
		}
	}

	if result.Selection == nil || result.Selection.Domain != "sub.example.com" {
		t.Fatalf("selection = %+v", result.Selection)
	}
	var selected string
	for _, profile := range result.Profiles {
		if profile.ID == result.Selection.ProfileID {
			selected = profile.Name
		}
	}
	if selected != "Tokyo" {
		t.Errorf("selected %q, want Beam's selected node Tokyo", selected)
	}
}

func TestMigrateReplacesThatHostOnly(t *testing.T) {
	dir := writeBeamDir(t, settingsJSON, "", map[string][]byte{
		"p1": encodeBeam(t, map[string]any{"name": "Sub", "url": "https://sub.example.com/abc", "nodes": []any{}}),
	})
	data, err := Load(dir)
	if err != nil {
		t.Fatal(err)
	}

	existing := []models.Profile{
		{ID: "old", SourceDomain: "sub.example.com"},
		{ID: "other", SourceDomain: "other.example.com"},
	}
	fetch := func(context.Context, models.AppSettings, string) ([]models.Profile, error) {
		return []models.Profile{{ID: "new", SourceDomain: "sub.example.com"}}, nil
	}
	result := Migrate(context.Background(), data, existing, models.DefaultSettings(), fetch)

	var ids []string
	for _, profile := range result.Profiles {
		ids = append(ids, profile.ID)
	}
	if strings.Join(ids, ",") != "other,new" {
		t.Errorf("profiles = %v, want [other new]", ids)
	}
}

func TestMigratingLocalProfilesTwiceDoesNotDuplicate(t *testing.T) {
	dir := writeBeamDir(t, settingsJSON, "", map[string][]byte{
		"manual": encodeBeam(t, map[string]any{"name": "Mine", "nodes": []any{node("n1", "Home", "203.0.113.9", 443)}}),
	})
	data, err := Load(dir)
	if err != nil {
		t.Fatal(err)
	}
	never := func(context.Context, models.AppSettings, string) ([]models.Profile, error) {
		t.Fatal("a hand-added profile has nothing to fetch")
		return nil, nil
	}

	first := Migrate(context.Background(), data, nil, models.DefaultSettings(), never)
	if len(first.Profiles) != 1 || first.Profiles[0].SourceDomain != "local" {
		t.Fatalf("first run = %+v", first.Profiles)
	}
	second := Migrate(context.Background(), data, first.Profiles, first.Settings, never)
	if len(second.Profiles) != 1 {
		t.Errorf("second run duplicated profiles: %d", len(second.Profiles))
	}
}

func TestThemeMapping(t *testing.T) {
	for beamTheme, want := range map[string]string{
		"rose": "rose", "AMOLED": "oled", "cosmic": "cosmos", "purple": "violet", "unknown-theme": "",
	} {
		settings := &Settings{}
		settings.Appearance.Theme = beamTheme
		if got, _ := themeFor(settings); got != want {
			t.Errorf("%q -> %q, want %q", beamTheme, got, want)
		}
	}
}

func TestAppearanceMapping(t *testing.T) {
	settings := &Settings{}
	settings.Appearance.Font = "Rubik"
	settings.Appearance.Radius = "full"
	settings.Appearance.Animation = "bottom"
	got := appearanceFor(settings)
	if got != (Appearance{Font: "rubik", Radius: "round", Motion: "rise"}) {
		t.Errorf("mapped to %+v", got)
	}

	settings.Appearance.Font = "Comic Sans"
	if got := appearanceFor(settings); got.Font != "" {
		t.Errorf("an unknown font should map to nothing, got %q", got.Font)
	}
}

func TestPreviewNeverExposesTheURL(t *testing.T) {
	secret := "https://sub.example.com/very-secret-token"
	dir := writeBeamDir(t, settingsJSON, "", map[string][]byte{
		"p1": encodeBeam(t, map[string]any{"name": "Sub", "url": secret, "nodes": []any{}}),
	})
	data, err := Load(dir)
	if err != nil {
		t.Fatal(err)
	}
	encoded, _ := json.Marshal(NewPreview(data))
	if strings.Contains(string(encoded), "very-secret-token") {
		t.Error("the preview leaks the subscription token")
	}
	if !strings.Contains(string(encoded), "sub.example.com") {
		t.Error("the preview should still name the host")
	}
}

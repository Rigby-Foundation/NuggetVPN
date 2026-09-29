package vflow

import (
	"errors"
	"strings"
	"testing"

	"github.com/Rigby-Foundation/NuggetVPN/internal/models"
)

func sample() models.AppSettings {
	settings := models.DefaultSettings()
	settings.DefaultAction = models.ActionDirect
	settings.RoutingRules = []models.RoutingRule{
		{ID: "d", Kind: models.SourceDomains, Values: []string{"example.com"}, Action: models.ActionProxy},
	}
	settings.RoutingComments = []models.RoutingComment{{ID: "note-1", Text: "Work sites go through the VPN"}}
	settings.RoutingLayout = map[string]models.Point{"d": {X: 10, Y: 20}, "note-1": {X: 300, Y: 40}}
	settings.GeoFiles = map[string]models.GeoFile{
		"geosite": {Source: "url", URL: "https://example.org/geosite.dat"},
		"geoip":   {Source: "file", Name: "geoip.dat"},
	}
	settings.Normalize()
	return settings
}

func TestRoundTrip(t *testing.T) {
	data, err := Encode(sample())
	if err != nil {
		t.Fatal(err)
	}
	flow, err := Decode(data)
	if err != nil {
		t.Fatal(err)
	}
	// Nothing here needs version 2, so older builds can still read it.
	if flow.Version != 1 || flow.Format != Format {
		t.Errorf("header %s v%d", flow.Format, flow.Version)
	}

	restored := Apply(models.DefaultSettings(), flow)
	if restored.DefaultAction != models.ActionDirect || len(restored.RoutingRules) != 1 ||
		len(restored.RoutingComments) != 1 || restored.RoutingLayout["note-1"].X != 300 {
		t.Errorf("routing did not survive the round trip: %+v", restored)
	}

	// A downloaded geo file travels as its URL; one picked from disk cannot.
	if flow.Geo["geosite"].URL != "https://example.org/geosite.dat" {
		t.Errorf("geosite URL missing: %+v", flow.Geo)
	}
	if _, ok := flow.Geo["geoip"]; ok {
		t.Error("a geo file picked from disk has no address to carry")
	}
}

func TestRefusesOtherFilesAndNewerVersions(t *testing.T) {
	for name, data := range map[string]string{
		"not json":   "hello",
		"other json": `{"rules": []}`,
		"no version": `{"format": "nuggetvpn.vflow"}`,
	} {
		if _, err := Decode([]byte(data)); !errors.Is(err, ErrNotFlow) {
			t.Errorf("%s: got %v, want ErrNotFlow", name, err)
		}
	}
	_, err := Decode([]byte(`{"format": "nuggetvpn.vflow", "version": 99}`))
	if err == nil || !strings.Contains(err.Error(), "newer") {
		t.Errorf("a newer version should be refused by name, got %v", err)
	}
}

func TestApplyNormalisesHandEditedFiles(t *testing.T) {
	flow := Flow{
		Format:        Format,
		Version:       1,
		DefaultAction: "teleport",
		Rules: []models.RoutingRule{
			{ID: "ok", Kind: models.SourceDomains, Values: []string{"a.test"}, Action: models.ActionBlock},
			{ID: "bad", Kind: "mind-reading", Values: []string{"x"}, Action: models.ActionProxy},
		},
		Comments: []models.RoutingComment{{ID: "", Text: "no id"}, {ID: "long", Text: strings.Repeat("x", 5000)}},
	}
	settings := Apply(models.DefaultSettings(), flow)
	if settings.DefaultAction != models.ActionProxy {
		t.Errorf("an unknown default should fall back, got %q", settings.DefaultAction)
	}
	if len(settings.RoutingRules) != 1 || settings.RoutingRules[0].ID != "ok" {
		t.Errorf("an unknown rule kind should be dropped: %+v", settings.RoutingRules)
	}
	if len(settings.RoutingComments) != 1 || len([]rune(settings.RoutingComments[0].Text)) != 2000 {
		t.Errorf("comments should be validated and capped: %+v", len(settings.RoutingComments))
	}
}

func TestMissingGeo(t *testing.T) {
	flow := Flow{Geo: map[string]GeoRef{
		"geosite": {URL: "https://example.org/geosite.dat"},
		"geoip":   {URL: "https://example.org/geoip.dat"},
	}}
	settings := models.DefaultSettings()
	settings.GeoFiles = map[string]models.GeoFile{"geosite": {Source: "url", URL: "https://example.org/geosite.dat"}}

	missing := MissingGeo(settings, flow)
	if len(missing) != 1 || missing["geoip"] != "https://example.org/geoip.dat" {
		t.Errorf("only the file not already in use should be offered: %v", missing)
	}
}

// A flow using anything version 1 cannot hold is marked version 2, so an
// older build refuses it instead of silently dropping those parts.
func TestNewFeaturesNeedVersion2(t *testing.T) {
	for name, mutate := range map[string]func(*models.AppSettings){
		"drop":       func(s *models.AppSettings) { s.RoutingRules[0].Action = models.ActionDrop },
		"invert":     func(s *models.AppSettings) { s.RoutingRules[0].Invert = true },
		"server":     func(s *models.AppSettings) { s.RoutingRules[0].Server = "abc" },
		"dns":        func(s *models.AppSettings) { s.RoutingRules[0].DNS = "1.1.1.1" },
		"network":    func(s *models.AppSettings) { s.RoutingRules[0].Kind = models.SourceNetwork },
		"default":    func(s *models.AppSettings) { s.DefaultAction = models.ActionDrop },
		"serverNode": func(s *models.AppSettings) { s.RoutingServers = []string{"abc"} },
	} {
		settings := sample()
		mutate(&settings)
		data, err := Encode(settings)
		if err != nil {
			t.Fatal(err)
		}
		flow, err := Decode(data)
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		if flow.Version != 2 {
			t.Errorf("%s: written as version %d", name, flow.Version)
		}
	}
}

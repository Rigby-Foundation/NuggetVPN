package sbconfig

import (
	"testing"

	"github.com/Rigby-Foundation/NuggetVPN/internal/models"
)

func geoSettings(kind string, values ...string) models.AppSettings {
	settings := models.DefaultSettings()
	settings.RoutingRules = []models.RoutingRule{{ID: "g", Kind: kind, Values: values, Action: models.ActionDirect}}
	settings.Normalize()
	return settings
}

func declared(sets []map[string]any) map[string]map[string]any {
	byTag := map[string]map[string]any{}
	for _, set := range sets {
		byTag[set["tag"].(string)] = set
	}
	return byTag
}

// referenced collects every rule-set tag the route rules point at.
func referenced(rules []map[string]any) []string {
	var tags []string
	for _, rule := range rules {
		if list, ok := rule["rule_set"].([]string); ok {
			tags = append(tags, list...)
		}
	}
	return tags
}

func TestBuiltInGeoSetsAreRemote(t *testing.T) {
	settings := geoSettings(models.SourceGeoSite, "netflix")
	sets := declared(ruleSets(settings, geoSources{}))
	if sets["geosite-netflix"]["type"] != "remote" {
		t.Fatalf("without a custom file, a code should use the built-in remote set: %v", sets)
	}
}

func TestCustomGeoFileTakesOver(t *testing.T) {
	settings := geoSettings(models.SourceGeoSite, "ru-blocked", "not-in-file", "google@cn")
	geo := geoSources{
		local: map[string]string{
			"geosite-ru-blocked": "/rules/geosite-ru-blocked.json",
			"geosite-google@cn":  "/rules/geosite-google-cn.json",
		},
		custom: map[string]bool{models.SourceGeoSite: true},
	}

	sets := declared(ruleSets(settings, geo))
	if sets["geosite-ru-blocked"]["type"] != "local" || sets["geosite-ru-blocked"]["path"] != "/rules/geosite-ru-blocked.json" {
		t.Errorf("a code from the custom file should be a local set: %v", sets["geosite-ru-blocked"])
	}
	if _, ok := sets["geosite-not-in-file"]; ok {
		t.Error("with a custom file, a code it lacks must not fall back to the built-in set")
	}

	// Every tag a rule points at must be declared, or the core refuses to start.
	rules, _ := buildRouteRules(settings, nil, geo)
	for _, tag := range referenced(rules) {
		if _, ok := sets[tag]; !ok {
			t.Errorf("rule references undeclared rule-set %q", tag)
		}
	}
}

func TestAttributeCodesNeedACustomFile(t *testing.T) {
	settings := geoSettings(models.SourceGeoSite, "google@cn")
	sets := declared(ruleSets(settings, geoSources{}))
	if len(sets) != 0 {
		t.Errorf("an @attribute code has no built-in set and should declare none: %v", sets)
	}
	rules, _ := buildRouteRules(settings, nil, geoSources{})
	if tags := referenced(rules); len(tags) != 0 {
		t.Errorf("and no rule should point at one: %v", tags)
	}
}

package models

import "testing"

// What the user said to a provider's suggestions, and the rule taking its
// app list made, survive being saved.
func TestSubscriptionChoicesSurviveNormalize(t *testing.T) {
	settings := DefaultSettings()
	settings.RoutingRules = []RoutingRule{{
		ID: "subscription-apps-provider.example", Kind: SourceApps,
		Values: []string{"ru.gosuslugi.apps", "ru.vk.store"}, Action: ActionDirect, Invert: true,
	}}
	settings.SubscriptionChoices = map[string]SubscriptionChoice{
		"provider.example": {Answered: `{"hours":1}`, RefreshHours: 1, AppsRule: "subscription-apps-provider.example"},
	}
	settings.Normalize()
	choice := settings.SubscriptionChoices["provider.example"]
	if choice.RefreshHours != 1 || choice.AppsRule == "" || choice.Answered == "" {
		t.Fatalf("choice lost: %+v", choice)
	}
	if len(settings.RoutingRules) != 1 || !settings.RoutingRules[0].Invert || len(settings.RoutingRules[0].Values) != 2 {
		t.Fatalf("the rule did not survive: %+v", settings.RoutingRules)
	}
}

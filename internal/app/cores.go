package app

import (
	"fmt"
	"os"
	"strings"

	"github.com/Rigby-Foundation/NuggetVPN/internal/core"
	"github.com/Rigby-Foundation/NuggetVPN/internal/cores/mihomo"
	"github.com/Rigby-Foundation/NuggetVPN/internal/cores/xray"
	"github.com/Rigby-Foundation/NuggetVPN/internal/link"
	"github.com/Rigby-Foundation/NuggetVPN/internal/models"
	"github.com/Rigby-Foundation/NuggetVPN/internal/sbconfig"
	"github.com/Rigby-Foundation/NuggetVPN/internal/storage"
)

// ---------------------------------------------------------------------------
// Choosing the core
// ---------------------------------------------------------------------------

// ListCores lists the cores the tunnel can run on, with the versions built
// into the app.
func (a *App) ListCores() []core.CoreInfo {
	return core.Cores()
}

// SetCore chooses the core, and restarts a running tunnel on it.
func (a *App) SetCore(name string) (models.AppSettings, error) {
	settings := a.GetSettings()
	switch name {
	case models.CoreBuiltin, models.CoreSingBox, models.CoreMihomo, models.CoreXray:
	default:
		return settings, fmt.Errorf("unknown core %q", name)
	}
	if settings.Core == name {
		return settings, nil
	}
	settings.Core = name
	saved, err := a.SaveSettings(settings)
	if err != nil {
		return saved, err
	}
	return saved, a.reapplyRouting()
}

// UnsupportedProfiles maps each profile the chosen core cannot run to why,
// so the GUI can rule it out before a connection fails on it. The built-in
// core runs everything, so it reports nothing.
func (a *App) UnsupportedProfiles() map[string]string {
	settings := a.GetSettings()
	profiles, _ := a.snapshot()
	result := map[string]string{}
	for _, profile := range profiles {
		if err := checkProfile(settings, profile); err != nil {
			result[profile.ID] = err.Error()
		}
	}
	return result
}

// checkProfile asks the chosen core whether it can run a profile.
func checkProfile(settings models.AppSettings, profile models.Profile) error {
	switch settings.Core {
	case models.CoreXray:
		return xray.Check(profile, settings)
	case models.CoreMihomo:
		return mihomo.Check(profile, settings)
	case models.CoreSingBox:
		// Official sing-box runs the fork's config as is, minus the
		// transports only the fork has.
		if _, full := link.FullConfig(profile.ConfigLink); full {
			return nil
		}
		outbound, err := link.ParseOutbound(profile.ConfigLink, settings)
		if err != nil {
			return err
		}
		if transport, ok := outbound["transport"].(map[string]any); ok && transport["type"] == "xhttp" {
			return fmt.Errorf("official sing-box has no XHTTP transport; use the built-in core or Xray")
		}
	}
	return nil
}

// chainProfiles are the proxy chain's hops, in dial order.
func chainProfiles(profile models.Profile, profiles []models.Profile, settings models.AppSettings) []models.Profile {
	if !settings.ProxyChainEnabled {
		return nil
	}
	var hops []models.Profile
	for _, id := range settings.ProxyChain {
		if id == profile.ID {
			continue
		}
		if hop, ok := profileByID(profiles, id); ok {
			hops = append(hops, hop)
		}
	}
	return hops
}

// startXray runs Xray as the protocol engine behind the built-in core.
func (a *App) startXray(profile models.Profile, profiles []models.Profile, settings models.AppSettings, request sbconfig.Request) error {
	engine, err := xray.New(settings, chainProfiles(profile, profiles, settings))
	if err != nil {
		return err
	}
	request.Dial = engine.Dial
	request.ServerDomains = engine.ServerDomains
	port, username, password := engine.Bypass()
	request.Bypass = &sbconfig.Bypass{Port: port, Username: username, Password: password}

	// Build first: it asks the engine for every server it needs.
	result, err := sbconfig.Build(request)
	if err != nil {
		return err
	}
	for _, warning := range result.Warnings {
		a.appendLog("WARN " + warning)
	}
	config, err := engine.Config()
	if err != nil {
		return err
	}
	a.mu.Lock()
	a.ruleOwners = result.RuleOwners
	a.serverFor = result.ServerFor
	a.ruleTexts = nil
	a.mu.Unlock()
	_ = os.WriteFile(storage.CoreConfigPath(), result.JSON, 0o600)
	a.appendLog(fmt.Sprintf("Starting %s through Xray", profile.Name))
	return a.core.StartCore(core.StartRequest{Core: core.CoreXray, Config: result.JSON, Aux: config})
}

// startMihomo runs mihomo as the whole core.
func (a *App) startMihomo(profile models.Profile, profiles []models.Profile, settings models.AppSettings, alternatives []models.Profile, lists map[string]sbconfig.RuleList) error {
	result, err := mihomo.Build(mihomo.Request{
		Profile: profile, Profiles: profiles, Settings: settings,
		Alternatives: alternatives, MixedPort: MixedPort, RuleLists: lists,
	})
	if err != nil {
		return err
	}
	for _, warning := range result.Warnings {
		a.appendLog("WARN " + warning)
	}
	a.mu.Lock()
	a.ruleOwners = nil
	a.serverFor = result.ServerFor
	a.ruleTexts = result.RuleOwners
	a.mu.Unlock()
	_ = os.WriteFile(storage.CoreConfigPath()+".yaml", result.YAML, 0o600)
	if result.Verbatim {
		a.appendLog(fmt.Sprintf("Starting %s with mihomo, using the profile's own Clash config", profile.Name))
	} else {
		a.appendLog(fmt.Sprintf("Starting %s with mihomo", profile.Name))
	}
	return a.core.StartCore(core.StartRequest{Core: core.CoreMihomo, Config: result.YAML})
}

// ruleForText traces mihomo's report of a matched rule back to a routing
// rule. mihomo reports "TYPE,payload"; the payload is what the translation
// recorded.
func ruleForText(texts map[string]string, reported string) (string, bool) {
	if reported == "" || texts == nil {
		return "", false
	}
	kind, payload, _ := strings.Cut(reported, ",")
	switch strings.ToLower(kind) {
	case "match", "final":
		return DefaultRuleHits, true
	}
	owner, ok := texts[strings.ToLower(payload)]
	return owner, ok
}

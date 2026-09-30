package app

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"net"
	"os"
	"strings"

	"github.com/Rigby-Foundation/NuggetVPN/internal/core"
	"github.com/Rigby-Foundation/NuggetVPN/internal/cores/mihomo"
	"github.com/Rigby-Foundation/NuggetVPN/internal/cores/xray"
	"github.com/Rigby-Foundation/NuggetVPN/internal/models"
	"github.com/Rigby-Foundation/NuggetVPN/internal/sbconfig"
	"github.com/Rigby-Foundation/NuggetVPN/internal/storage"
)

// ---------------------------------------------------------------------------
// Choosing the core
// ---------------------------------------------------------------------------

// Events for installing a core.
const (
	coreProgressEventName = "core-progress"
	coreDoneEventName     = "core-done"
)

// CoreProgress is an install's progress, for the window.
type CoreProgress struct {
	Name     string `json:"name"`
	Received int64  `json:"received"`
	Total    int64  `json:"total"`
	// Done and Error end an install.
	Done  bool   `json:"done"`
	Error string `json:"error,omitempty"`
}

// ListCores reports the external cores and which are installed. The record
// is readable by everyone, so this needs no administrator rights — only
// installing and removing do.
func (a *App) ListCores() []core.CoreInfo {
	return core.CoreStatus()
}

// SetCore chooses the core, and restarts a running tunnel on it.
func (a *App) SetCore(name string) (models.AppSettings, error) {
	if name != models.CoreBuiltin {
		if _, err := a.installedCore(name); err != nil {
			return a.GetSettings(), err
		}
	}
	settings := a.GetSettings()
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

// InstallCore installs or updates a core; progress and the outcome arrive as
// core-progress and core-done events.
func (a *App) InstallCore(name string) error {
	return a.core.InstallCore(name)
}

// RemoveCore deletes an installed core. The selection falls back to the
// built-in core if it was the one chosen.
func (a *App) RemoveCore(name string) ([]core.CoreInfo, error) {
	cores, err := a.core.RemoveCore(name)
	if err != nil {
		return cores, err
	}
	settings := a.GetSettings()
	if settings.Core == name {
		settings.Core = models.CoreBuiltin
		if saved, err := a.SaveSettings(settings); err == nil {
			a.emit(settingsEventName, saved)
		}
	}
	return cores, nil
}

// forwardCoreEvents relays install progress from the service.
func (a *App) forwardCoreEvents() {
	a.core.OnCoreInstall(func(name string, received, total int64, message string, done bool) {
		a.emit(coreProgressEventName, CoreProgress{Name: name, Received: received, Total: total, Done: done, Error: message})
		if done && message == "" {
			a.appendLog("Installed " + name)
		}
	})
}

// installedCore returns where an installed core is, for rules that must let
// it straight out.
func (a *App) installedCore(name string) (string, error) {
	for _, info := range core.CoreStatus() {
		if info.Name == name && info.Installed {
			return info.Path, nil
		}
	}
	return "", fmt.Errorf("%s is not installed; install it under Settings → Core", name)
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
	path, err := a.installedCore(models.CoreXray)
	if err != nil {
		return err
	}
	engine, err := xray.New(settings, chainProfiles(profile, profiles, settings))
	if err != nil {
		return err
	}
	request.Dial = engine.Dial
	request.ServerDomains = engine.ServerDomains
	request.DirectProcesses = []string{path}

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

// startExternalSingBox runs official sing-box on the same config the
// built-in core would get, with its Clash API opened for the service.
func (a *App) startExternalSingBox(profile models.Profile, request sbconfig.Request) error {
	if _, err := a.installedCore(models.CoreSingBox); err != nil {
		return err
	}
	controller, err := newController()
	if err != nil {
		return err
	}
	request.ControllerPort, request.ControllerSecret = controller.Port, controller.Secret
	result, err := sbconfig.Build(request)
	if err != nil {
		return err
	}
	for _, warning := range result.Warnings {
		a.appendLog("WARN " + warning)
	}
	// Official sing-box reports matched rules by its own description, not by
	// position; a connection's rule is shown as that text.
	a.mu.Lock()
	a.ruleOwners = nil
	a.serverFor = result.ServerFor
	a.ruleTexts = map[string]string{"final": DefaultRuleHits}
	a.mu.Unlock()
	_ = os.WriteFile(storage.CoreConfigPath(), result.JSON, 0o600)
	a.appendLog(fmt.Sprintf("Starting %s with official sing-box", profile.Name))
	return a.core.StartCore(core.StartRequest{Core: core.CoreSingBox, Config: result.JSON, Controller: controller})
}

// startMihomo runs mihomo as the whole core.
func (a *App) startMihomo(profile models.Profile, profiles []models.Profile, settings models.AppSettings, alternatives []models.Profile, lists map[string]sbconfig.RuleList) error {
	if _, err := a.installedCore(models.CoreMihomo); err != nil {
		return err
	}
	controller, err := newController()
	if err != nil {
		return err
	}
	result, err := mihomo.Build(mihomo.Request{
		Profile: profile, Profiles: profiles, Settings: settings,
		Alternatives: alternatives, MixedPort: MixedPort, RuleLists: lists,
		ControllerPort: controller.Port, ControllerSecret: controller.Secret,
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
	return a.core.StartCore(core.StartRequest{Core: core.CoreMihomo, Config: result.YAML, Controller: controller})
}

// newController picks a free loopback port and a secret for an external
// core's API.
func newController() (*core.Controller, error) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil, err
	}
	port := listener.Addr().(*net.TCPAddr).Port
	listener.Close()
	secret := make([]byte, 24)
	if _, err := rand.Read(secret); err != nil {
		return nil, err
	}
	return &core.Controller{Port: port, Secret: hex.EncodeToString(secret)}, nil
}

// ruleForText traces an external core's report of a matched rule back to a
// routing rule. mihomo reports "TYPE,payload"; the payload is what the
// translation recorded.
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

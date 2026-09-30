package app

import (
	"fmt"

	"github.com/Rigby-Foundation/NuggetVPN/internal/models"
	"github.com/Rigby-Foundation/NuggetVPN/internal/sbconfig"
)

// ---------------------------------------------------------------------------
// Routing setups and live rule activity
// ---------------------------------------------------------------------------

// DefaultRuleHits is the key GetRuleHits counts unmatched traffic under.
const DefaultRuleHits = sbconfig.DefaultOwner

// SwitchRoutingSetup makes another saved routing setup the active one. The
// graph being edited is kept in the setup it belonged to.
//
// While connected, the tunnel restarts on the new routing straight away:
// picking a setup from the tray is meant to take effect, not to wait for
// the next connection.
func (a *App) SwitchRoutingSetup(id string) (models.AppSettings, error) {
	settings := a.GetSettings()
	if settings.ActiveRoutingSetup == id {
		return settings, nil
	}
	if !settings.SwitchSetup(id) {
		return settings, fmt.Errorf("there is no routing setup %q", id)
	}
	saved, err := a.SaveSettings(settings)
	if err != nil {
		return saved, err
	}
	a.emit(settingsEventName, saved)

	if err := a.reapplyRouting(); err != nil {
		return saved, err
	}
	return saved, nil
}

// reapplyRouting restarts a running tunnel on the current settings, keeping
// the server it is connected to. Nothing happens while disconnected.
func (a *App) reapplyRouting() error {
	a.connectMu.Lock()
	defer a.connectMu.Unlock()

	a.mu.Lock()
	state := a.state
	a.mu.Unlock()
	if state.Status != StatusConnected {
		return nil
	}

	profiles, settings := a.snapshot()
	profile, ok := profileByID(profiles, state.ProfileID)
	if !ok {
		return nil
	}
	a.appendLog("Routing changed; restarting the tunnel")
	a.flushUsage()
	// The servers the exit could switch between when the tunnel came up;
	// ranking them again would mean a full latency sweep.
	a.mu.Lock()
	alternatives := a.alternatives
	a.mu.Unlock()
	if !settings.FastestServer {
		alternatives = nil
	}
	if err := a.startProfile(profile, profiles, settings, alternatives); err != nil {
		_, failure := a.fail(fmt.Sprintf("Could not apply the new routing: %v", err))
		return failure
	}
	a.beginSession(profile.ID)
	return nil
}

// GetRuleHits counts the connections open right now by the routing rule that
// matched them, keyed by rule id. Unmatched traffic is counted under
// DefaultRuleHits. Connections the app routes itself — the local network,
// the proxy's own address — are not counted anywhere: they are not the
// graph's doing. Empty while disconnected.
func (a *App) GetRuleHits() map[string]int {
	result := map[string]int{}

	a.mu.Lock()
	connected := a.state.Status == StatusConnected
	owners := a.ruleOwners
	external := a.ruleTexts != nil
	a.mu.Unlock()
	if !connected {
		return result
	}
	// An external core has no per-rule counters; count its connections.
	if external {
		for _, connection := range a.GetConnections() {
			if connection.Rule != "" {
				result[connection.Rule]++
			}
		}
		return result
	}
	if len(owners) == 0 {
		return result
	}

	hits, ok := a.core.RuleHits()
	if !ok {
		return result
	}
	for index, count := range hits {
		if count == 0 {
			continue
		}
		switch {
		case index == len(hits)-1:
			// The last slot is the connections no rule matched; with a
			// "block" or "drop" default, a catch-all rule owned by
			// DefaultRuleHits takes them instead.
			result[DefaultRuleHits] += count
		case index < len(owners) && owners[index] != "":
			result[owners[index]] += count
		}
	}
	return result
}

package app

import (
	"fmt"

	"github.com/Rigby-Foundation/NuggetVPN/internal/models"
	"github.com/Rigby-Foundation/NuggetVPN/internal/xrayconfig"
)

// ---------------------------------------------------------------------------
// Routing setups and live rule activity
// ---------------------------------------------------------------------------

// DefaultRuleHits is the key GetRuleHits counts unmatched traffic under.
const DefaultRuleHits = xrayconfig.DefaultOwner

// SwitchRoutingSetup makes another saved routing setup the active one. The
// graph being edited is kept in the setup it belonged to.
//
// A running connection is reloaded after the user confirms in the window.
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

	return saved, nil
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
	a.mu.Unlock()
	if !connected {
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

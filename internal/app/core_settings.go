package app

import (
	"encoding/json"

	"github.com/Rigby-Foundation/NuggetVPN/internal/models"
)

const coreReloadEventName = "core-reload-requested"

// Compare settings used to build Xray. Canvas layout, saved setup names, and
// client preferences do not change the running configuration.
func coreSettingsSignature(settings models.AppSettings) string {
	value := struct {
		MTU           uint32
		DNS           string
		Fragment      bool
		FragmentSize  string
		FragmentSleep string
		MixedSNI      bool
		Padding       bool
		SNISpoof      bool
		SNI           string
		Logging       bool
		Rules         []models.RoutingRule
		DefaultAction string
		DefaultServer string
		GeoFiles      map[string]models.GeoFile
		ChainEnabled  bool
		Chain         []string
		ChainExit     string
		FastestServer bool
	}{
		MTU: settings.MTU, DNS: settings.DNS,
		Fragment: settings.TLSFragment, FragmentSize: settings.TLSFragmentSize,
		FragmentSleep: settings.TLSFragmentSleep, MixedSNI: settings.TLSMixedSNICase,
		Padding: settings.TLSPadding, SNISpoof: settings.SNISpoofEnabled, SNI: settings.SNISpoofValue,
		Logging: settings.LoggingOn(), Rules: settings.UsableRules(),
		DefaultAction: settings.DefaultAction, DefaultServer: settings.DefaultServer,
		GeoFiles: settings.GeoFiles, ChainEnabled: settings.ProxyChainEnabled,
		FastestServer: settings.FastestServer,
	}
	if settings.ProxyChainEnabled {
		value.Chain, value.ChainExit = settings.ProxyChain, settings.ProxyChainExit
	}
	data, _ := json.Marshal(value)
	return string(data)
}

func (a *App) requestCoreReload() {
	a.mu.Lock()
	connected := a.state.Status == StatusConnected || a.state.Status == StatusConnecting
	a.mu.Unlock()
	if connected {
		a.emit(coreReloadEventName, nil)
	}
}

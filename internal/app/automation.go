package app

import (
	"errors"
	"fmt"
	"slices"
	"sync"
	"time"

	"github.com/Rigby-Foundation/NuggetVPN/internal/wifi"
)

// ---------------------------------------------------------------------------
// Routing schedule and Wi-Fi rules
// ---------------------------------------------------------------------------

type automation struct {
	mu sync.Mutex
	// scheduled is what the schedule last wanted, with the schedule it came
	// from: the schedule acts when either changes, so a setup the user picks
	// by hand stays until the next scheduled change.
	scheduled string

	// network is the Wi-Fi network last seen; known is false until the
	// first look.
	network wifi.Network
	hidden  bool
	known   bool
}

// followSchedule switches to the setup the routing schedule wants, when that
// changes.
func (a *App) followSchedule() {
	_, settings := a.snapshot()
	want := settings.ScheduledSetup(time.Now())
	key := fmt.Sprint(want, settings.RoutingSchedule, settings.ScheduleFallback)

	a.automation.mu.Lock()
	changed := key != a.automation.scheduled
	a.automation.scheduled = key
	a.automation.mu.Unlock()
	if !changed || want == "" || want == settings.ActiveRoutingSetup {
		return
	}
	name := want
	for _, setup := range settings.RoutingSetups {
		if setup.ID == want && setup.Name != "" {
			name = setup.Name
		}
	}
	a.appendLog("Routing schedule: switching to " + name)
	if _, err := a.SwitchRoutingSetup(want); err != nil {
		a.appendLog("WARN routing schedule: " + err.Error())
	}
}

// WifiState is the Wi-Fi network, for the window.
type WifiState struct {
	OnWifi bool   `json:"on_wifi"`
	SSID   string `json:"ssid"`
	// Hidden: on Wi-Fi, but the system would not say which network.
	Hidden bool `json:"hidden"`
	// Unsupported: this system cannot be asked.
	Unsupported bool `json:"unsupported"`
}

// GetWifiState reads the Wi-Fi network now.
func (a *App) GetWifiState() WifiState {
	network, err := wifi.Current()
	return WifiState{
		OnWifi: network.OnWifi, SSID: network.SSID,
		Hidden:      errors.Is(err, wifi.ErrHidden),
		Unsupported: errors.Is(err, wifi.ErrUnsupported),
	}
}

// checkWifi acts on joining a network: connects on one that is not trusted,
// disconnects on one that is, as the settings say.
func (a *App) checkWifi() {
	_, settings := a.snapshot()
	if !settings.WifiAutoConnect && !settings.WifiTrustedDisconnect {
		a.automation.mu.Lock()
		a.automation.known = false
		a.automation.mu.Unlock()
		return
	}
	network, err := wifi.Current()
	if errors.Is(err, wifi.ErrUnsupported) {
		return
	}
	hidden := errors.Is(err, wifi.ErrHidden)

	a.automation.mu.Lock()
	first := !a.automation.known
	changed := first || network != a.automation.network || hidden != a.automation.hidden
	a.automation.network, a.automation.hidden, a.automation.known = network, hidden, true
	a.automation.mu.Unlock()
	if !changed {
		return
	}
	a.emit(wifiEventName, WifiState{OnWifi: network.OnWifi, SSID: network.SSID, Hidden: hidden})
	// Not on the first look: the app has just started, and its own
	// auto-connect decides what happens then.
	if first || !network.OnWifi || network.SSID == "" {
		return
	}

	a.mu.Lock()
	status := a.state.Status
	a.mu.Unlock()
	trusted := slices.Contains(settings.TrustedNetworks, network.SSID)
	switch {
	case trusted && settings.WifiTrustedDisconnect && status == StatusConnected:
		a.appendLog(fmt.Sprintf("Joined %s, a trusted network: disconnecting", network.SSID))
		go func() { _, _ = a.Disconnect() }()
	case !trusted && settings.WifiAutoConnect && (status == StatusIdle || status == StatusError):
		selection := settings.LastSelection
		if selection == nil {
			return
		}
		a.appendLog(fmt.Sprintf("Joined %s: connecting", network.SSID))
		go func() { _, _ = a.Connect(selection.Domain, selection.Mode, selection.ProfileID) }()
	}
}

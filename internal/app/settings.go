package app

import (
	"fmt"
	"time"

	"github.com/Rigby-Foundation/Kage/internal/autostart"
	"github.com/Rigby-Foundation/Kage/internal/models"
	"github.com/Rigby-Foundation/Kage/internal/storage"
)

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

// GetSettings returns the persisted settings.
func (a *App) GetSettings() models.AppSettings {
	// The system owns this one, and it can be changed outside the app, so the
	// known state is refreshed from it whenever settings are read.
	enabled := autostart.Enabled()
	a.mu.Lock()
	a.settings.LaunchAtStartup = enabled
	settings := a.settings
	a.mu.Unlock()
	return settings
}

// SaveSettings persists settings coming from the UI. Normalisation happens
// here, once, rather than being duplicated in the renderer.
func (a *App) SaveSettings(settings models.AppSettings) (models.AppSettings, error) {
	return a.saveSettings(settings, true)
}

func (a *App) saveSettings(settings models.AppSettings, promptReload bool) (models.AppSettings, error) {
	settings.Normalize()
	if _, ok := models.ParseDNSServer(settings.DNS); !ok {
		return a.GetSettings(), fmt.Errorf("unsupported DNS resolver; use an IP address, udp://, tcp:// or https://")
	}

	// Only a change is applied, compared with the last state read from the
	// system. Several saves come from inside the app with its own copy of the
	// settings; comparing with the system instead would let one of those turn
	// autostart back on after the user had switched it off in Task Manager.
	// Applied first: if the system refuses, nothing is saved, and the switch
	// does not claim something that did not happen.
	a.mu.Lock()
	previous := a.settings.LaunchAtStartup
	a.mu.Unlock()
	if settings.LaunchAtStartup != previous {
		if err := autostart.Set(settings.LaunchAtStartup); err != nil {
			return a.GetSettings(), err
		}
	}

	a.mu.Lock()
	if err := storage.SaveSettings(settings); err != nil {
		previous := a.settings
		a.mu.Unlock()
		return previous, err
	}
	coreChanged := coreSettingsSignature(a.settings) != coreSettingsSignature(settings)
	setupsChanged := setupsSignature(a.settings) != setupsSignature(settings)
	loggingStopped := a.settings.LoggingOn() && !settings.LoggingOn()
	if models.On(a.settings.AppStats) != models.On(settings.AppStats) {
		a.advanceAnalyticsClockLocked(time.Now())
		a.resetAnalyticsSampleLocked()
	}
	a.settings = settings
	a.loggingOn.Store(settings.LoggingOn())
	a.mu.Unlock()

	if loggingStopped {
		a.discardLogs()
	}

	// The tray lists the routing setups; rebuilt only when they change, not
	// on every node dragged across the canvas.
	if setupsChanged {
		a.refreshTrayMenu()
	}
	if promptReload && coreChanged {
		a.requestCoreReload()
	}
	return settings, nil
}

// setupsSignature is what the tray shows of the routing setups.
func setupsSignature(settings models.AppSettings) string {
	signature := settings.ActiveRoutingSetup
	for _, setup := range settings.RoutingSetups {
		signature += "\x00" + setup.ID + "\x01" + setup.Name
	}
	return signature
}

// RegenerateHWID issues a new subscription device id and saves it.
//
// It lives in Go rather than being a field the UI fills in because the format
// is a contract with the provider's panel: a value outside it gets the whole
// subscription request refused rather than ignored.
func (a *App) RegenerateHWID() (models.AppSettings, error) {
	_, settings := a.snapshot()
	settings.HWID = models.NewHWID()
	return a.SaveSettings(settings)
}

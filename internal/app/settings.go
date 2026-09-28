package app

import (
	"github.com/Rigby-Foundation/NuggetVPN/internal/models"
	"github.com/Rigby-Foundation/NuggetVPN/internal/storage"
)

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

// GetSettings returns the persisted settings.
func (a *App) GetSettings() models.AppSettings {
	_, settings := a.snapshot()
	return settings
}

// SaveSettings persists settings coming from the UI. Normalisation happens
// here, once, rather than being duplicated in the renderer.
func (a *App) SaveSettings(settings models.AppSettings) (models.AppSettings, error) {
	settings.Normalize()

	a.mu.Lock()
	a.settings = settings
	a.mu.Unlock()

	return settings, storage.SaveSettings(settings)
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

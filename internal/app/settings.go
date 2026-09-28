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

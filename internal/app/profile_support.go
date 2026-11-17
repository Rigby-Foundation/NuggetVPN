package app

import (
	"github.com/Rigby-Foundation/Kage/internal/models"
	"github.com/Rigby-Foundation/Kage/internal/xrayconfig"
)

// UnsupportedProfiles explains which saved profiles native Xray cannot run.
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
func checkProfile(settings models.AppSettings, profile models.Profile) error {
	return xrayconfig.Check(profile, settings)
}

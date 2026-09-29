package app

import (
	"fmt"
	"strings"
	
	"github.com/google/uuid"
	
	"github.com/Rigby-Foundation/NuggetVPN/internal/link"
	"github.com/Rigby-Foundation/NuggetVPN/internal/models"
	"github.com/Rigby-Foundation/NuggetVPN/internal/storage"
)

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------

func (a *App) snapshot() ([]models.Profile, models.AppSettings) {
	a.mu.Lock()
	defer a.mu.Unlock()
	profiles := make([]models.Profile, len(a.profiles))
	copy(profiles, a.profiles)
	return profiles, a.settings
}

func (a *App) replaceProfiles(profiles []models.Profile) []models.Profile {
	a.mu.Lock()
	a.profiles = profiles
	snapshot := make([]models.Profile, len(profiles))
	copy(snapshot, profiles)
	a.mu.Unlock()

	_ = storage.SaveProfiles(snapshot)
	return snapshot
}

// GetProfiles returns every saved profile.
func (a *App) GetProfiles() []models.Profile {
	profiles, _ := a.snapshot()
	return profiles
}

// AddProfile stores a hand-entered link. An empty name is derived from the link.
func (a *App) AddProfile(name, configLink string) ([]models.Profile, error) {
	trimmed := strings.TrimSpace(configLink)
	if trimmed == "" {
		return nil, fmt.Errorf("a config link is required")
	}

	resolved := strings.TrimSpace(name)
	if resolved == "" {
		resolved = link.ExtractName(trimmed)
	}
	zero := uint64(0)

	profiles, _ := a.snapshot()
	profiles = append(profiles, models.Profile{
		ID:           uuid.NewString(),
		Name:         resolved,
		Server:       "Auto",
		Protocol:     link.DetectProtocol(trimmed),
		ConfigLink:   trimmed,
		SourceDomain: "local",
		TotalUp:      &zero,
		TotalDown:    &zero,
	})
	return a.replaceProfiles(profiles), nil
}

// DeleteProfile removes one profile by id.
func (a *App) DeleteProfile(id string) ([]models.Profile, error) {
	profiles, _ := a.snapshot()
	kept := profiles[:0]
	for _, profile := range profiles {
		if profile.ID != id {
			kept = append(kept, profile)
		}
	}
	return a.replaceProfiles(kept), nil
}

// DeleteProfilesBySource removes every profile from one subscription.
func (a *App) DeleteProfilesBySource(sourceDomain string) ([]models.Profile, error) {
	target := strings.TrimSpace(sourceDomain)
	profiles, _ := a.snapshot()
	kept := profiles[:0]
	for _, profile := range profiles {
		if profile.NormalizedSourceDomain() != target {
			kept = append(kept, profile)
		}
	}
	return a.replaceProfiles(kept), nil
}

// DeleteProfilesByIds removes a batch of profiles.
func (a *App) DeleteProfilesByIds(ids []string) ([]models.Profile, error) {
	profiles, _ := a.snapshot()
	if len(ids) == 0 {
		return profiles, nil
	}
	remove := make(map[string]bool, len(ids))
	for _, id := range ids {
		remove[id] = true
	}
	kept := profiles[:0]
	for _, profile := range profiles {
		if !remove[profile.ID] {
			kept = append(kept, profile)
		}
	}
	return a.replaceProfiles(kept), nil
}

// SetFavorites stars or unstars servers. Starred servers are listed first,
// and a subscription refresh keeps the star on each.
func (a *App) SetFavorites(ids []string, favorite bool) ([]models.Profile, error) {
	profiles, _ := a.snapshot()
	wanted := make(map[string]bool, len(ids))
	for _, id := range ids {
		wanted[id] = true
	}
	for index := range profiles {
		if wanted[profiles[index].ID] {
			profiles[index].Favorite = favorite
		}
	}
	return a.replaceProfiles(profiles), nil
}

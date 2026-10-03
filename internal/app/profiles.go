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

// ShareLinks returns a share link for every server in the given profiles, in
// their order: the link a profile was imported from, or for a JSON or YAML
// config, one link per server in it. Profiles with nothing shareable are
// skipped; an error means none of them had anything.
func (a *App) ShareLinks(ids []string) ([]link.SharedLink, error) {
	profiles, _ := a.snapshot()
	byID := make(map[string]models.Profile, len(profiles))
	for _, profile := range profiles {
		byID[profile.ID] = profile
	}
	links := []link.SharedLink{}
	var lastErr error
	for _, id := range ids {
		profile, ok := byID[id]
		if !ok {
			continue
		}
		shared, err := link.ShareLinks(profile.ConfigLink, profile.Name)
		if err != nil {
			lastErr = fmt.Errorf("%s: %w", profile.Name, err)
			continue
		}
		links = append(links, shared...)
	}
	if len(links) == 0 && lastErr != nil {
		return nil, lastErr
	}
	return links, nil
}

// UpdateProfile updates an existing profile's name and configLink.
func (a *App) UpdateProfile(id, name, configLink string) ([]models.Profile, error) {
	trimmedLink := strings.TrimSpace(configLink)
	if trimmedLink == "" {
		return nil, fmt.Errorf("config link cannot be empty")
	}

	profiles, settings := a.snapshot()
	index := -1
	for i, p := range profiles {
		if p.ID == id {
			index = i
			break
		}
	}
	if index < 0 {
		return nil, fmt.Errorf("profile not found: %s", id)
	}

	outbound, err := link.ParseOutbound(trimmedLink, settings)
	if err != nil {
		return nil, fmt.Errorf("invalid config link: %w", err)
	}

	resolvedName := strings.TrimSpace(name)
	if resolvedName == "" {
		resolvedName = link.ExtractName(trimmedLink)
	}
	if resolvedName == "" {
		resolvedName = profiles[index].Name
	}

	server := outbound.Server()
	if server == "" {
		server = "Auto"
	}

	profiles[index].Name = resolvedName
	profiles[index].ConfigLink = trimmedLink
	profiles[index].Server = server
	profiles[index].Protocol = link.DetectProtocol(trimmedLink)

	return a.replaceProfiles(profiles), nil
}

// UpdateSubscriptionURL changes the subscription URL for a subscription domain.
func (a *App) UpdateSubscriptionURL(domain, newURL string) ([]models.Profile, error) {
	trimmedURL := strings.TrimSpace(newURL)
	if trimmedURL == "" {
		return nil, fmt.Errorf("subscription URL cannot be empty")
	}
	profiles, _ := a.snapshot()
	updated := false
	for i := range profiles {
		if profiles[i].NormalizedSourceDomain() == domain {
			profiles[i].SubscriptionURL = trimmedURL
			updated = true
		}
	}
	if !updated {
		return nil, fmt.Errorf("subscription domain not found: %s", domain)
	}
	return a.replaceProfiles(profiles), nil
}

// ExportConfigs exports the given profiles into sing-box, clash, or xray configuration.
func (a *App) ExportConfigs(ids []string, format string, full bool) (string, error) {
	profiles, settings := a.snapshot()
	byID := make(map[string]models.Profile, len(profiles))
	for _, p := range profiles {
		byID[p.ID] = p
	}

	var targets []models.Profile
	if len(ids) == 0 {
		targets = profiles
	} else {
		for _, id := range ids {
			if p, ok := byID[id]; ok {
				targets = append(targets, p)
			}
		}
	}
	if len(targets) == 0 {
		return "", fmt.Errorf("no profiles to export")
	}

	return link.Export(targets, settings, format, full)
}

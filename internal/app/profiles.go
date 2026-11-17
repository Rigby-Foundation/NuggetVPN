package app

import (
	"fmt"
	"slices"
	"strings"

	"github.com/google/uuid"

	"github.com/Rigby-Foundation/Kage/internal/link"
	"github.com/Rigby-Foundation/Kage/internal/models"
	"github.com/Rigby-Foundation/Kage/internal/xrayconfig"
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

// editProfiles applies a mutation to the latest list and commits it before
// publishing it in memory. Refreshes and traffic updates share this lock.
func (a *App) editProfiles(edit func([]models.Profile) ([]models.Profile, error)) ([]models.Profile, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.profileStore.CheckAccess(); err != nil {
		return nil, err
	}
	profiles, err := edit(slices.Clone(a.profiles))
	if err != nil {
		return nil, err
	}
	return a.replaceProfilesLocked(profiles)
}

func (a *App) replaceProfilesLocked(profiles []models.Profile) ([]models.Profile, error) {
	for i := range profiles {
		link.NormalizeProfileMetadata(&profiles[i])
	}
	if err := a.profileStore.Save(profiles); err != nil {
		return nil, err
	}
	a.profiles = profiles
	return append([]models.Profile{}, profiles...), nil
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
	if err := a.checkProfileAccess(); err != nil {
		return nil, err
	}
	if err := checkProfile(a.GetSettings(), models.Profile{ConfigLink: trimmed}); err != nil {
		return nil, fmt.Errorf("invalid Xray config: %w", err)
	}

	resolved := strings.TrimSpace(name)
	if resolved == "" {
		resolved = link.ExtractName(trimmed)
	}
	zero := uint64(0)
	profile := models.Profile{
		ID:           uuid.NewString(),
		Name:         resolved,
		Description:  link.ExtractDescription(trimmed),
		Server:       "Auto",
		Protocol:     link.DetectProtocol(trimmed),
		ConfigLink:   trimmed,
		SourceDomain: "local",
		TotalUp:      &zero,
		TotalDown:    &zero,
	}
	return a.editProfiles(func(profiles []models.Profile) ([]models.Profile, error) {
		return append(profiles, profile), nil
	})
}

// DeleteProfile removes one profile by id.
func (a *App) DeleteProfile(id string) ([]models.Profile, error) {
	return a.DeleteProfilesByIds([]string{id})
}

// DeleteProfilesBySource removes every profile from one subscription.
func (a *App) DeleteProfilesBySource(sourceDomain string) ([]models.Profile, error) {
	target := strings.TrimSpace(sourceDomain)
	return a.editProfiles(func(profiles []models.Profile) ([]models.Profile, error) {
		return slices.DeleteFunc(profiles, func(profile models.Profile) bool {
			return profile.NormalizedSourceDomain() == target
		}), nil
	})
}

// DeleteProfilesByIds removes a batch of profiles.
func (a *App) DeleteProfilesByIds(ids []string) ([]models.Profile, error) {
	if len(ids) == 0 {
		return a.GetProfiles(), a.checkProfileAccess()
	}
	remove := make(map[string]bool, len(ids))
	for _, id := range ids {
		remove[id] = true
	}
	return a.editProfiles(func(profiles []models.Profile) ([]models.Profile, error) {
		return slices.DeleteFunc(profiles, func(profile models.Profile) bool {
			return remove[profile.ID]
		}), nil
	})
}

// SetFavorites stars or unstars servers. Starred servers are listed first,
// and a subscription refresh keeps the star on each.
func (a *App) SetFavorites(ids []string, favorite bool) ([]models.Profile, error) {
	wanted := make(map[string]bool, len(ids))
	for _, id := range ids {
		wanted[id] = true
	}
	return a.editProfiles(func(profiles []models.Profile) ([]models.Profile, error) {
		for index := range profiles {
			if wanted[profiles[index].ID] {
				profiles[index].Favorite = favorite
			}
		}
		return profiles, nil
	})
}

// ShareLinks returns a share link for every server in the given profiles, in
// their order: the link a profile was imported from, or for a JSON or YAML
// config, one link per server in it. Profiles with nothing shareable are
// skipped; an error means none of them had anything.
func (a *App) ShareLinks(ids []string) ([]link.SharedLink, error) {
	if err := a.checkProfileAccess(); err != nil {
		return nil, err
	}
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

	if err := a.checkProfileAccess(); err != nil {
		return nil, err
	}
	settings := a.GetSettings()
	outbound, err := link.ParseOutbound(trimmedLink, settings)
	if err != nil {
		return nil, fmt.Errorf("invalid config link: %w", err)
	}
	if err := checkProfile(settings, models.Profile{ConfigLink: trimmedLink}); err != nil {
		return nil, fmt.Errorf("invalid Xray config: %w", err)
	}

	resolvedName := strings.TrimSpace(name)
	if resolvedName == "" {
		resolvedName = link.ExtractName(trimmedLink)
	}
	server := outbound.Server()
	if server == "" {
		server = "Auto"
	}

	return a.editProfiles(func(profiles []models.Profile) ([]models.Profile, error) {
		for i := range profiles {
			profile := &profiles[i]
			if profile.ID != id {
				continue
			}
			if resolvedName != "" {
				profile.Name = resolvedName
			}
			profile.Description = link.ExtractDescription(trimmedLink)
			profile.ConfigLink = trimmedLink
			profile.Server = server
			profile.Protocol = link.DetectProtocol(trimmedLink)
			return profiles, nil
		}
		return nil, fmt.Errorf("profile not found: %s", id)
	})
}

// UpdateSubscriptionURL changes the subscription URL for a subscription domain.
func (a *App) UpdateSubscriptionURL(domain, newURL string) ([]models.Profile, error) {
	trimmedURL := strings.TrimSpace(newURL)
	if trimmedURL == "" {
		return nil, fmt.Errorf("subscription URL cannot be empty")
	}
	return a.editProfiles(func(profiles []models.Profile) ([]models.Profile, error) {
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
		return profiles, nil
	})
}

// ExportConfigs exports the given profiles into sing-box, clash, or xray configuration.
func (a *App) ExportConfigs(ids []string, format string, full bool) (string, error) {
	if err := a.checkProfileAccess(); err != nil {
		return "", err
	}
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

	if link.NormalizeFormat(format) == link.FormatXray {
		return xrayconfig.Export(targets, settings, full)
	}
	return link.Export(targets, settings, format, full)
}

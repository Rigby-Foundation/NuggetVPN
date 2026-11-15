package app

import (
	"github.com/Rigby-Foundation/NuggetVPN/internal/models"
	"github.com/Rigby-Foundation/NuggetVPN/internal/remote"
	"github.com/Rigby-Foundation/NuggetVPN/internal/storage"
)

// ---------------------------------------------------------------------------
// Subscriptions and sync
// ---------------------------------------------------------------------------

// ImportSubscription fetches a subscription URL and adds its profiles.
func (a *App) ImportSubscription(url string) ([]models.Profile, error) {
	// A subscription body is read whole; see releaseMemory.
	defer releaseMemory()
	settings := a.GetSettings()
	replacement, err := a.remote.FetchSubscription(a.context(), settings, url)
	if err != nil {
		return nil, err
	}
	return a.applySubscriptions([]remote.Replacement{replacement}), nil
}

// RefreshSubscriptionsOnStartup re-fetches every saved subscription.
func (a *App) RefreshSubscriptionsOnStartup() (remote.RefreshSummary, error) {
	return a.refreshSubscriptions("")
}

// RefreshSubscriptionByDomain re-fetches each subscription on the given host.
func (a *App) RefreshSubscriptionByDomain(sourceDomain string) (remote.RefreshSummary, error) {
	return a.refreshSubscriptions(sourceDomain)
}

func (a *App) refreshSubscriptions(sourceDomain string) (remote.RefreshSummary, error) {
	// A subscription body is read whole; see releaseMemory.
	defer releaseMemory()
	profiles, settings := a.snapshot()
	replacements, summary, err := a.remote.FetchSubscriptions(a.context(), profiles, settings, sourceDomain)
	if err != nil {
		return summary, err
	}
	if len(replacements) != 0 {
		a.applySubscriptions(replacements)
	}
	return summary, nil
}

func (a *App) applySubscriptions(replacements []remote.Replacement) []models.Profile {
	a.mu.Lock()
	profiles := a.replaceProfilesLocked(remote.Apply(a.profiles, replacements))
	a.mu.Unlock()
	_ = storage.SaveProfiles(profiles)
	return profiles
}

// LoginUser authenticates against the profile sync server.
func (a *App) LoginUser(server, username, password string) (string, error) {
	return a.remote.Login(a.context(), server, username, password)
}

// RegisterUser creates an account on the profile sync server.
func (a *App) RegisterUser(server, username, password string) (string, error) {
	return a.remote.Register(a.context(), server, username, password)
}

// PushProfilesToServer uploads local profiles.
func (a *App) PushProfilesToServer(settings models.AppSettings) (string, error) {
	profiles, settings := a.snapshot()
	return a.remote.PushProfiles(a.context(), settings, profiles)
}

// PullProfilesFromServer replaces local profiles with the server's copy.
func (a *App) PullProfilesFromServer(settings models.AppSettings) ([]models.Profile, error) {
	profiles, err := a.remote.PullProfiles(a.context(), settings)
	if err != nil {
		return nil, err
	}
	if len(profiles) == 0 {
		return a.GetProfiles(), nil
	}
	return a.replaceProfiles(profiles), nil
}

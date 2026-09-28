package app

import (
	"github.com/Rigby-Foundation/NuggetVPN/internal/models"
	"github.com/Rigby-Foundation/NuggetVPN/internal/remote"
)

// ---------------------------------------------------------------------------
// Subscriptions and sync
// ---------------------------------------------------------------------------

// ImportSubscription fetches a subscription URL and adds its profiles.
func (a *App) ImportSubscription(url string) ([]models.Profile, error) {
	profiles, settings := a.snapshot()
	updated, err := a.remote.ImportSubscription(a.context(), profiles, settings, url)
	if err != nil {
		return nil, err
	}
	return a.replaceProfiles(updated), nil
}

// RefreshSubscriptionsOnStartup re-fetches every saved subscription.
func (a *App) RefreshSubscriptionsOnStartup() (remote.RefreshSummary, error) {
	profiles, settings := a.snapshot()
	updated, summary, err := a.remote.RefreshSubscriptions(a.context(), profiles, settings, "")
	if err != nil {
		return summary, err
	}
	a.replaceProfiles(updated)
	return summary, nil
}

// RefreshSubscriptionByDomain re-fetches a single subscription.
func (a *App) RefreshSubscriptionByDomain(sourceDomain string) (remote.RefreshSummary, error) {
	profiles, settings := a.snapshot()
	updated, summary, err := a.remote.RefreshSubscriptions(a.context(), profiles, settings, sourceDomain)
	if err != nil {
		return summary, err
	}
	a.replaceProfiles(updated)
	return summary, nil
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

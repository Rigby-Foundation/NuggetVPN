package app

import (
	"context"
	"errors"

	"github.com/Rigby-Foundation/NuggetVPN/internal/beam"
	"github.com/Rigby-Foundation/NuggetVPN/internal/models"
)

// ---------------------------------------------------------------------------
// Migrating from Beam
// ---------------------------------------------------------------------------

// BeamOffer says whether Beam data exists and what importing it would do.
type BeamOffer struct {
	// Found is true when there is a Beam installation to import from.
	Found bool `json:"found"`
	// Prompt is true when the first-start dialog should appear: Beam data
	// exists, nothing has been set up here yet, and the offer has not already
	// been answered.
	Prompt  bool          `json:"prompt"`
	Preview *beam.Preview `json:"preview"`
}

// BeamMigrationReport is the state after importing, for the UI to adopt.
type BeamMigrationReport struct {
	Profiles  []models.Profile   `json:"profiles"`
	Settings  models.AppSettings `json:"settings"`
	Outcomes  []beam.Outcome     `json:"outcomes"`
	Selection *beam.Selection    `json:"selection"`
	Theme     string             `json:"theme"`
}

// GetBeamOffer looks for a Beam installation. It only reads.
func (a *App) GetBeamOffer() BeamOffer {
	data, err := beam.Load(beam.Dir())
	if err != nil {
		return BeamOffer{}
	}
	profiles, settings := a.snapshot()
	preview := beam.NewPreview(data)
	return BeamOffer{
		Found:   true,
		Prompt:  settings.BeamMigration == "" && len(profiles) == 0,
		Preview: &preview,
	}
}

// MigrateFromBeam imports Beam's subscriptions and settings.
//
// Beam's files are only read, never changed, so this can be run again, and
// Beam still works afterwards.
func (a *App) MigrateFromBeam() (BeamMigrationReport, error) {
	data, err := beam.Load(beam.Dir())
	if errors.Is(err, beam.ErrNotFound) {
		return BeamMigrationReport{}, errors.New("no Beam data was found on this computer")
	}
	if err != nil {
		return BeamMigrationReport{}, err
	}

	profiles, settings := a.snapshot()
	fetch := func(ctx context.Context, settings models.AppSettings, url string) ([]models.Profile, error) {
		return a.remote.ImportSubscription(ctx, nil, settings, url)
	}
	result := beam.Migrate(a.context(), data, profiles, settings, fetch)
	result.Settings.BeamMigration = models.BeamMigrationDone

	saved, err := a.SaveSettings(result.Settings)
	if err != nil {
		return BeamMigrationReport{}, err
	}
	return BeamMigrationReport{
		Profiles:  a.replaceProfiles(result.Profiles),
		Settings:  saved,
		Outcomes:  result.Outcomes,
		Selection: result.Selection,
		Theme:     result.Theme,
	}, nil
}

// DismissBeamMigration records that the first-start offer was declined, so it
// is not asked again. Settings can still run the import later.
func (a *App) DismissBeamMigration() (models.AppSettings, error) {
	_, settings := a.snapshot()
	settings.BeamMigration = models.BeamMigrationDismissed
	return a.SaveSettings(settings)
}

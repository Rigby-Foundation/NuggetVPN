package app

import (
	"errors"
	"path/filepath"
	"sync"
	"testing"

	"github.com/Rigby-Foundation/Kage/internal/models"
	"github.com/Rigby-Foundation/Kage/internal/storage"
)

func TestProtectedProfilesUseTheSameStoreForEditsAndUsage(t *testing.T) {
	path := filepath.Join(t.TempDir(), "profiles.json")
	password := "test master password"
	profile := models.Profile{ID: "p", Name: "Private server", SourceDomain: "example.test", ConfigLink: "trojan://secret@example.test:443"}
	store, _ := storage.OpenProfiles(path)
	if err := store.Enable([]byte(password), "standard", []models.Profile{profile}); err != nil {
		t.Fatal(err)
	}
	store.Close()
	store, profiles := storage.OpenProfiles(path)
	app := &App{profileStore: store, profiles: profiles}
	if len(app.GetProfiles()) != 0 {
		t.Fatal("locked profiles were exposed to the frontend")
	}
	if _, err := app.DeleteProfile(profile.ID); !errors.Is(err, storage.ErrProfilesLocked) {
		t.Fatalf("delete while locked: %v", err)
	}
	if _, err := app.ExportConfigs(nil, "xray", true); !errors.Is(err, storage.ErrProfilesLocked) {
		t.Fatalf("export while locked: %v", err)
	}
	if _, _, err := app.handleCommand("servers", nil); !errors.Is(err, storage.ErrProfilesLocked) {
		t.Fatalf("CLI while locked: %v", err)
	}
	if _, err := app.UnlockProfiles(password); err != nil {
		t.Fatal(err)
	}

	var updates sync.WaitGroup
	updates.Go(func() { app.addProfileUsage(profile.ID, 11, 29) })
	updates.Go(func() {
		if _, err := app.SetFavorites([]string{profile.ID}, true); err != nil {
			t.Error(err)
		}
	})
	updates.Wait()
	store.Close()
	saved, profiles := storage.OpenProfiles(path)
	if !saved.Status().Locked || len(profiles) != 0 {
		t.Fatal("an ordinary profile update saved plaintext")
	}
	defer saved.Close()
	profiles, err := saved.Unlock([]byte(password))
	if err != nil || len(profiles) != 1 {
		t.Fatalf("updates could not be read: %v", err)
	}
	updated := profiles[0]
	if !updated.Favorite || updated.TotalUp == nil || *updated.TotalUp != 11 || updated.TotalDown == nil || *updated.TotalDown != 29 {
		t.Fatalf("a concurrent update was lost: %+v", updated)
	}
}

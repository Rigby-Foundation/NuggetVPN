package storage

import (
	"os"
	"path/filepath"
	"testing"
)

func TestDirectoryMigrationPreservesProfilesAndExistingData(t *testing.T) {
	for _, destination := range []string{"missing", "empty", "populated"} {
		t.Run(destination, func(t *testing.T) {
			root := t.TempDir()
			old, current := filepath.Join(root, "old"), filepath.Join(root, "new")
			if err := os.Mkdir(old, 0o700); err != nil {
				t.Fatal(err)
			}
			// The migration moves opaque bytes, including an encrypted store.
			payload := []byte("{encrypted profile bytes}")
			if err := os.WriteFile(filepath.Join(old, "profiles.json"), payload, 0o600); err != nil {
				t.Fatal(err)
			}
			if destination != "missing" {
				if err := os.Mkdir(current, 0o700); err != nil {
					t.Fatal(err)
				}
			}
			if destination == "populated" {
				if err := os.WriteFile(filepath.Join(current, "settings.json"), []byte("existing"), 0o600); err != nil {
					t.Fatal(err)
				}
			}
			path, err := moveLegacyDirectory(old, current)
			if err != nil || path != current {
				t.Fatalf("migration result %q: %v", path, err)
			}
			target := current
			if destination == "populated" {
				target = old
			}
			saved, err := os.ReadFile(filepath.Join(target, "profiles.json"))
			if err != nil || string(saved) != string(payload) {
				t.Fatalf("profiles were lost or changed: %q, %v", saved, err)
			}
			if _, err := moveLegacyDirectory(old, current); err != nil {
				t.Fatalf("repeat migration failed: %v", err)
			}
		})
	}
}

func TestDirectoryMigrationFailureKeepsTheOldStoreAvailable(t *testing.T) {
	root := t.TempDir()
	old, parent := filepath.Join(root, "old"), filepath.Join(root, "blocked")
	if err := os.Mkdir(old, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(parent, []byte("file"), 0o600); err != nil {
		t.Fatal(err)
	}
	path, err := moveLegacyDirectory(old, filepath.Join(parent, "new"))
	if err == nil || path != old {
		t.Fatalf("expected fallback to original store: %q, %v", path, err)
	}
}

func TestSetupDistinguishesFreshAndEstablishedInstallations(t *testing.T) {
	for _, test := range []struct {
		name     string
		settings string
		profiles bool
		complete bool
	}{
		{name: "fresh"},
		{name: "legacy settings", settings: "{}", complete: true},
		{name: "existing profiles", profiles: true, complete: true},
		{name: "unreadable settings content", settings: "{", complete: true},
		{name: "unfinished setup", settings: `{"setup_completed":false}`},
		{name: "completed setup", settings: `{"setup_completed":true}`, complete: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			previous := migration
			migration.data = t.TempDir()
			t.Cleanup(func() { migration = previous })
			if test.settings != "" {
				if err := os.WriteFile(SettingsPath(), []byte(test.settings), 0o600); err != nil {
					t.Fatal(err)
				}
			}
			if test.profiles {
				if err := os.WriteFile(ProfilesPath(), []byte("[]"), 0o600); err != nil {
					t.Fatal(err)
				}
			}
			settings := LoadSettings()
			if settings.SetupCompleted == nil || *settings.SetupCompleted != test.complete {
				t.Fatalf("setup completed = %v, want %v", settings.SetupCompleted, test.complete)
			}
			if err := SaveSettings(settings); err != nil {
				t.Fatal(err)
			}
			if saved := LoadSettings(); saved.SetupCompleted == nil || *saved.SetupCompleted != test.complete {
				t.Fatal("setup completion changed after a reload")
			}
		})
	}
}

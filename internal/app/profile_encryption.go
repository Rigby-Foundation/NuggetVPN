package app

import (
	"errors"
	"fmt"
	"os"

	"github.com/Rigby-Foundation/NuggetVPN/internal/link"
	"github.com/Rigby-Foundation/NuggetVPN/internal/models"
	"github.com/Rigby-Foundation/NuggetVPN/internal/storage"
)

// GetProfileEncryption reports the local profile store's current state.
func (a *App) GetProfileEncryption() storage.ProfileEncryptionStatus {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.profileEncryptionLocked()
}

func (a *App) profileEncryptionLocked() storage.ProfileEncryptionStatus {
	if a.profileStore == nil {
		return storage.ProfileEncryptionStatus{}
	}
	return a.profileStore.Status()
}

func (a *App) checkProfileAccess() error {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.profileStore.CheckAccess()
}

// EnableProfileEncryption atomically replaces the existing profile file.
func (a *App) EnableProfileEncryption(password, strength string) (storage.ProfileEncryptionStatus, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	status := a.profileStore.Status()
	if password == "" {
		return status, errors.New("enter a master password")
	}
	if err := a.profileStore.CheckAccess(); err != nil {
		return status, err
	}
	if !status.Enabled {
		if err := removeCoreConfigMirror(); err != nil {
			return status, fmt.Errorf("remove the old Xray config: %w", err)
		}
	}
	secret := []byte(password)
	defer clear(secret)
	if err := a.profileStore.Enable(secret, strength, a.profiles); err != nil {
		return status, err
	}
	return a.profileStore.Status(), nil
}

// UnlockProfiles opens the authenticated profile file for this app session.
func (a *App) UnlockProfiles(password string) (storage.ProfileEncryptionStatus, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	secret := []byte(password)
	defer clear(secret)
	profiles, err := a.profileStore.Unlock(secret)
	if err != nil {
		return a.profileStore.Status(), err
	}
	normalizeLoadedProfiles(profiles)
	a.profiles = profiles
	return a.profileStore.Status(), nil
}

// DisableProfileEncryption returns the profile file to its original format.
func (a *App) DisableProfileEncryption(password string) (storage.ProfileEncryptionStatus, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	secret := []byte(password)
	defer clear(secret)
	err := a.profileStore.Disable(secret, a.profiles)
	return a.profileStore.Status(), err
}

func normalizeLoadedProfiles(profiles []models.Profile) bool {
	changed := false
	for i := range profiles {
		profile := &profiles[i]
		if decoded := link.DecodeProfileName(profile.Name); decoded != profile.Name {
			profile.Name = decoded
			changed = true
		}
		if link.NormalizeProfileMetadata(profile) {
			changed = true
		}
	}
	return changed
}

func removeCoreConfigMirror() error {
	err := os.Remove(storage.CoreConfigPath())
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return err
}

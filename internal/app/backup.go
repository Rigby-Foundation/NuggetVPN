package app

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/Rigby-Foundation/NuggetVPN/internal/models"
	"github.com/Rigby-Foundation/NuggetVPN/internal/storage"
)

// ---------------------------------------------------------------------------
// Backup: settings, servers and look, in one file
// ---------------------------------------------------------------------------

const (
	backupFormat    = "nuggetvpn.backup"
	backupVersion   = 1
	backupExtension = ".nvpnbackup"
	// maxBackupSize bounds a backup read; fonts and pictures make up most of
	// one.
	maxBackupSize = 256 << 20
)

// Backup is the file's content.
type Backup struct {
	Format     string             `json:"format"`
	Version    int                `json:"version"`
	Created    string             `json:"created"`
	AppVersion string             `json:"app_version"`
	Settings   models.AppSettings `json:"settings"`
	Profiles   []models.Profile   `json:"profiles"`
	// UI is what the window keeps itself — themes, font, language — as the
	// window handed it over.
	UI json.RawMessage `json:"ui,omitempty"`
	// Files are the added fonts and pictures, by kind, base64-encoded.
	Files map[string][]BackupFile `json:"files,omitempty"`
}

// BackupFile is one added font or picture.
type BackupFile struct {
	UserFile
	Data string `json:"data"`
}

// BackupImport is the result of loading a backup.
type BackupImport struct {
	// Imported is false when the dialog was cancelled.
	Imported bool               `json:"imported"`
	Settings models.AppSettings `json:"settings"`
	Profiles []models.Profile   `json:"profiles"`
	// UI is the window's own part, for it to put back.
	UI json.RawMessage `json:"ui,omitempty"`
}

// ExportBackup saves everything to a file the user picks. ui is the window's
// own part. An empty path means the dialog was cancelled.
func (a *App) ExportBackup(ui string) (string, error) {
	if a.app == nil {
		return "", errors.New("application is not ready")
	}
	if ui != "" && !json.Valid([]byte(ui)) {
		return "", errors.New("the window's settings are not valid JSON")
	}
	dialog := a.app.Dialog.SaveFile().
		SetMessage("Save a backup").
		SetFilename("NuggetVPN " + time.Now().Format("2006-01-02") + backupExtension).
		CanCreateDirectories(true).
		AddFilter("NuggetVPN backup", "*"+backupExtension)
	if a.window != nil {
		dialog = dialog.AttachToWindow(a.window)
	}
	target, err := dialog.PromptForSingleSelection()
	if err != nil || target == "" {
		return "", err
	}
	if !strings.HasSuffix(strings.ToLower(target), backupExtension) {
		target += backupExtension
	}

	profiles, settings := a.snapshot()
	data, err := a.encodeBackup(settings, profiles, json.RawMessage(ui))
	if err != nil {
		return "", err
	}
	return target, os.WriteFile(target, data, 0o600)
}

func (a *App) encodeBackup(settings models.AppSettings, profiles []models.Profile, ui json.RawMessage) ([]byte, error) {
	// What belongs to this device, not to the person: the sign-in token for
	// the sync server is a credential, and the device id is how subscription
	// panels count devices — two devices sharing one would confuse them.
	settings.AuthToken = nil
	settings.HWID = ""

	backup := Backup{
		Format:     backupFormat,
		Version:    backupVersion,
		Created:    time.Now().UTC().Format(time.RFC3339),
		AppVersion: a.version,
		Settings:   settings,
		Profiles:   profiles,
		Files:      map[string][]BackupFile{},
	}
	if len(ui) > 0 {
		backup.UI = ui
	}
	for kind := range userFileKinds {
		for _, file := range readIndex(kind) {
			data, err := os.ReadFile(filepath.Join(userFilesDir(kind), filepath.Base(file.URL)))
			if err != nil {
				continue
			}
			backup.Files[kind] = append(backup.Files[kind], BackupFile{UserFile: file, Data: base64.StdEncoding.EncodeToString(data)})
		}
	}
	return json.Marshal(backup)
}

// ImportBackup loads a backup the user picks, replacing the settings, the
// servers and the added fonts and pictures. The window puts its own part
// back from the result.
func (a *App) ImportBackup() (BackupImport, error) {
	if a.app == nil {
		return BackupImport{}, errors.New("application is not ready")
	}
	dialog := a.app.Dialog.OpenFile().
		SetTitle("Open a backup").
		CanChooseFiles(true).
		AddFilter("NuggetVPN backup", "*"+backupExtension)
	if a.window != nil {
		dialog = dialog.AttachToWindow(a.window)
	}
	picked, err := dialog.PromptForSingleSelection()
	if err != nil || picked == "" {
		return BackupImport{}, err
	}
	file, err := os.Open(picked)
	if err != nil {
		return BackupImport{}, err
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, maxBackupSize+1))
	if err != nil {
		return BackupImport{}, err
	}
	if len(data) > maxBackupSize {
		return BackupImport{}, errors.New("that file is too large to be a backup")
	}
	return a.restoreBackup(data)
}

func (a *App) restoreBackup(data []byte) (BackupImport, error) {
	var backup Backup
	if err := json.Unmarshal(data, &backup); err != nil || backup.Format != backupFormat {
		return BackupImport{}, errors.New("that is not a NuggetVPN backup")
	}
	if backup.Version > backupVersion {
		return BackupImport{}, fmt.Errorf("this backup is version %d, made by a newer NuggetVPN; update the app first", backup.Version)
	}

	// Files first: settings may refer to them.
	for kind, files := range backup.Files {
		if _, known := userFileKinds[kind]; !known {
			continue
		}
		restored := []UserFile{}
		dir := userFilesDir(kind)
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return BackupImport{}, err
		}
		for _, file := range files {
			name := filepath.Base(file.URL)
			if !storedName.MatchString(name) || file.URL != UserFilesPrefix+kind+"/"+name {
				continue
			}
			content, err := base64.StdEncoding.DecodeString(file.Data)
			if err != nil || !looksLike(kind, content) || int64(len(content)) > userFileKinds[kind].maxSize {
				continue
			}
			if err := os.WriteFile(filepath.Join(dir, name), content, 0o644); err != nil {
				return BackupImport{}, err
			}
			restored = append(restored, file.UserFile)
		}
		if err := writeIndex(kind, restored); err != nil {
			return BackupImport{}, err
		}
	}

	// This device keeps its own device id, sign-in, and start-at-login
	// state — the last belongs to the system, not to the file.
	_, current := a.snapshot()
	settings := backup.Settings
	settings.HWID = current.HWID
	settings.AuthToken = current.AuthToken
	settings.LaunchAtStartup = current.LaunchAtStartup
	settings.Normalize()

	for index := range backup.Profiles {
		backup.Profiles[index].ConfigLink = strings.TrimSpace(backup.Profiles[index].ConfigLink)
	}
	profiles := a.replaceProfiles(backup.Profiles)
	saved, err := a.SaveSettings(settings)
	if err != nil {
		return BackupImport{}, err
	}
	if err := a.registerHotkey(saved.GlobalShortcut); err != nil {
		a.appendLog("WARN global shortcut: " + err.Error())
	}
	_ = storage.SaveProfiles(profiles)
	return BackupImport{Imported: true, Settings: saved, Profiles: profiles, UI: backup.UI}, nil
}

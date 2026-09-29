package app

import (
	"encoding/json"
	"testing"

	"github.com/Rigby-Foundation/NuggetVPN/internal/models"
)

// A backup never carries this device's sign-in token or device id, and
// restoring one keeps the device's own.
func TestBackupKeepsDeviceSecrets(t *testing.T) {
	token := "secret-token"
	source := &App{version: "2.0.0"}
	settings := models.DefaultSettings()
	settings.AuthToken = &token
	settings.HWID = "0123456789abcdef"
	settings.KillSwitch = true
	settings.Normalize()

	data, err := source.encodeBackup(settings, []models.Profile{{ID: "p", Name: "One", ConfigLink: "vless://x"}}, json.RawMessage(`{"theme":"dark"}`))
	if err != nil {
		t.Fatal(err)
	}
	var decoded Backup
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatal(err)
	}
	if decoded.Settings.AuthToken != nil || decoded.Settings.HWID != "" {
		t.Errorf("backup carries device secrets: token %v, hwid %q", decoded.Settings.AuthToken, decoded.Settings.HWID)
	}
	if !decoded.Settings.KillSwitch || len(decoded.Profiles) != 1 || string(decoded.UI) != `{"theme":"dark"}` {
		t.Errorf("backup lost content: %+v", decoded)
	}
}

func TestRestoreRefusesOtherFiles(t *testing.T) {
	target := &App{version: "2.0.0"}
	for name, data := range map[string]string{
		"not json":   "hello",
		"other json": `{"format":"something"}`,
		"newer":      `{"format":"nuggetvpn.backup","version":99}`,
	} {
		if _, err := target.restoreBackup([]byte(data)); err == nil {
			t.Errorf("%s: restored", name)
		}
	}
}

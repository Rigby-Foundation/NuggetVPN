package app

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Rigby-Foundation/Kage/internal/models"
	"github.com/Rigby-Foundation/Kage/internal/plugins"
)

func pluginTestStore(t *testing.T) (*App, *plugins.Store) {
	t.Helper()
	original := pluginsStore()
	store := plugins.NewStore(t.TempDir())
	pluginStore = store
	t.Cleanup(func() { pluginStore = original })
	a := &App{version: "test", profiles: []models.Profile{{ID: "server", Name: "Example", ConfigLink: "vless://secret", Server: "example.com"}}}
	return a, store
}

func TestPluginAPIEnforcesPermissionsAndChecksum(t *testing.T) {
	a, store := pluginTestStore(t)
	_, pkg, err := plugins.Pack("../../examples/plugins/glance")
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Install(pkg); err != nil {
		t.Fatal(err)
	}
	if _, err := a.PluginCall(pkg.Manifest.ID, "servers.list", nil); err == nil {
		t.Fatal("profile data exposed without permission")
	}
	if _, err := a.PluginCall(pkg.Manifest.ID, "storage.set", json.RawMessage(`{"key":"hello","value":42}`)); err != nil {
		t.Fatal(err)
	}
	if value, err := a.PluginCall(pkg.Manifest.ID, "storage.get", json.RawMessage(`{"key":"hello"}`)); err != nil || string(value.(json.RawMessage)) != "42" {
		t.Fatal(value, err)
	}
	if _, err := a.PluginCall(pkg.Manifest.ID, "get_settings", nil); err == nil {
		t.Fatal("unrestricted app method exposed")
	}
	target := filepath.Join(store.Dir(), "installed", pkg.Manifest.ID, "panel.html")
	if err := os.WriteFile(target, []byte("changed"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := a.PluginCall(pkg.Manifest.ID, "app.info", nil); err == nil {
		t.Fatal("revoked plugin API still active")
	}
	if _, err := a.SetPluginEnabled(pkg.Manifest.ID, true); err == nil {
		t.Fatal("toggle bypassed approval")
	}
	list := a.ListPlugins()
	if len(list) != 1 || list[0].Enabled || !list[0].ApprovalRequired {
		t.Fatalf("revocation not shown: %+v", list)
	}
}

func TestReviewApprovesOnlyTheDisplayedSnapshot(t *testing.T) {
	a, store := pluginTestStore(t)
	_, pkg, err := plugins.Pack("../../examples/plugins/glance")
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Install(pkg); err != nil {
		t.Fatal(err)
	}
	target := filepath.Join(store.Dir(), "installed", pkg.Manifest.ID, "panel.html")
	if err := os.WriteFile(target, []byte("reviewed"), 0o644); err != nil {
		t.Fatal(err)
	}
	_ = a.ListPlugins()
	preview, err := a.ReviewPlugin(pkg.Manifest.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !preview.Review || preview.Plugin.Checksum == preview.Plugin.ApprovedChecksum {
		t.Fatal("missing review identity")
	}
	if err := os.WriteFile(target, []byte("changed after review"), 0o644); err != nil {
		t.Fatal(err)
	}
	approved, err := a.InstallPlugin(preview.Token)
	if err != nil {
		t.Fatal(err)
	}
	if approved.Checksum != preview.Plugin.Checksum || !approved.Enabled || approved.ApprovalRequired {
		t.Fatal("approved another snapshot")
	}
	content, err := store.ReadFile(pkg.Manifest.ID, "panel.html")
	if err != nil || string(content) != "reviewed" {
		t.Fatal("installed files differ from review:", string(content), err)
	}
	if _, err := a.InstallPlugin(preview.Token); err == nil {
		t.Fatal("approval token reusable")
	}
}

func TestPluginServerListOmitsCredentials(t *testing.T) {
	a, store := pluginTestStore(t)
	dir := t.TempDir()
	manifest := `{"format":1,"id":"com.example.profiles","name":"Profiles","version":"1","permissions":["profiles"]}`
	if err := os.WriteFile(filepath.Join(dir, "plugin.json"), []byte(manifest), 0o644); err != nil {
		t.Fatal(err)
	}
	_, pkg, err := plugins.Pack(dir)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Install(pkg); err != nil {
		t.Fatal(err)
	}
	result, err := a.PluginCall(pkg.Manifest.ID, "servers.list", nil)
	if err != nil {
		t.Fatal(err)
	}
	data, _ := json.Marshal(result)
	if strings.Contains(string(data), "secret") || strings.Contains(string(data), "config_link") {
		t.Fatal("credentials exposed:", string(data))
	}
}

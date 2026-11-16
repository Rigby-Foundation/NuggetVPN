package app

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"sync"
	"testing"

	"github.com/Rigby-Foundation/NuggetVPN/internal/models"
	"github.com/Rigby-Foundation/NuggetVPN/internal/remote"
	"github.com/Rigby-Foundation/NuggetVPN/internal/storage"
)

func TestSyncDownloadKeepsLocalStoreOnFailureAndUsesLocalEncryption(t *testing.T) {
	var mu sync.Mutex
	var rows []map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		if r.Method == http.MethodPost {
			var row map[string]any
			if err := json.NewDecoder(r.Body).Decode(&row); err != nil {
				t.Error(err)
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			row["id"] = len(rows) + 1
			rows = append(rows, row)
		}
		_ = json.NewEncoder(w).Encode(rows)
	}))
	defer server.Close()
	token, syncPassword, localPassword := "token", "sync password", "different local password"
	settings := models.DefaultSettings()
	settings.AuthServer, settings.AuthToken = &server.URL, &token
	client := remote.NewClient()
	downloaded := []models.Profile{{ID: "remote", Name: "Remote", ConfigLink: "trojan://private@vpn.test:443"}}
	if _, err := client.PushProfiles(context.Background(), settings, downloaded, syncPassword); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "profiles.json")
	store, _ := storage.OpenProfiles(path)
	defer store.Close()
	local := []models.Profile{{ID: "local", Name: "Local", ConfigLink: "trojan://original@local.test:443"}}
	if err := store.Enable([]byte(localPassword), "standard", local); err != nil {
		t.Fatal(err)
	}
	app := &App{settings: settings, profiles: local, profileStore: store, remote: client}
	before, _ := os.ReadFile(path)
	if _, err := app.PullProfilesFromServer(settings, "incorrect password"); err == nil {
		t.Fatal("wrong sync password accepted")
	}
	after, _ := os.ReadFile(path)
	if !bytes.Equal(before, after) || !reflect.DeepEqual(app.GetProfiles(), local) {
		t.Fatal("failed decryption changed local profiles")
	}
	got, err := app.PullProfilesFromServer(settings, syncPassword)
	if err != nil || len(got) != 1 || got[0].ID != "remote" {
		t.Fatalf("download failed: %+v, %v", got, err)
	}
	after, _ = os.ReadFile(path)
	if bytes.Contains(after, []byte("trojan://private")) || !store.Status().Enabled {
		t.Fatal("sync download bypassed local encryption")
	}
	// Authentication succeeds but the newest server blob cannot be parsed:
	// the previous local copy still survives unchanged.
	mu.Lock()
	rows = append(rows, map[string]any{"id": 2, "hash": "broken"})
	mu.Unlock()
	if _, err := app.PullProfilesFromServer(settings, syncPassword); err == nil {
		t.Fatal("damaged snapshot accepted")
	}
	unchanged, _ := os.ReadFile(path)
	if !bytes.Equal(after, unchanged) || !reflect.DeepEqual(app.GetProfiles(), got) {
		t.Fatal("damaged snapshot changed local profiles")
	}
	if _, err := client.PushProfiles(context.Background(), settings, nil, syncPassword); err != nil {
		t.Fatal(err)
	}
	if got, err := app.PullProfilesFromServer(settings, syncPassword); err != nil || len(got) != 0 {
		t.Fatalf("empty snapshot was not applied: %+v, %v", got, err)
	}
	store.Close()
	saved, profiles := storage.OpenProfiles(path)
	defer saved.Close()
	if len(profiles) != 0 || !saved.Status().Locked {
		t.Fatal("downloaded store was not locked after reopening")
	}
	profiles, err = saved.Unlock([]byte(localPassword))
	if err != nil || len(profiles) != 0 {
		t.Fatalf("sync replaced the local encryption password: %+v, %v", profiles, err)
	}
}

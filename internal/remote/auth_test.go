package remote

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync"
	"testing"

	"github.com/Rigby-Foundation/NuggetVPN/internal/models"
)

// Match the real NuggetSync contract: append-only POSTs, numeric IDs, and
// GET rows without encryption_type. List order is not guaranteed by SQL.
func TestEncryptedSyncAgainstServerContract(t *testing.T) {
	password, token := "a separate sync passphrase", "session-token"
	var mu sync.Mutex
	var rows []serverProfile
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		if r.URL.Path != "/profiles" || r.Header.Get("Authorization") != "Bearer "+token {
			t.Error("wrong endpoint or authorization")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		switch r.Method {
		case http.MethodPost:
			body, _ := io.ReadAll(r.Body)
			for _, secret := range []string{password, "Private Helsinki", "secret-credential", "secret-subscription"} {
				if strings.Contains(string(body), secret) {
					t.Errorf("plaintext secret appeared in the upload: %q", secret)
				}
			}
			var row serverProfile
			if err := json.Unmarshal(body, &row); err != nil || row.EncryptionType != "XChaCha20-Poly1305" {
				t.Error("server rejected encryption type")
				http.Error(w, "Invalid encryption type", http.StatusBadRequest)
				return
			}
			row.ID = int64(len(rows) + 1)
			row.EncryptionType = "" // the real server doesn't persist it
			rows = append(rows, row)
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(row)
		case http.MethodGet:
			result := make([]map[string]any, 0, len(rows))
			for i := len(rows) - 1; i >= 0; i-- {
				row := rows[i]
				result = append(result, map[string]any{
					"id": row.ID, "user_id": 1, "name": row.Name, "hash": row.Hash,
					"updated_at": "2026-11-16T12:00:00",
				})
			}
			_ = json.NewEncoder(w).Encode(result)
		default:
			w.WriteHeader(http.StatusMethodNotAllowed)
		}
	}))
	defer server.Close()
	settings := models.DefaultSettings()
	settings.AuthServer, settings.AuthToken = &server.URL, &token
	client := NewClient()
	ctx := context.Background()
	if got, err := client.PullProfiles(ctx, settings, password); err != nil || got != nil {
		t.Fatalf("empty account: got %v, error %v", got, err)
	}
	profiles := []models.Profile{
		{ID: "a", Name: "Private Helsinki", ConfigLink: "trojan://secret-credential@vpn.test:443", SubscriptionURL: "https://sub.test/secret-subscription", Favorite: true},
		{ID: "b", Name: "Other", ConfigLink: "trojan://other@vpn.test:443"},
	}
	if _, err := client.PushProfiles(ctx, settings, profiles, password); err != nil {
		t.Fatal(err)
	}
	// Another device, without a cached key, can restore all profile metadata.
	got, err := NewClient().PullProfiles(ctx, settings, password)
	if err != nil || !reflect.DeepEqual(got, profiles) {
		t.Fatalf("round trip: got %+v, error %v", got, err)
	}
	if got, err := client.PullProfiles(ctx, settings, "wrong password"); !errors.Is(err, errSyncAuthentication) || got != nil {
		t.Fatalf("wrong password returned data: %+v, %v", got, err)
	}
	profiles = profiles[:1]
	if _, err := client.PushProfiles(ctx, settings, profiles, password); err != nil {
		t.Fatal(err)
	}
	got, err = client.PullProfiles(ctx, settings, password)
	if err != nil || !reflect.DeepEqual(got, profiles) {
		t.Fatalf("latest snapshot revived old profiles: %+v, %v", got, err)
	}
	if _, err := client.PushProfiles(ctx, settings, nil, password); err != nil {
		t.Fatal(err)
	}
	if got, err := client.PullProfiles(ctx, settings, password); err != nil || got == nil || len(got) != 0 {
		t.Fatalf("explicitly empty snapshot: %+v, %v", got, err)
	}
	mu.Lock()
	rows = append(rows, serverProfile{ID: 4, Hash: "damaged latest snapshot"})
	mu.Unlock()
	if got, err := client.PullProfiles(ctx, settings, password); err == nil || got != nil {
		t.Fatalf("damaged latest data fell back to an older snapshot: %+v, %v", got, err)
	}
}

func TestSyncRequiresPasswordBeforeSendingData(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("network request made without an encryption password")
	}))
	defer server.Close()
	token := "token"
	settings := models.DefaultSettings()
	settings.AuthServer, settings.AuthToken = &server.URL, &token
	client := NewClient()
	if _, err := client.PushProfiles(context.Background(), settings, nil, ""); !errors.Is(err, errSyncPasswordRequired) {
		t.Fatal(err)
	}
	if _, err := client.PullProfiles(context.Background(), settings, ""); !errors.Is(err, errSyncPasswordRequired) {
		t.Fatal(err)
	}
}

package storage

import (
	"bytes"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/Rigby-Foundation/Kage/internal/models"
)

func TestProfileEncryptionRoundTrip(t *testing.T) {
	path := filepath.Join(t.TempDir(), "profiles.json")
	profiles := []models.Profile{{
		ID: "id", Name: "Private server", ConfigLink: "vless://example-secret",
		SubscriptionURL: "https://example.test/subscription-secret",
	}}
	write := func(path string, data []byte) {
		t.Helper()
		if err := os.WriteFile(path, data, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	read := func() []byte {
		t.Helper()
		data, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		return data
	}
	plain, err := json.Marshal(profiles)
	if err != nil {
		t.Fatal(err)
	}
	write(path, plain)
	temporary := filepath.Join(filepath.Dir(path), ".profiles.json.kage-write-18472")
	write(temporary, plain)
	write(path+".20261116", plain)
	store, loaded := OpenProfiles(path)
	if !reflect.DeepEqual(loaded, profiles) || store.Status().Enabled {
		t.Fatal("legacy profile array failed to load")
	}
	password := []byte("test master password")
	if err := store.Enable(password, "standard", loaded); err != nil {
		t.Fatal(err)
	}
	first := read()
	if bytes.Contains(first, []byte("example-secret")) || bytes.Contains(first, []byte("subscription-secret")) || bytes.Contains(first, password) {
		t.Fatal("encrypted file contains a secret in plaintext")
	}
	if _, err := os.Stat(temporary); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("old temporary plaintext copy remains: %v", err)
	}
	if _, err := os.Stat(path + ".20261116"); err != nil {
		t.Fatalf("a separate export was touched: %v", err)
	}
	original, err := parseSealedProfiles(first)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Save(profiles); err != nil {
		t.Fatal(err)
	}
	second := read()
	rewritten, err := parseSealedProfiles(second)
	if err != nil || bytes.Equal(original.Nonce, rewritten.Nonce) || !bytes.Equal(original.Salt, rewritten.Salt) {
		t.Fatal("save did not preserve the salt and generate a fresh nonce")
	}
	store.Close()

	write(temporary, plain)
	locked, loaded := OpenProfiles(path)
	if status := locked.Status(); !status.Enabled || !status.Locked || status.Unavailable || len(loaded) != 0 {
		t.Fatalf("protected profiles were exposed at startup: %+v", status)
	}
	if _, err := os.Stat(temporary); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("interrupted plaintext write survived a restart: %v", err)
	}
	if err := locked.Save(nil); !errors.Is(err, ErrProfilesLocked) {
		t.Fatalf("locked store accepted a write: %v", err)
	}
	if _, err := locked.Unlock([]byte("wrong")); !errors.Is(err, ErrProfileAuthentication) {
		t.Fatalf("unexpected wrong-password result: %v", err)
	}
	if !bytes.Equal(second, read()) || !locked.Status().Locked {
		t.Fatal("a locked write or failed unlock changed the store")
	}

	tampered := rewritten
	tampered.Ciphertext[0] ^= 1
	bad, err := json.Marshal(tampered)
	if err != nil {
		t.Fatal(err)
	}
	write(path, bad)
	if _, err := locked.Unlock(password); !errors.Is(err, ErrProfileAuthentication) {
		t.Fatalf("tampered ciphertext was accepted: %v", err)
	}
	tampered.Cost.MemoryKiB = ^uint32(0)
	bad, err = json.Marshal(tampered)
	if err != nil {
		t.Fatal(err)
	}
	write(path, bad)
	unavailable, _ := OpenProfiles(path)
	if !unavailable.Status().Unavailable || !errors.Is(unavailable.Save(profiles), ErrProfilesUnavailable) {
		t.Fatal("out-of-bounds KDF settings did not fail closed")
	}

	write(path, second)
	loaded, err = locked.Unlock(password)
	if err != nil || !reflect.DeepEqual(loaded, profiles) {
		t.Fatalf("unlock did not restore profiles: %v", err)
	}
	if err := locked.Disable([]byte("wrong"), loaded); !errors.Is(err, ErrProfileAuthentication) || !bytes.Equal(second, read()) {
		t.Fatalf("incorrect password changed profile encryption: %v", err)
	}
	if err := locked.Disable(password, loaded); err != nil {
		t.Fatal(err)
	}
	store, loaded = OpenProfiles(path)
	if store.Status().Enabled || !reflect.DeepEqual(loaded, profiles) {
		t.Fatal("turning off encryption lost existing profiles")
	}
}

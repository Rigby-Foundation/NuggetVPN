package remote

import (
	"bytes"
	"encoding/json"
	"testing"

	"github.com/Rigby-Foundation/Kage/internal/models"
)

func TestSyncUsesFreshSaltAndNonceAndAuthenticatesMetadata(t *testing.T) {
	profiles := []models.Profile{{ID: "a", ConfigLink: "trojan://secret@vpn.test:443"}}
	first, err := sealSyncProfiles(profiles, "password")
	if err != nil {
		t.Fatal(err)
	}
	second, err := sealSyncProfiles(profiles, "password")
	if err != nil {
		t.Fatal(err)
	}
	var a, b syncEnvelope
	_ = json.Unmarshal([]byte(first), &a)
	_ = json.Unmarshal([]byte(second), &b)
	if bytes.Equal(a.Salt, b.Salt) || bytes.Equal(a.Nonce, b.Nonce) || bytes.Equal(a.Ciphertext, b.Ciphertext) {
		t.Fatal("repeated upload reused encryption randomness")
	}
	for name, mutate := range map[string]func(*syncEnvelope){
		"salt":             func(e *syncEnvelope) { e.Salt[0] ^= 1 },
		"nonce":            func(e *syncEnvelope) { e.Nonce[0] ^= 1 },
		"ciphertext":       func(e *syncEnvelope) { e.Ciphertext[0] ^= 1 },
		"version":          func(e *syncEnvelope) { e.Version++ },
		"format":           func(e *syncEnvelope) { e.Format = "kage.profiles" },
		"cipher":           func(e *syncEnvelope) { e.Cipher = "json" },
		"unbounded memory": func(e *syncEnvelope) { e.KDF.MemoryKiB = ^uint32(0) },
		"zero passes":      func(e *syncEnvelope) { e.KDF.Passes = 0 },
		"short nonce":      func(e *syncEnvelope) { e.Nonce = e.Nonce[:12] },
		"short salt":       func(e *syncEnvelope) { e.Salt = nil },
		"short ciphertext": func(e *syncEnvelope) { e.Ciphertext = nil },
	} {
		t.Run(name, func(t *testing.T) {
			var damaged syncEnvelope
			_ = json.Unmarshal([]byte(first), &damaged)
			mutate(&damaged)
			data, _ := json.Marshal(damaged)
			if got, err := openSyncProfiles(string(data), "password"); err == nil || got != nil {
				t.Fatal("accepted unauthenticated or unsupported data")
			}
		})
	}
}

func TestSyncRejectsInvalidProfilesAndPlaintext(t *testing.T) {
	for _, profiles := range [][]models.Profile{
		{{ConfigLink: "vless://test"}},
		{{ID: "a"}},
		{{ID: "a", ConfigLink: "vless://one"}, {ID: "a", ConfigLink: "vless://two"}},
	} {
		if _, err := sealSyncProfiles(profiles, "password"); err == nil {
			t.Fatal("accepted invalid snapshot")
		}
	}
	if got, err := openSyncProfiles(`{"id":"a","config_link":"vless://plaintext"}`, "password"); err == nil || got != nil {
		t.Fatal("accepted plaintext as an encrypted sync snapshot")
	}
}

package remote

import (
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"

	"golang.org/x/crypto/argon2"
	"golang.org/x/crypto/chacha20poly1305"

	"github.com/Rigby-Foundation/NuggetVPN/internal/models"
)

const (
	syncCipher       = "XChaCha20-Poly1305"
	maxSyncPlaintext = 1 << 20
)

var (
	errSyncPasswordRequired = errors.New("enter your sync encryption password")
	errSyncAuthentication   = errors.New("could not decrypt sync data: the encryption password is incorrect or the saved data has been changed")
)

type syncKDF struct {
	Name      string `json:"name"`
	MemoryKiB uint32 `json:"memory_kib"`
	Passes    uint32 `json:"passes"`
	Threads   uint8  `json:"threads"`
}

var syncCost = syncKDF{Name: "Argon2id", MemoryKiB: 64 * 1024, Passes: 3, Threads: 4}

type syncHeader struct {
	Format  string  `json:"format"`
	Version int     `json:"version"`
	Cipher  string  `json:"cipher"`
	KDF     syncKDF `json:"kdf"`
	Salt    []byte  `json:"salt"`
}

type syncEnvelope struct {
	syncHeader
	Nonce      []byte `json:"nonce"`
	Ciphertext []byte `json:"ciphertext"`
}

type syncSnapshot struct {
	Profiles []models.Profile `json:"profiles"`
}

func syncAAD(header syncHeader) []byte {
	data, _ := json.Marshal(header)
	return append([]byte("Kage sync snapshot\x00"), data...)
}

func syncKey(password string, header syncHeader) []byte {
	secret := []byte(password)
	defer clear(secret)
	cost := header.KDF
	return argon2.IDKey(secret, header.Salt, cost.Passes, cost.MemoryKiB, cost.Threads, chacha20poly1305.KeySize)
}

func sealSyncProfiles(profiles []models.Profile, password string) (string, error) {
	if password == "" {
		return "", errSyncPasswordRequired
	}
	if profiles == nil {
		profiles = []models.Profile{}
	}
	if err := validateSyncProfiles(profiles); err != nil {
		return "", err
	}
	plain, err := json.Marshal(syncSnapshot{Profiles: profiles})
	if err != nil {
		return "", err
	}
	defer clear(plain)
	if len(plain) > maxSyncPlaintext {
		return "", fmt.Errorf("profiles exceed the 1 MiB sync snapshot limit")
	}
	envelope := syncEnvelope{
		syncHeader: syncHeader{Format: "kage.sync", Version: 1, Cipher: syncCipher, KDF: syncCost, Salt: make([]byte, 16)},
		Nonce:      make([]byte, chacha20poly1305.NonceSizeX),
	}
	if _, err := rand.Read(envelope.Salt); err != nil {
		return "", err
	}
	if _, err := rand.Read(envelope.Nonce); err != nil {
		return "", err
	}
	key := syncKey(password, envelope.syncHeader)
	defer clear(key)
	aead, err := chacha20poly1305.NewX(key)
	if err != nil {
		return "", err
	}
	envelope.Ciphertext = aead.Seal(nil, envelope.Nonce, plain, syncAAD(envelope.syncHeader))
	encoded, err := json.Marshal(envelope)
	return string(encoded), err
}

func openSyncProfiles(encoded, password string) ([]models.Profile, error) {
	if password == "" {
		return nil, errSyncPasswordRequired
	}
	// Base64 plus metadata fits below twice the plaintext limit. Bound this
	// before decoding, and validate the fixed KDF cost before allocating it.
	if len(encoded) > 2*maxSyncPlaintext {
		return nil, fmt.Errorf("encrypted sync snapshot is too large")
	}
	var envelope syncEnvelope
	if err := json.Unmarshal([]byte(encoded), &envelope); err != nil ||
		envelope.Format != "kage.sync" || envelope.Version != 1 || envelope.Cipher != syncCipher ||
		envelope.KDF != syncCost || len(envelope.Salt) != 16 ||
		len(envelope.Nonce) != chacha20poly1305.NonceSizeX ||
		len(envelope.Ciphertext) < chacha20poly1305.Overhead ||
		len(envelope.Ciphertext) > maxSyncPlaintext+chacha20poly1305.Overhead {
		return nil, fmt.Errorf("unsupported or damaged encrypted sync snapshot")
	}
	key := syncKey(password, envelope.syncHeader)
	defer clear(key)
	aead, err := chacha20poly1305.NewX(key)
	if err != nil {
		return nil, err
	}
	plain, err := aead.Open(nil, envelope.Nonce, envelope.Ciphertext, syncAAD(envelope.syncHeader))
	if err != nil {
		return nil, errSyncAuthentication
	}
	defer clear(plain)
	var snapshot syncSnapshot
	if err := json.Unmarshal(plain, &snapshot); err != nil || snapshot.Profiles == nil {
		return nil, fmt.Errorf("invalid sync snapshot contents")
	}
	if err := validateSyncProfiles(snapshot.Profiles); err != nil {
		return nil, err
	}
	return snapshot.Profiles, nil
}

func validateSyncProfiles(profiles []models.Profile) error {
	seen := make(map[string]bool, len(profiles))
	for _, profile := range profiles {
		if profile.ID == "" || seen[profile.ID] || profile.ConfigLink == "" {
			return fmt.Errorf("sync snapshot contains an invalid or duplicate profile")
		}
		seen[profile.ID] = true
	}
	return nil
}

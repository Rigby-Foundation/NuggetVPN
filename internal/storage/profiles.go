package storage

import (
	"bytes"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"golang.org/x/crypto/argon2"
	"golang.org/x/crypto/chacha20poly1305"

	"github.com/Rigby-Foundation/Kage/internal/models"
)

const (
	profileFormat   = "kage.profiles"
	profileVersion  = 1
	profileSaltSize = 16
)

var (
	ErrProfilesLocked        = errors.New("unlock your saved profiles in Kage first")
	ErrProfilesUnavailable   = errors.New("the saved profile file could not be opened")
	ErrProfileAuthentication = errors.New("the password is incorrect or the encrypted profiles have been changed")
)

type ProfileEncryptionStatus struct {
	Enabled     bool `json:"enabled"`
	Locked      bool `json:"locked"`
	Unavailable bool `json:"unavailable"`
}

type argon2Cost struct {
	MemoryKiB uint32 `json:"memory_kib"`
	Passes    uint32 `json:"passes"`
	Threads   uint8  `json:"threads"`
}

var profileCosts = map[string]argon2Cost{
	// RFC 9106's memory-constrained recommendation.
	"standard": {MemoryKiB: 64 * 1024, Passes: 3, Threads: 4},
	"high":     {MemoryKiB: 128 * 1024, Passes: 4, Threads: 4},
}

type profileHeader struct {
	Format  string     `json:"format"`
	Version int        `json:"version"`
	Cost    argon2Cost `json:"argon2id"`
	Salt    []byte     `json:"salt"`
}

type sealedProfiles struct {
	profileHeader
	Nonce      []byte `json:"nonce"`
	Ciphertext []byte `json:"ciphertext"`
}

// ProfileStore owns one profile file. The caller serializes access to the store
// and the corresponding in-memory profiles. A protected store starts locked.
type ProfileStore struct {
	path        string
	encrypted   bool
	unavailable bool
	header      profileHeader
	key         []byte
}

func OpenProfiles(path string) (*ProfileStore, []models.Profile) {
	store := &ProfileStore{path: path}
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return store, nil
	}
	if err != nil {
		store.unavailable = true
		return store, nil
	}
	data = bytes.TrimSpace(data)
	if len(data) > 0 && data[0] == '{' {
		store.encrypted = true
		_, err := parseSealedProfiles(data)
		store.unavailable = err != nil || store.removeTemporaryCopies() != nil
		return store, nil
	}
	var profiles []models.Profile
	if err := json.Unmarshal(data, &profiles); err != nil {
		store.unavailable = true
		return store, nil
	}
	return store, profiles
}

func (s *ProfileStore) Status() ProfileEncryptionStatus {
	return ProfileEncryptionStatus{
		Enabled: s.encrypted, Locked: s.unavailable || (s.encrypted && s.key == nil),
		Unavailable: s.unavailable,
	}
}

func (s *ProfileStore) CheckAccess() error {
	if s == nil {
		return nil
	}
	if s.unavailable {
		return ErrProfilesUnavailable
	}
	if s.encrypted && s.key == nil {
		return ErrProfilesLocked
	}
	return nil
}

func parseSealedProfiles(data []byte) (sealedProfiles, error) {
	var file sealedProfiles
	if err := json.Unmarshal(data, &file); err != nil ||
		file.Format != profileFormat || file.Version != profileVersion ||
		len(file.Salt) != profileSaltSize || len(file.Nonce) != chacha20poly1305.NonceSizeX ||
		len(file.Ciphertext) < chacha20poly1305.Overhead {
		return sealedProfiles{}, ErrProfilesUnavailable
	}
	for _, cost := range profileCosts {
		if file.Cost == cost {
			return file, nil
		}
	}
	return sealedProfiles{}, ErrProfilesUnavailable
}

func deriveProfileKey(password []byte, header profileHeader) []byte {
	cost := header.Cost
	return argon2.IDKey(password, header.Salt, cost.Passes, cost.MemoryKiB, cost.Threads, chacha20poly1305.KeySize)
}

func (s *ProfileStore) verify(password []byte) (sealedProfiles, []byte, []models.Profile, error) {
	data, err := os.ReadFile(s.path)
	if err != nil {
		return sealedProfiles{}, nil, nil, ErrProfilesUnavailable
	}
	file, err := parseSealedProfiles(data)
	if err != nil {
		return sealedProfiles{}, nil, nil, err
	}
	key := deriveProfileKey(password, file.profileHeader)
	aead, err := chacha20poly1305.NewX(key)
	if err == nil {
		// Authenticate the format, version, and all key derivation metadata.
		header, _ := json.Marshal(file.profileHeader)
		plain, openErr := aead.Open(nil, file.Nonce, file.Ciphertext, header)
		defer clear(plain)
		if openErr == nil {
			var profiles []models.Profile
			if err := json.Unmarshal(plain, &profiles); err == nil {
				return file, key, profiles, nil
			}
		}
	}
	clear(key)
	return sealedProfiles{}, nil, nil, ErrProfileAuthentication
}

func (s *ProfileStore) Unlock(password []byte) ([]models.Profile, error) {
	if !s.encrypted {
		return nil, errors.New("profile encryption is off")
	}
	if s.key != nil {
		return nil, errors.New("profiles are already unlocked")
	}
	file, key, profiles, err := s.verify(password)
	if err != nil {
		return nil, err
	}
	s.header, s.key, s.unavailable = file.profileHeader, key, false
	return profiles, nil
}

func (s *ProfileStore) Enable(password []byte, strength string, profiles []models.Profile) error {
	if err := s.CheckAccess(); err != nil {
		return err
	}
	if s.encrypted {
		return errors.New("profile encryption is already on")
	}
	cost, valid := profileCosts[strength]
	if !valid {
		return errors.New("invalid profile encryption strength")
	}
	if err := s.removeTemporaryCopies(); err != nil {
		return fmt.Errorf("clean up old profile writes: %w", err)
	}
	header := profileHeader{
		Format: profileFormat, Version: profileVersion, Cost: cost,
		Salt: make([]byte, profileSaltSize),
	}
	if _, err := rand.Read(header.Salt); err != nil {
		return err
	}
	key := deriveProfileKey(password, header)
	if err := s.writeEncrypted(header, key, profiles); err != nil {
		clear(key)
		return err
	}
	s.header, s.key, s.encrypted = header, key, true
	return nil
}

func (s *ProfileStore) removeTemporaryCopies() error {
	dir := filepath.Dir(s.path)
	entries, err := os.ReadDir(dir)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	prefix := s.temporaryPrefix()
	for _, entry := range entries {
		// Only clean up files created by the profile store's own writer.
		suffix, matches := strings.CutPrefix(entry.Name(), prefix)
		if !matches || entry.IsDir() {
			continue
		}
		if _, err := strconv.ParseUint(suffix, 10, 64); err != nil {
			continue
		}
		if err := os.Remove(filepath.Join(dir, entry.Name())); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
	}
	return nil
}

func (s *ProfileStore) temporaryPrefix() string {
	return "." + filepath.Base(s.path) + ".kage-write-"
}

func (s *ProfileStore) Disable(password []byte, profiles []models.Profile) error {
	if err := s.CheckAccess(); err != nil {
		return err
	}
	if !s.encrypted {
		return errors.New("profile encryption is already off")
	}
	_, key, _, err := s.verify(password)
	if err != nil {
		return err
	}
	clear(key)
	if err := s.writePlain(profiles); err != nil {
		return err
	}
	s.Close()
	s.encrypted = false
	return nil
}

func (s *ProfileStore) Close() {
	if s == nil {
		return
	}
	clear(s.key)
	s.key = nil
	s.header = profileHeader{}
}

func (s *ProfileStore) Save(profiles []models.Profile) error {
	if s == nil {
		return ErrProfilesUnavailable
	}
	if err := s.CheckAccess(); err != nil {
		return err
	}
	if s.encrypted {
		return s.writeEncrypted(s.header, s.key, profiles)
	}
	return s.writePlain(profiles)
}

func profileJSON(profiles []models.Profile) ([]byte, error) {
	if profiles == nil {
		profiles = []models.Profile{}
	}
	return json.Marshal(profiles)
}

func (s *ProfileStore) writePlain(profiles []models.Profile) error {
	data, err := profileJSON(profiles)
	if err != nil {
		return err
	}
	return writeFileWithPattern(s.path, s.temporaryPrefix()+"*", data)
}

func (s *ProfileStore) writeEncrypted(header profileHeader, key []byte, profiles []models.Profile) error {
	plain, err := profileJSON(profiles)
	if err != nil {
		return err
	}
	defer clear(plain)
	aead, err := chacha20poly1305.NewX(key)
	if err != nil {
		return err
	}
	nonce := make([]byte, chacha20poly1305.NonceSizeX)
	if _, err := rand.Read(nonce); err != nil {
		return err
	}
	metadata, _ := json.Marshal(header)
	file := sealedProfiles{
		profileHeader: header, Nonce: nonce, Ciphertext: aead.Seal(nil, nonce, plain, metadata),
	}
	data, err := json.Marshal(file)
	if err != nil {
		return fmt.Errorf("encode encrypted profiles: %w", err)
	}
	return writeFileWithPattern(s.path, s.temporaryPrefix()+"*", data)
}

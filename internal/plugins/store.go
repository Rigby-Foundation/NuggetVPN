package plugins

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
)

// Limits on what a plugin file may hold. Generous for fonts and pictures,
// small enough that a hostile zip cannot fill the disk.
const (
	MaxFileSize   = 50 << 20
	maxEntry      = 25 << 20
	maxTotal      = 80 << 20
	maxFiles      = 500
	maxStorage    = 1 << 20
	maxStorageKey = 200
)

// filePattern is what a path inside a plugin may look like: plain relative
// names, no dot segments, no backslashes, nothing hidden.
var filePattern = regexp.MustCompile(`^[A-Za-z0-9_-][A-Za-z0-9._-]*(/[A-Za-z0-9_-][A-Za-z0-9._-]*)*$`)

// Package is a plugin read from its file, not yet installed.
type Package struct {
	Manifest Manifest
	Files    map[string][]byte
}

// Read opens a plugin file and checks everything in it.
func Read(data []byte) (*Package, error) {
	if len(data) > MaxFileSize {
		return nil, fmt.Errorf("the plugin is larger than %d MB", MaxFileSize>>20)
	}
	archive, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return nil, errors.New("that is not a NuggetVPN plugin")
	}
	if len(archive.File) > maxFiles {
		return nil, fmt.Errorf("the plugin has more than %d files", maxFiles)
	}
	files := map[string][]byte{}
	var total int64
	for _, entry := range archive.File {
		name := entry.Name
		if strings.HasSuffix(name, "/") {
			continue // a folder
		}
		if !entry.Mode().IsRegular() {
			return nil, fmt.Errorf("%q is not a plain file", name)
		}
		if !filePattern.MatchString(name) || strings.Contains(name, "..") {
			return nil, fmt.Errorf("the plugin has a file named %q, which is not allowed", name)
		}
		if _, dup := files[name]; dup {
			return nil, fmt.Errorf("the plugin has %q twice", name)
		}
		reader, err := entry.Open()
		if err != nil {
			return nil, err
		}
		// Read past the declared size, not up to it: the header can lie.
		content, err := io.ReadAll(io.LimitReader(reader, maxEntry+1))
		reader.Close()
		if err != nil {
			return nil, fmt.Errorf("%s: %w", name, err)
		}
		if len(content) > maxEntry {
			return nil, fmt.Errorf("%s is larger than %d MB", name, maxEntry>>20)
		}
		total += int64(len(content))
		if total > maxTotal {
			return nil, fmt.Errorf("the plugin unpacks to more than %d MB", maxTotal>>20)
		}
		files[name] = content
	}
	manifestData, ok := files[ManifestName]
	if !ok {
		return nil, errors.New("that is not a NuggetVPN plugin: there is no plugin.json")
	}
	present := make(map[string]bool, len(files))
	for name := range files {
		present[name] = true
	}
	manifest, err := ParseManifest(manifestData, present)
	if err != nil {
		return nil, err
	}
	return &Package{Manifest: manifest, Files: files}, nil
}

// State is what the app records about an installed plugin.
type State struct {
	Enabled bool `json:"enabled"`
	// Granted are the permissions the user allowed. A plugin update asking
	// for more has to be allowed again.
	Granted []string `json:"granted"`
}

// Installed is an installed plugin.
type Installed struct {
	Manifest Manifest
	State    State
}

// Store keeps the installed plugins under one directory:
//
//	<dir>/<id>/...          the plugin's files
//	<dir>/state.json        enabled and granted, by id
//	<dir>/data/<id>.json    what the plugin stored for itself
type Store struct {
	dir string
	mu  sync.Mutex
}

// NewStore opens the store at dir.
func NewStore(dir string) *Store {
	return &Store{dir: dir}
}

// Dir is the store's directory.
func (s *Store) Dir() string { return s.dir }

func (s *Store) statePath() string { return filepath.Join(s.dir, "state.json") }

func (s *Store) readState() map[string]State {
	states := map[string]State{}
	data, err := os.ReadFile(s.statePath())
	if err == nil {
		_ = json.Unmarshal(data, &states)
	}
	return states
}

func (s *Store) writeState(states map[string]State) error {
	if err := os.MkdirAll(s.dir, 0o755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(states, "", "  ")
	if err != nil {
		return err
	}
	return writeFileAtomic(s.statePath(), data)
}

// pluginDir is where a plugin's files are. id has been checked by
// ParseManifest or Valid before it gets here.
func (s *Store) pluginDir(id string) string {
	return filepath.Join(s.dir, "installed", id)
}

// Valid reports whether id could name a plugin, for ids arriving from the
// window.
func Valid(id string) bool {
	return idPattern.MatchString(id) && !strings.Contains(id, "..")
}

// List returns the installed plugins, by name.
func (s *Store) List() []Installed {
	s.mu.Lock()
	defer s.mu.Unlock()
	states := s.readState()
	entries, _ := os.ReadDir(filepath.Join(s.dir, "installed"))
	var result []Installed
	for _, entry := range entries {
		if !entry.IsDir() || !Valid(entry.Name()) {
			continue
		}
		manifest, err := s.readManifest(entry.Name())
		if err != nil {
			continue
		}
		state, ok := states[manifest.ID]
		if !ok {
			continue // half installed, or removed from the record
		}
		result = append(result, Installed{Manifest: manifest, State: state})
	}
	sort.Slice(result, func(a, b int) bool {
		return strings.ToLower(result[a].Manifest.Name) < strings.ToLower(result[b].Manifest.Name)
	})
	return result
}

// Get returns one installed plugin.
func (s *Store) Get(id string) (Installed, bool) {
	for _, plugin := range s.List() {
		if plugin.Manifest.ID == id {
			return plugin, true
		}
	}
	return Installed{}, false
}

// readManifest re-reads an installed plugin's manifest, checking it again
// against the files actually on disk.
func (s *Store) readManifest(id string) (Manifest, error) {
	dir := s.pluginDir(id)
	data, err := os.ReadFile(filepath.Join(dir, ManifestName))
	if err != nil {
		return Manifest{}, err
	}
	present := map[string]bool{}
	_ = filepath.WalkDir(dir, func(file string, entry os.DirEntry, err error) error {
		if err == nil && entry.Type().IsRegular() {
			if relative, err := filepath.Rel(dir, file); err == nil {
				present[filepath.ToSlash(relative)] = true
			}
		}
		return nil
	})
	manifest, err := ParseManifest(data, present)
	if err != nil {
		return manifest, err
	}
	if manifest.ID != id {
		return manifest, errors.New("the plugin's folder does not match its id")
	}
	return manifest, nil
}

// Install puts a plugin in place, replacing an older version, with the
// permissions it asks for granted and itself turned on.
func (s *Store) Install(pkg *Package) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	id := pkg.Manifest.ID
	staging := filepath.Join(s.dir, "staging", id)
	_ = os.RemoveAll(staging)
	for name, content := range pkg.Files {
		target := filepath.Join(staging, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return err
		}
		if err := os.WriteFile(target, content, 0o644); err != nil {
			return err
		}
	}
	final := s.pluginDir(id)
	if err := os.MkdirAll(filepath.Dir(final), 0o755); err != nil {
		return err
	}
	old := final + ".old"
	_ = os.RemoveAll(old)
	if _, err := os.Stat(final); err == nil {
		if err := os.Rename(final, old); err != nil {
			return err
		}
	}
	if err := os.Rename(staging, final); err != nil {
		_ = os.Rename(old, final)
		return err
	}
	_ = os.RemoveAll(old)

	states := s.readState()
	states[id] = State{Enabled: true, Granted: append([]string{}, pkg.Manifest.Permissions...)}
	return s.writeState(states)
}

// Remove uninstalls a plugin and deletes what it stored.
func (s *Store) Remove(id string) error {
	if !Valid(id) {
		return errors.New("not a plugin id")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	states := s.readState()
	delete(states, id)
	if err := s.writeState(states); err != nil {
		return err
	}
	_ = os.Remove(s.dataPath(id))
	return os.RemoveAll(s.pluginDir(id))
}

// SetEnabled turns a plugin on or off.
func (s *Store) SetEnabled(id string, enabled bool) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	states := s.readState()
	state, ok := states[id]
	if !ok {
		return errors.New("that plugin is not installed")
	}
	state.Enabled = enabled
	states[id] = state
	return s.writeState(states)
}

// NewPermissions are the permissions pkg asks for that the installed
// version was not given; all of them for a new plugin.
func (s *Store) NewPermissions(pkg *Package) []string {
	s.mu.Lock()
	granted := s.readState()[pkg.Manifest.ID].Granted
	s.mu.Unlock()
	var added []string
	for _, permission := range pkg.Manifest.Permissions {
		had := false
		for _, existing := range granted {
			had = had || existing == permission
		}
		if !had {
			added = append(added, permission)
		}
	}
	return added
}

// ReadFile returns a file inside an installed plugin.
func (s *Store) ReadFile(id, name string) ([]byte, error) {
	if !Valid(id) || !filePattern.MatchString(name) || strings.Contains(name, "..") {
		return nil, os.ErrNotExist
	}
	return os.ReadFile(filepath.Join(s.pluginDir(id), filepath.FromSlash(name)))
}

// ---------------------------------------------------------------------------
// A plugin's own storage
// ---------------------------------------------------------------------------

func (s *Store) dataPath(id string) string {
	return filepath.Join(s.dir, "data", id+".json")
}

func (s *Store) readData(id string) map[string]json.RawMessage {
	values := map[string]json.RawMessage{}
	if data, err := os.ReadFile(s.dataPath(id)); err == nil {
		_ = json.Unmarshal(data, &values)
	}
	return values
}

// GetValue returns what a plugin stored under key; null when nothing.
func (s *Store) GetValue(id, key string) (json.RawMessage, error) {
	if !Valid(id) {
		return nil, errors.New("not a plugin id")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if value, ok := s.readData(id)[key]; ok {
		return value, nil
	}
	return json.RawMessage("null"), nil
}

// SetValue stores a JSON value for a plugin; null deletes the key. A plugin
// gets a megabyte in all.
func (s *Store) SetValue(id, key string, value json.RawMessage) error {
	if !Valid(id) {
		return errors.New("not a plugin id")
	}
	if key == "" || len(key) > maxStorageKey {
		return errors.New("a storage key must be 1 to 200 characters")
	}
	if !json.Valid(value) {
		return errors.New("storage values must be JSON")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	values := s.readData(id)
	if string(bytes.TrimSpace(value)) == "null" {
		delete(values, key)
	} else {
		values[key] = value
	}
	data, err := json.Marshal(values)
	if err != nil {
		return err
	}
	if len(data) > maxStorage {
		return fmt.Errorf("a plugin can store at most %d KB", maxStorage>>10)
	}
	if err := os.MkdirAll(filepath.Dir(s.dataPath(id)), 0o755); err != nil {
		return err
	}
	return writeFileAtomic(s.dataPath(id), data)
}

func writeFileAtomic(target string, data []byte) error {
	temporary := target + ".tmp"
	if err := os.WriteFile(temporary, data, 0o644); err != nil {
		return err
	}
	return os.Rename(temporary, target)
}

// contentType is what a plugin file is served as, by extension. Anything not
// listed is refused rather than guessed at.
func contentType(name string) (string, bool) {
	types := map[string]string{
		".html":  "text/html; charset=utf-8",
		".js":    "text/javascript; charset=utf-8",
		".mjs":   "text/javascript; charset=utf-8",
		".css":   "text/css; charset=utf-8",
		".json":  "application/json",
		".svg":   "image/svg+xml",
		".png":   "image/png",
		".jpg":   "image/jpeg",
		".jpeg":  "image/jpeg",
		".webp":  "image/webp",
		".gif":   "image/gif",
		".ttf":   "font/ttf",
		".otf":   "font/otf",
		".woff":  "font/woff",
		".woff2": "font/woff2",
		".txt":   "text/plain; charset=utf-8",
	}
	value, ok := types[strings.ToLower(path.Ext(name))]
	return value, ok
}

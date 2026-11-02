package plugins

import (
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// Checksum hashes all paths and bytes in a stable, unambiguous order. ZIP
// metadata and executable permission bits do not affect package identity.
func (p *Package) Checksum() string {
	names := make([]string, 0, len(p.Files))
	for name := range p.Files {
		names = append(names, name)
	}
	sort.Strings(names)
	hash := sha256.New()
	_, _ = io.WriteString(hash, "nuggetplugin-sha256-v1\x00")
	for _, name := range names {
		_ = binary.Write(hash, binary.BigEndian, uint64(len(name)))
		_, _ = io.WriteString(hash, name)
		_ = binary.Write(hash, binary.BigEndian, uint64(len(p.Files[name])))
		_, _ = hash.Write(p.Files[name])
	}
	return hex.EncodeToString(hash.Sum(nil))
}

// readPackage snapshots the entire installed tree, rejecting links and special
// files. Reads are rooted so a concurrent path replacement cannot escape it.
// Caller holds s.mu.
func (s *Store) readPackage(id string) (*Package, error) {
	if !Valid(id) {
		return nil, errors.New("not a plugin id")
	}
	dir := s.pluginDir(id)
	info, err := os.Lstat(dir)
	if err != nil {
		return nil, err
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return nil, errors.New("the plugin folder is not a directory")
	}
	root, err := os.OpenRoot(dir)
	if err != nil {
		return nil, err
	}
	defer root.Close()
	files := map[string][]byte{}
	var total int
	err = filepath.WalkDir(dir, func(file string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() {
			return nil
		}
		name, err := filepath.Rel(dir, file)
		if err != nil {
			return err
		}
		name = filepath.ToSlash(name)
		if !entry.Type().IsRegular() || !filePattern.MatchString(name) || strings.Contains(name, "..") {
			return fmt.Errorf("unsafe plugin file %q", name)
		}
		if len(files) >= maxFiles {
			return errors.New("too many plugin files")
		}
		f, err := root.Open(name)
		if err != nil {
			return err
		}
		info, err := f.Stat()
		if err != nil || !info.Mode().IsRegular() {
			f.Close()
			return errors.New("not a regular plugin file")
		}
		content, err := io.ReadAll(io.LimitReader(f, maxEntry+1))
		f.Close()
		if err != nil {
			return err
		}
		total += len(content)
		if len(content) > maxEntry || total > maxTotal {
			return errors.New("plugin exceeds size limits")
		}
		files[name] = content
		return nil
	})
	if err != nil {
		return nil, err
	}
	present := map[string]bool{}
	for name := range files {
		present[name] = true
	}
	manifest, err := ParseManifest(files[ManifestName], present)
	if err != nil {
		return nil, err
	}
	if manifest.ID != id {
		return nil, errors.New("the plugin's folder does not match its id")
	}
	return &Package{Manifest: manifest, Files: files}, nil
}

// Snapshot is for review only. It does not approve or execute anything.
func (s *Store) Snapshot(id string) (*Package, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.readState()[id]; !ok {
		return nil, errors.New("plugin is not installed")
	}
	return s.readPackage(id)
}

// VerifiedPackage returns the exact bytes checked, so callers need not reopen
// unverified files after checking their checksum.
func (s *Store) VerifiedPackage(id string) (*Package, error) {
	// Get also performs first-load migration and persists sticky revocation.
	plugin, ok := s.Get(id)
	if !ok || !plugin.State.Enabled || plugin.State.ApprovalRequired {
		return nil, errors.New("plugin is disabled or needs checksum approval")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	state, ok := s.readState()[id]
	if !ok || !state.Enabled || state.ApprovalRequired {
		return nil, errors.New("plugin is disabled or needs checksum approval")
	}
	pkg, err := s.readPackage(id)
	if err != nil || pkg.Checksum() != state.Checksum {
		states := s.readState()
		state.Enabled, state.ApprovalRequired = false, true
		states[id] = state
		_ = s.writeState(states)
		return nil, errors.New("plugin checksum changed; approval required")
	}
	return pkg, nil
}

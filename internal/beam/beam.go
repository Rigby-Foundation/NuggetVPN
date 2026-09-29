// Package beam reads the data a Beam installation left on this machine, so a
// first start can carry it across instead of making the user re-add everything.
//
// Beam keeps three things in its data directory:
//
//	settings.json        plain JSON, PascalCase keys, "SchemaVersion": 2
//	state.json           {"activeId": "<profile file id>"}
//	profiles/<id>.beam   one per subscription or manual profile
//
// A .beam file is the ASCII magic "BEAM", one format-version byte, then the
// profile as gzipped JSON. Each profile holds its subscription URL alongside
// the nodes Beam last fetched, and each node carries a ready sing-box outbound
// — which is what NuggetVPN stores as a profile's link anyway, so a node comes
// across verbatim rather than through a lossy conversion to a share link.
//
// Everything here only reads. Beam's files are never modified or removed, so
// the user can go back to it, and a failed migration costs nothing.
package beam

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
)

// Dir returns where Beam keeps its data on this platform.
func Dir() string {
	return dirFor(runtime.GOOS, os.Getenv, os.UserHomeDir)
}

func dirFor(goos string, getenv func(string) string, home func() (string, error)) string {
	base, err := home()
	if err != nil {
		base = "."
	}
	switch goos {
	case "darwin":
		return filepath.Join(base, "Library", "Application Support", "Beam")
	case "windows":
		if appData := getenv("APPDATA"); appData != "" {
			return filepath.Join(appData, "Beam")
		}
		return filepath.Join(base, "AppData", "Roaming", "Beam")
	default:
		// Not confirmed against a Linux install: this is where a desktop app
		// following the XDG spec would put it. If it is wrong, the only effect
		// is that no migration is offered.
		if xdg := getenv("XDG_CONFIG_HOME"); xdg != "" {
			return filepath.Join(xdg, "Beam")
		}
		return filepath.Join(base, ".config", "Beam")
	}
}

// Data is everything read from one Beam installation.
type Data struct {
	Dir      string
	Settings *Settings
	// ActiveID is the profile file Beam had selected, if any.
	ActiveID string
	Profiles []Profile
	// Unreadable lists profile files that could not be decoded, by file name,
	// so the UI can say what was left behind instead of silently dropping it.
	Unreadable []string
}

// Settings is the subset of Beam's settings.json that has an equivalent here.
type Settings struct {
	SchemaVersion int `json:"SchemaVersion"`
	Connection    struct {
		MTU        int    `json:"MTU"`
		PrimaryDNS string `json:"PrimaryDNS"`
	} `json:"Connection"`
	Appearance struct {
		Theme     string `json:"Theme"`
		Font      string `json:"Font"`
		Radius    string `json:"Radius"`
		Animation string `json:"Animation"`
	} `json:"Appearance"`
	SplitTunnel struct {
		Enabled bool              `json:"enabled"`
		Mode    string            `json:"mode"`
		Apps    []json.RawMessage `json:"apps"`
		Domains []string          `json:"domains"`
		IPs     []string          `json:"ips"`
	} `json:"SplitTunnel"`
	RoutingMode string `json:"RoutingMode"`
	ProTunGraph struct {
		Nodes []json.RawMessage `json:"nodes"`
		Edges []json.RawMessage `json:"edges"`
	} `json:"ProTunGraph"`
	HappCompat struct {
		Enabled          bool   `json:"Enabled"`
		UserAgentVersion string `json:"UserAgentVersion"`
		HWIDMode         string `json:"HWIDMode"`
		HWID             string `json:"HWID"`
	} `json:"HappCompat"`
}

// Profile is one decoded .beam file.
type Profile struct {
	// FileID is the file name without its extension; state.json refers to
	// profiles by it.
	FileID string `json:"-"`

	Version    int    `json:"version"`
	Name       string `json:"name"`
	Provider   string `json:"provider"`
	URL        string `json:"url"`
	ExpiresAt  int64  `json:"expiresAt"`
	DataLimit  int64  `json:"dataLimit"`
	DataUsed   int64  `json:"dataUsed"`
	Nodes      []Node `json:"nodes"`
	SelectedID string `json:"selectedId"`
}

// Node is one server inside a profile.
type Node struct {
	ID       string         `json:"id"`
	Name     string         `json:"name"`
	Type     string         `json:"type"`
	Outbound map[string]any `json:"outbound"`
}

// ErrNotFound means there is no Beam installation to migrate from.
var ErrNotFound = errors.New("no Beam data found")

// Load reads a Beam data directory.
//
// A missing settings.json or state.json is not an error — only having nothing
// at all is. One corrupt profile file does not stop the others from loading.
func Load(dir string) (*Data, error) {
	data := &Data{Dir: dir}

	if raw, err := os.ReadFile(filepath.Join(dir, "settings.json")); err == nil {
		var settings Settings
		if err := json.Unmarshal(raw, &settings); err == nil {
			data.Settings = &settings
		}
	}

	if raw, err := os.ReadFile(filepath.Join(dir, "state.json")); err == nil {
		var state struct {
			ActiveID string `json:"activeId"`
		}
		if json.Unmarshal(raw, &state) == nil {
			data.ActiveID = strings.TrimSpace(state.ActiveID)
		}
	}

	paths, _ := filepath.Glob(filepath.Join(dir, "profiles", "*.beam"))
	sort.Strings(paths)
	for _, path := range paths {
		raw, err := os.ReadFile(path)
		if err != nil {
			data.Unreadable = append(data.Unreadable, filepath.Base(path))
			continue
		}
		profile, err := DecodeProfile(raw)
		if err != nil {
			data.Unreadable = append(data.Unreadable, filepath.Base(path))
			continue
		}
		profile.FileID = strings.TrimSuffix(filepath.Base(path), ".beam")
		data.Profiles = append(data.Profiles, *profile)
	}

	if data.Settings == nil && len(data.Profiles) == 0 && len(data.Unreadable) == 0 {
		return nil, ErrNotFound
	}
	return data, nil
}

// magic opens every .beam file.
var magic = []byte("BEAM")

// maxProfileSize bounds decompression. A real profile is a few kilobytes; the
// limit is there so a corrupt or hostile file cannot inflate without end.
const maxProfileSize = 16 << 20

// DecodeProfile decodes the contents of one .beam file.
//
// Only format 2 has been observed. Rather than guess at other versions from
// the version byte, the payload is identified by what it actually starts
// with: a gzip stream, or plain JSON. Anything else is refused by name, so an
// unknown future format shows up as "unreadable" rather than as garbage.
func DecodeProfile(raw []byte) (*Profile, error) {
	payload := raw
	version := -1
	if bytes.HasPrefix(raw, magic) {
		if len(raw) <= len(magic) {
			return nil, fmt.Errorf("truncated Beam profile")
		}
		version = int(raw[len(magic)])
		payload = raw[len(magic)+1:]
	}

	switch {
	case len(payload) >= 2 && payload[0] == 0x1f && payload[1] == 0x8b:
		reader, err := gzip.NewReader(bytes.NewReader(payload))
		if err != nil {
			return nil, fmt.Errorf("Beam profile: %w", err)
		}
		defer reader.Close()
		inflated, err := io.ReadAll(io.LimitReader(reader, maxProfileSize+1))
		if err != nil {
			return nil, fmt.Errorf("Beam profile: %w", err)
		}
		if len(inflated) > maxProfileSize {
			return nil, fmt.Errorf("Beam profile is implausibly large")
		}
		payload = inflated
	case len(bytes.TrimSpace(payload)) > 0 && bytes.TrimSpace(payload)[0] == '{':
		// Plain JSON; nothing to unwrap.
	default:
		return nil, fmt.Errorf("unsupported Beam profile format (version %d)", version)
	}

	var profile Profile
	if err := json.Unmarshal(payload, &profile); err != nil {
		return nil, fmt.Errorf("Beam profile: %w", err)
	}
	return &profile, nil
}

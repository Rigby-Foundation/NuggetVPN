// Package plugins reads, installs and serves plugins.
//
// A plugin is a .nuggetplugin file: a zip with a plugin.json manifest at its
// root. It can carry content the app already knows how to check — themes,
// fonts, routing setups — and a script: HTML pages the window runs in
// sandboxed frames, which reach the app only through a small message API and
// only for what the user allowed at install.
//
// Nothing from a plugin runs outside those frames, and nothing reaches the
// privileged core service: every change a plugin can ask for goes through the
// same paths, and the same checks, as the user doing it by hand.
package plugins

import (
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"path"
	"regexp"
	"strings"
)

// Extension is a plugin file's extension.
const Extension = ".nuggetplugin"

// ManifestName is the manifest's name inside the zip.
const ManifestName = "plugin.json"

// Format is the manifest format this build reads.
const Format = 1

// Permissions a plugin can ask for. Anything else is refused at install, so
// a plugin made for a newer app says so instead of silently losing a feature.
const (
	// PermState reads whether the tunnel is up, through which server, and
	// the traffic counters.
	PermState = "state"
	// PermConnections reads the open connections: hosts, programs, rules.
	PermConnections = "connections"
	// PermProfiles reads the server list: names, protocols, latency. Never
	// the links, which hold credentials.
	PermProfiles = "profiles"
	// PermControl connects, disconnects and switches server.
	PermControl = "control"
	// PermImport adds servers and subscriptions.
	PermImport = "import"
	// PermRouting adds routing rules, which are marked as the plugin's.
	PermRouting = "routing"
	// PermNotifications shows system notifications.
	PermNotifications = "notifications"
)

// KnownPermissions lists every permission, in the order the install prompt
// shows them.
var KnownPermissions = []string{
	PermState, PermConnections, PermProfiles, PermControl, PermImport, PermRouting, PermNotifications,
}

// Manifest is plugin.json.
type Manifest struct {
	Format      int    `json:"format"`
	ID          string `json:"id"`
	Name        string `json:"name"`
	Version     string `json:"version"`
	Author      string `json:"author,omitempty"`
	Description string `json:"description,omitempty"`
	// Homepage is shown, never fetched.
	Homepage string `json:"homepage,omitempty"`
	// Icon is a PNG, JPEG, WebP or SVG inside the plugin.
	Icon string `json:"icon,omitempty"`

	Themes  []Theme        `json:"themes,omitempty"`
	Fonts   []Font         `json:"fonts,omitempty"`
	Routing []RoutingSetup `json:"routing,omitempty"`

	// Panel is a page shown under Settings → Plugins.
	Panel *Panel `json:"panel,omitempty"`
	// Background is a page kept running, unseen, while the plugin is on.
	Background string `json:"background,omitempty"`

	Permissions []string `json:"permissions,omitempty"`
	// Network lists the hosts the plugin's pages may contact. Nothing else
	// is reachable from them.
	Network []string `json:"network,omitempty"`
}

// Theme is a custom theme, in the shape the theme editor makes.
type Theme struct {
	ID         string          `json:"id"`
	Name       string          `json:"name"`
	Mode       string          `json:"mode"`
	Background json.RawMessage `json:"background"`
	Accent     json.RawMessage `json:"accent"`
	// Image is a background picture inside the plugin, with its effects.
	Image *ThemeImage `json:"image,omitempty"`
}

// ThemeImage is a theme's picture and what is done to it.
type ThemeImage struct {
	File       string  `json:"file"`
	Blur       float64 `json:"blur"`
	Brightness float64 `json:"brightness"`
	Saturate   float64 `json:"saturate"`
	Dim        float64 `json:"dim"`
	Panel      float64 `json:"panel"`
}

// Font is a font file inside the plugin.
type Font struct {
	Name string `json:"name"`
	File string `json:"file"`
}

// RoutingSetup is a .vflow file inside the plugin, offered in Routing.
type RoutingSetup struct {
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
	File        string `json:"file"`
}

// Panel is a plugin's page in settings.
type Panel struct {
	Title string `json:"title"`
	File  string `json:"file"`
}

var (
	idPattern      = regexp.MustCompile(`^[a-z0-9][a-z0-9._-]{1,62}[a-z0-9]$`)
	versionPattern = regexp.MustCompile(`^[0-9A-Za-z.+-]{1,32}$`)
	hostPattern    = regexp.MustCompile(`^(\*\.)?[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+(:[0-9]{1,5})?$`)
)

// ParseManifest reads and checks a manifest. files holds every file in the
// plugin, so references to missing files are caught here.
func ParseManifest(data []byte, files map[string]bool) (Manifest, error) {
	var manifest Manifest
	decoder := json.NewDecoder(strings.NewReader(string(data)))
	if err := decoder.Decode(&manifest); err != nil {
		return manifest, fmt.Errorf("plugin.json: %w", err)
	}
	if manifest.Format != Format {
		return manifest, fmt.Errorf("plugin.json is format %d; this app reads format %d", manifest.Format, Format)
	}
	if !idPattern.MatchString(manifest.ID) || strings.Contains(manifest.ID, "..") {
		return manifest, fmt.Errorf("plugin id %q: use lowercase letters, digits, dots, dashes and underscores, like com.example.weather", manifest.ID)
	}
	manifest.Name = strings.TrimSpace(manifest.Name)
	if manifest.Name == "" || len([]rune(manifest.Name)) > 60 {
		return manifest, errors.New("the plugin needs a name of at most 60 characters")
	}
	if !versionPattern.MatchString(manifest.Version) {
		return manifest, fmt.Errorf("version %q is not a version", manifest.Version)
	}
	manifest.Author = clip(manifest.Author, 80)
	manifest.Description = clip(manifest.Description, 500)
	if manifest.Homepage != "" && !strings.HasPrefix(manifest.Homepage, "https://") {
		manifest.Homepage = ""
	}

	need := func(what, name string, extensions ...string) error {
		if !files[name] {
			return fmt.Errorf("%s %q is not in the plugin", what, name)
		}
		extension := strings.ToLower(path.Ext(name))
		for _, allowed := range extensions {
			if extension == allowed {
				return nil
			}
		}
		return fmt.Errorf("%s %q must be %s", what, name, strings.Join(extensions, ", "))
	}

	if manifest.Icon != "" {
		if err := need("icon", manifest.Icon, ".png", ".jpg", ".jpeg", ".webp", ".svg"); err != nil {
			return manifest, err
		}
	}
	themeIDs := map[string]bool{}
	for index := range manifest.Themes {
		theme := &manifest.Themes[index]
		theme.Name = clip(theme.Name, 60)
		if theme.ID == "" || !idPattern.MatchString(theme.ID) || themeIDs[theme.ID] {
			return manifest, fmt.Errorf("theme %q needs a unique id", theme.Name)
		}
		themeIDs[theme.ID] = true
		if theme.Mode != "light" && theme.Mode != "dark" {
			return manifest, fmt.Errorf("theme %q: mode must be light or dark", theme.Name)
		}
		if theme.Image != nil {
			if err := need("theme picture", theme.Image.File, ".png", ".jpg", ".jpeg", ".webp", ".gif"); err != nil {
				return manifest, err
			}
		}
	}
	for index := range manifest.Fonts {
		font := &manifest.Fonts[index]
		font.Name = clip(font.Name, 60)
		if font.Name == "" {
			return manifest, errors.New("every font needs a name")
		}
		if err := need("font", font.File, ".ttf", ".otf", ".woff", ".woff2"); err != nil {
			return manifest, err
		}
	}
	for index := range manifest.Routing {
		setup := &manifest.Routing[index]
		setup.Name = clip(setup.Name, 60)
		setup.Description = clip(setup.Description, 300)
		if setup.Name == "" {
			return manifest, errors.New("every routing setup needs a name")
		}
		if err := need("routing setup", setup.File, ".vflow"); err != nil {
			return manifest, err
		}
	}
	if manifest.Panel != nil {
		manifest.Panel.Title = clip(manifest.Panel.Title, 40)
		if manifest.Panel.Title == "" {
			manifest.Panel.Title = manifest.Name
		}
		if err := need("panel", manifest.Panel.File, ".html"); err != nil {
			return manifest, err
		}
	}
	if manifest.Background != "" {
		if err := need("background page", manifest.Background, ".html"); err != nil {
			return manifest, err
		}
	}

	seen := map[string]bool{}
	for _, permission := range manifest.Permissions {
		known := false
		for _, candidate := range KnownPermissions {
			known = known || candidate == permission
		}
		if !known {
			return manifest, fmt.Errorf("unknown permission %q; the plugin may need a newer NuggetVPN", permission)
		}
		seen[permission] = true
	}
	manifest.Permissions = manifest.Permissions[:0]
	for _, permission := range KnownPermissions {
		if seen[permission] {
			manifest.Permissions = append(manifest.Permissions, permission)
		}
	}
	for index, host := range manifest.Network {
		host = strings.ToLower(strings.TrimSpace(host))
		if !hostPattern.MatchString(host) || isLocal(host) {
			return manifest, fmt.Errorf("network host %q: give a public host name, like api.example.com", host)
		}
		manifest.Network[index] = host
	}
	if len(manifest.Network) > 0 && manifest.Panel == nil && manifest.Background == "" {
		return manifest, errors.New("network hosts are only for plugins with a page")
	}
	return manifest, nil
}

// HasScript reports whether the plugin runs any code.
func (m Manifest) HasScript() bool {
	return m.Panel != nil || m.Background != ""
}

// isLocal reports whether a host names this computer or the local network,
// which no plugin may reach: that is where the app and its core live.
func isLocal(host string) bool {
	name := strings.TrimPrefix(host, "*.")
	if hostOnly, _, err := net.SplitHostPort(name); err == nil {
		name = hostOnly
	}
	if ip := net.ParseIP(name); ip != nil {
		return true // addresses are refused outright; names only
	}
	for _, suffix := range []string{"localhost", ".local", ".lan", ".internal", ".home.arpa", "wails.localhost"} {
		if name == strings.TrimPrefix(suffix, ".") || strings.HasSuffix(name, suffix) {
			return true
		}
	}
	return false
}

func clip(text string, limit int) string {
	text = strings.TrimSpace(text)
	if runes := []rune(text); len(runes) > limit {
		return string(runes[:limit])
	}
	return text
}

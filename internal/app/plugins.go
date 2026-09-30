package app

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/wailsapp/wails/v3/pkg/services/notifications"

	"github.com/Rigby-Foundation/NuggetVPN/internal/models"
	"github.com/Rigby-Foundation/NuggetVPN/internal/plugins"
	"github.com/Rigby-Foundation/NuggetVPN/internal/storage"
)

// ---------------------------------------------------------------------------
// Plugins
// ---------------------------------------------------------------------------
//
// The window hosts plugins: it runs their pages in sandboxed frames and
// answers their calls, checking each against the permissions granted here.
// This side installs them, serves their files, keeps their storage, and
// checks permissions again for everything that changes something.

var (
	pluginStoreOnce sync.Once
	pluginStore     *plugins.Store
)

// pluginsStore is the one store, shared by the App and the file handler.
func pluginsStore() *plugins.Store {
	pluginStoreOnce.Do(func() {
		pluginStore = plugins.NewStore(filepath.Join(storage.DataDir(), "plugins"))
	})
	return pluginStore
}

// PluginFiles serves plugin files to the window and refuses runtime calls
// from anything but the window itself; see plugins.GuardRuntime. A function,
// not a method: every exported App method is callable from the window.
func PluginFiles(next http.Handler) http.Handler {
	return pluginsStore().Handler(next)
}

// PluginInfo is a plugin as the window sees it: its manifest with file names
// turned into URLs.
type PluginInfo struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Version     string   `json:"version"`
	Author      string   `json:"author,omitempty"`
	Description string   `json:"description,omitempty"`
	Homepage    string   `json:"homepage,omitempty"`
	Icon        string   `json:"icon,omitempty"`
	Enabled     bool     `json:"enabled"`
	Permissions []string `json:"permissions"`
	Network     []string `json:"network"`

	Themes  []PluginTheme   `json:"themes"`
	Fonts   []PluginFont    `json:"fonts"`
	Routing []PluginRouting `json:"routing"`
	// Panel and Background are page URLs; empty for none.
	Panel      string `json:"panel,omitempty"`
	PanelTitle string `json:"panel_title,omitempty"`
	Background string `json:"background,omitempty"`
}

// PluginTheme is a theme a plugin brings, in the theme editor's shape.
type PluginTheme struct {
	ID         string          `json:"id"`
	Name       string          `json:"name"`
	Mode       string          `json:"mode"`
	Background json.RawMessage `json:"background"`
	Accent     json.RawMessage `json:"accent"`
	Image      *PluginImage    `json:"image,omitempty"`
}

// PluginImage is a theme picture, with its URL.
type PluginImage struct {
	URL        string  `json:"url"`
	Blur       float64 `json:"blur"`
	Brightness float64 `json:"brightness"`
	Saturate   float64 `json:"saturate"`
	Dim        float64 `json:"dim"`
	Panel      float64 `json:"panel"`
}

// PluginFont is a font a plugin brings.
type PluginFont struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	URL  string `json:"url"`
}

// PluginRouting is a routing setup a plugin brings.
type PluginRouting struct {
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
	File        string `json:"file"`
}

// PluginPreview is a plugin file read but not installed yet: what the
// install prompt shows.
type PluginPreview struct {
	// Token installs it; empty when the dialog was cancelled.
	Token  string     `json:"token"`
	Plugin PluginInfo `json:"plugin"`
	// Installed is the version already installed; empty for a new plugin.
	Installed string `json:"installed,omitempty"`
	// NewPermissions are the ones the user has not allowed before.
	NewPermissions []string `json:"new_permissions"`
	HasScript      bool     `json:"has_script"`
}

// pendingPlugin is a read plugin waiting for the user to allow it.
type pendingPlugin struct {
	pkg     *plugins.Package
	expires time.Time
}

var (
	pendingPluginsMu sync.Mutex
	pendingPlugins   = map[string]pendingPlugin{}
)

func pluginInfo(manifest plugins.Manifest, state plugins.State) PluginInfo {
	url := func(name string) string {
		if name == "" {
			return ""
		}
		return plugins.Prefix + manifest.ID + "/" + name
	}
	info := PluginInfo{
		ID: manifest.ID, Name: manifest.Name, Version: manifest.Version,
		Author: manifest.Author, Description: manifest.Description, Homepage: manifest.Homepage,
		Icon: url(manifest.Icon), Enabled: state.Enabled,
		Permissions: append([]string{}, state.Granted...),
		Network:     append([]string{}, manifest.Network...),
		Themes:      []PluginTheme{}, Fonts: []PluginFont{}, Routing: []PluginRouting{},
		Background: url(manifest.Background),
	}
	if manifest.Panel != nil {
		info.Panel, info.PanelTitle = url(manifest.Panel.File), manifest.Panel.Title
	}
	if !plugins.PagesAllowed {
		info.Panel, info.PanelTitle, info.Background = "", "", ""
	}
	for _, theme := range manifest.Themes {
		item := PluginTheme{
			ID:   "plugin:" + manifest.ID + ":" + theme.ID,
			Name: theme.Name, Mode: theme.Mode, Background: theme.Background, Accent: theme.Accent,
		}
		if image := theme.Image; image != nil {
			item.Image = &PluginImage{
				URL: url(image.File), Blur: image.Blur, Brightness: image.Brightness,
				Saturate: image.Saturate, Dim: image.Dim, Panel: image.Panel,
			}
		}
		info.Themes = append(info.Themes, item)
	}
	for index, font := range manifest.Fonts {
		info.Fonts = append(info.Fonts, PluginFont{
			ID: fmt.Sprintf("plugin-%s-%d", manifest.ID, index), Name: font.Name, URL: url(font.File),
		})
	}
	for _, setup := range manifest.Routing {
		info.Routing = append(info.Routing, PluginRouting{Name: setup.Name, Description: setup.Description, File: setup.File})
	}
	return info
}

// ListPlugins lists the installed plugins.
func (a *App) ListPlugins() []PluginInfo {
	result := []PluginInfo{}
	for _, plugin := range pluginsStore().List() {
		result = append(result, pluginInfo(plugin.Manifest, plugin.State))
	}
	return result
}

// PickPlugin lets the user choose a plugin file and reads it, for the
// install prompt. Nothing is installed until InstallPlugin.
func (a *App) PickPlugin() (PluginPreview, error) {
	if a.app == nil {
		return PluginPreview{}, errors.New("application is not ready")
	}
	dialog := a.app.Dialog.OpenFile().
		SetTitle("Install a plugin").
		CanChooseFiles(true).
		AddFilter("NuggetVPN plugin", "*"+plugins.Extension)
	if a.window != nil {
		dialog = dialog.AttachToWindow(a.window)
	}
	picked, err := dialog.PromptForSingleSelection()
	if err != nil || picked == "" {
		return PluginPreview{}, err
	}
	file, err := os.Open(picked)
	if err != nil {
		return PluginPreview{}, err
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, plugins.MaxFileSize+1))
	if err != nil {
		return PluginPreview{}, err
	}
	return a.previewPlugin(data)
}

// previewPlugin reads a plugin file and holds it for InstallPlugin.
func (a *App) previewPlugin(data []byte) (PluginPreview, error) {
	pkg, err := plugins.Read(data)
	if err != nil {
		return PluginPreview{}, err
	}
	random := make([]byte, 16)
	if _, err := rand.Read(random); err != nil {
		return PluginPreview{}, err
	}
	token := hex.EncodeToString(random)

	pendingPluginsMu.Lock()
	now := time.Now()
	for key, pending := range pendingPlugins {
		if now.After(pending.expires) {
			delete(pendingPlugins, key)
		}
	}
	pendingPlugins[token] = pendingPlugin{pkg: pkg, expires: now.Add(15 * time.Minute)}
	pendingPluginsMu.Unlock()

	preview := PluginPreview{
		Token:          token,
		Plugin:         pluginInfo(pkg.Manifest, plugins.State{Granted: pkg.Manifest.Permissions}),
		NewPermissions: pluginsStore().NewPermissions(pkg),
		HasScript:      pkg.Manifest.HasScript(),
	}
	if preview.NewPermissions == nil {
		preview.NewPermissions = []string{}
	}
	if existing, ok := pluginsStore().Get(pkg.Manifest.ID); ok {
		preview.Installed = existing.Manifest.Version
	}
	return preview, nil
}

// InstallPlugin installs a plugin read by PickPlugin, once the user has seen
// what it asks for.
func (a *App) InstallPlugin(token string) (PluginInfo, error) {
	pendingPluginsMu.Lock()
	pending, ok := pendingPlugins[token]
	delete(pendingPlugins, token)
	pendingPluginsMu.Unlock()
	if !ok || time.Now().After(pending.expires) {
		return PluginInfo{}, errors.New("choose the plugin file again")
	}
	if err := pluginsStore().Install(pending.pkg); err != nil {
		return PluginInfo{}, err
	}
	a.appendLog(fmt.Sprintf("Installed plugin %s %s", pending.pkg.Manifest.Name, pending.pkg.Manifest.Version))
	plugin, _ := pluginsStore().Get(pending.pkg.Manifest.ID)
	return pluginInfo(plugin.Manifest, plugin.State), nil
}

// RemovePlugin uninstalls a plugin and what it stored.
func (a *App) RemovePlugin(id string) error {
	return pluginsStore().Remove(id)
}

// SetPluginEnabled turns a plugin on or off.
func (a *App) SetPluginEnabled(id string, enabled bool) ([]PluginInfo, error) {
	if err := pluginsStore().SetEnabled(id, enabled); err != nil {
		return a.ListPlugins(), err
	}
	return a.ListPlugins(), nil
}

// PluginStorageGet reads a value a plugin stored for itself.
func (a *App) PluginStorageGet(id, key string) (json.RawMessage, error) {
	if _, err := activePlugin(id, ""); err != nil {
		return nil, err
	}
	return pluginsStore().GetValue(id, key)
}

// PluginStorageSet stores a value for a plugin; null removes it.
func (a *App) PluginStorageSet(id, key string, value json.RawMessage) error {
	if _, err := activePlugin(id, ""); err != nil {
		return err
	}
	return pluginsStore().SetValue(id, key, value)
}

// activePlugin returns an installed, enabled plugin, checking it holds
// permission (none when empty).
func activePlugin(id, permission string) (plugins.Installed, error) {
	plugin, ok := pluginsStore().Get(id)
	if !ok || !plugin.State.Enabled {
		return plugin, errors.New("that plugin is not installed or is turned off")
	}
	if permission == "" {
		return plugin, nil
	}
	for _, granted := range plugin.State.Granted {
		if granted == permission {
			return plugin, nil
		}
	}
	return plugin, fmt.Errorf("%s has not been allowed to do that", plugin.Manifest.Name)
}

// ApplyPluginRouting replaces the routing with a setup a plugin brings. The
// window keeps the previous routing to offer an undo, as for a .vflow file.
func (a *App) ApplyPluginRouting(id, file string) (FlowImport, error) {
	plugin, err := activePlugin(id, "")
	if err != nil {
		return FlowImport{}, err
	}
	known := false
	for _, setup := range plugin.Manifest.Routing {
		known = known || setup.File == file
	}
	if !known {
		return FlowImport{}, errors.New("that routing setup is not part of the plugin")
	}
	data, err := pluginsStore().ReadFile(id, file)
	if err != nil {
		return FlowImport{}, err
	}
	return a.applyFlow(data)
}

// PluginRule is a rule a plugin adds: one matcher and where it sends traffic.
type PluginRule struct {
	Kind   string   `json:"kind"`
	Values []string `json:"values"`
	Action string   `json:"action"`
	Invert bool     `json:"invert,omitempty"`
}

// AddPluginRule adds a routing rule for a plugin allowed to, with a note on
// the canvas saying which plugin added it, and applies the routing.
func (a *App) AddPluginRule(id string, rule PluginRule) (models.AppSettings, error) {
	plugin, err := activePlugin(id, plugins.PermRouting)
	if err != nil {
		return a.GetSettings(), err
	}
	if rule.Kind == models.SourceLogical || !models.ValidSourceKind(rule.Kind) {
		return a.GetSettings(), fmt.Errorf("a plugin cannot add a rule of kind %q", rule.Kind)
	}
	switch rule.Action {
	case models.ActionProxy, models.ActionDirect, models.ActionBlock:
	default:
		return a.GetSettings(), fmt.Errorf("unknown action %q", rule.Action)
	}
	var values []string
	for _, value := range rule.Values {
		if value = strings.TrimSpace(value); value != "" && len(values) < 5000 {
			values = append(values, value)
		}
	}
	if len(values) == 0 {
		return a.GetSettings(), errors.New("the rule matches nothing")
	}

	random := make([]byte, 6)
	if _, err := rand.Read(random); err != nil {
		return a.GetSettings(), err
	}
	suffix := hex.EncodeToString(random)
	settings := a.GetSettings()
	settings.RoutingRules = append(settings.RoutingRules, models.RoutingRule{
		ID: "rule-" + suffix, Kind: rule.Kind, Values: values, Action: rule.Action, Invert: rule.Invert,
	})
	settings.RoutingComments = append(settings.RoutingComments, models.RoutingComment{
		ID: "comment-" + suffix, Text: "Added by the " + plugin.Manifest.Name + " plugin",
	})
	saved, err := a.SaveSettings(settings)
	if err != nil {
		return saved, err
	}
	a.emit(settingsEventName, saved)
	a.appendLog(fmt.Sprintf("Plugin %s added a %s rule", plugin.Manifest.Name, rule.Kind))
	return saved, a.reapplyRouting()
}

// PluginNotify shows a system notification for a plugin allowed to.
func (a *App) PluginNotify(id, title, body string) error {
	plugin, err := activePlugin(id, plugins.PermNotifications)
	if err != nil {
		return err
	}
	if a.notifier == nil {
		return nil
	}
	clip := func(text string, limit int) string {
		if runes := []rune(strings.TrimSpace(text)); len(runes) > limit {
			return string(runes[:limit])
		}
		return strings.TrimSpace(text)
	}
	return a.notifier.SendNotification(notifications.NotificationOptions{
		ID:       fmt.Sprintf("nuggetvpn-plugin-%d", time.Now().UnixNano()),
		ThreadID: "plugin-" + plugin.Manifest.ID,
		// Always named, so a plugin cannot pass itself off as the app.
		Title: clip(plugin.Manifest.Name+": "+title, 120),
		Body:  clip(body, 400),
	})
}

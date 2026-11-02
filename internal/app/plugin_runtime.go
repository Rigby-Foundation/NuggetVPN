package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/Rigby-Foundation/NuggetVPN/internal/plugins"
)

func (a *App) initPluginHost() {
	if !plugins.NativeAllowed() {
		return
	}
	a.pluginHost = plugins.NewNativeHost(a.PluginCall, func(id, name string, data json.RawMessage) {
		if _, err := activePlugin(id, ""); err == nil {
			a.emit("plugin-backend-event", map[string]any{"id": id, "event": name, "data": data})
		}
	})
}

func (a *App) startPlugins(ctx context.Context) {
	if a.pluginHost == nil {
		return
	}
	go func() {
		ticker := time.NewTicker(2 * time.Second)
		defer ticker.Stop()
		previous := ""
		for {
			list := a.ListPlugins()
			encoded, _ := json.Marshal(list)
			if string(encoded) != previous {
				previous = string(encoded)
				a.emit("plugins-changed", list)
			}
			select {
			case <-ctx.Done():
				a.pluginHost.Close()
				return
			case <-ticker.C:
			}
		}
	}()
}

// PluginCall is the shared app API dispatcher for sandboxed pages and native
// processes. The frontend frame registry/process supervisor supplies id.
func (a *App) PluginCall(id, method string, raw json.RawMessage) (any, error) {
	permissions := map[string]string{
		"app.info": "", "storage.get": "", "storage.set": "", "backend.call": "", "events.subscribe": "",
		"vpn.status": plugins.PermState, "vpn.traffic": plugins.PermState,
		"vpn.connect": plugins.PermControl, "vpn.disconnect": plugins.PermControl,
		"connections.list": plugins.PermConnections, "servers.list": plugins.PermProfiles,
		"servers.add": plugins.PermImport, "subscriptions.add": plugins.PermImport,
		"routing.addRule": plugins.PermRouting, "notify": plugins.PermNotifications,
	}
	permission, known := permissions[method]
	if !known {
		return nil, fmt.Errorf("unknown plugin method %q", method)
	}
	plugin, err := activePlugin(id, permission)
	if err != nil {
		return nil, err
	}
	if plugin.Manifest.Backend != nil && !plugins.NativeAllowed() {
		return nil, errors.New("native plugins are desktop only")
	}
	var params struct {
		Key    string          `json:"key"`
		Value  json.RawMessage `json:"value"`
		Server string          `json:"server"`
		Link   string          `json:"link"`
		Name   string          `json:"name"`
		URL    string          `json:"url"`
		Kind   string          `json:"kind"`
		Values []string        `json:"values"`
		Action string          `json:"action"`
		Invert bool            `json:"invert"`
		Title  string          `json:"title"`
		Body   string          `json:"body"`
		Method string          `json:"method"`
		Params json.RawMessage `json:"params"`
		Event  string          `json:"event"`
	}
	if len(raw) > 1<<20 {
		return nil, errors.New("plugin request is too large")
	}
	if len(raw) != 0 && string(raw) != "null" {
		if err := json.Unmarshal(raw, &params); err != nil {
			return nil, errors.New("invalid plugin parameters")
		}
	}
	switch method {
	case "app.info":
		return map[string]any{"version": a.GetVersion(), "language": a.pluginLanguage(), "platform": runtime.GOOS,
			"plugin": map[string]any{"id": id, "version": plugin.Manifest.Version, "permissions": plugin.State.Granted}}, nil
	case "storage.get":
		return a.PluginStorageGet(id, params.Key)
	case "storage.set":
		if len(params.Value) == 0 {
			params.Value = json.RawMessage("null")
		}
		return nil, a.PluginStorageSet(id, params.Key, params.Value)
	case "vpn.status":
		return pluginState(a.GetConnectionState()), nil
	case "vpn.traffic":
		return a.GetTraffic(), nil
	case "vpn.connect":
		settings := a.GetSettings()
		mode, domain, selected := ModeAuto, "", ""
		if settings.LastSelection != nil {
			mode, domain, selected = settings.LastSelection.Mode, settings.LastSelection.Domain, settings.LastSelection.ProfileID
		}
		if params.Server != "" {
			found := false
			for _, p := range a.GetProfiles() {
				if p.ID == params.Server {
					found = true
					domain = p.NormalizedSourceDomain()
					selected = p.ID
				}
			}
			if !found {
				return nil, errors.New("there is no server with that id")
			}
			mode = ModeManual
		}
		state, err := a.Connect(domain, mode, selected)
		return pluginState(state), err
	case "vpn.disconnect":
		_, err := a.Disconnect()
		return nil, err
	case "connections.list":
		return a.GetConnections(), nil
	case "servers.list":
		result := []map[string]any{}
		for _, p := range a.GetProfiles() {
			result = append(result, map[string]any{"id": p.ID, "name": p.Name, "protocol": p.Protocol, "host": p.Server, "favorite": p.Favorite, "subscription": p.SourceDomain})
		}
		return result, nil
	case "servers.add":
		if strings.TrimSpace(params.Link) == "" || len(params.Link) > 20000 {
			return nil, errors.New("give a valid server link")
		}
		_, err := a.AddProfile(params.Name, params.Link)
		if err == nil {
			a.emit("profiles-changed", a.GetProfiles())
		}
		return nil, err
	case "subscriptions.add":
		parsed, err := url.Parse(params.URL)
		if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" || len(params.URL) > 4000 {
			return nil, errors.New("give an http or https link")
		}
		_, err = a.ImportSubscription(params.URL)
		if err == nil {
			a.emit("profiles-changed", a.GetProfiles())
		}
		return nil, err
	case "routing.addRule":
		_, err := a.AddPluginRule(id, PluginRule{Kind: params.Kind, Values: params.Values, Action: params.Action, Invert: params.Invert})
		return nil, err
	case "notify":
		if !pluginNotificationAllowed(id) {
			return nil, errors.New("too many notifications; try again in a moment")
		}
		return nil, a.PluginNotify(id, params.Title, params.Body)
	case "backend.call":
		if plugin.Manifest.Backend == nil || a.pluginHost == nil {
			return nil, errors.New("this plugin has no native backend")
		}
		if params.Method == "plugin.initialize" {
			return nil, errors.New("reserved backend method")
		}
		if len(params.Params) == 0 {
			params.Params = json.RawMessage("null")
		}
		ctx, cancel := context.WithTimeout(a.context(), 15*time.Second)
		defer cancel()
		return a.pluginHost.Call(ctx, id, params.Method, params.Params)
	case "events.subscribe":
		eventPermission, ok := pluginEventPermission(params.Event)
		if !ok {
			return nil, errors.New("unknown backend event subscription")
		}
		_, err := activePlugin(id, eventPermission)
		return nil, err
	}
	return nil, errors.New("unknown plugin method")
}

func pluginState(state ConnectionState) map[string]any {
	return map[string]any{"status": state.Status, "server": state.Profile, "server_id": state.ProfileID, "since": state.Since, "reconnecting": state.Reconnecting, "blocked": state.Blocked, "error": state.Error}
}

func pluginEventPermission(name string) (string, bool) {
	switch name {
	case "vpn.state", "vpn.traffic":
		return plugins.PermState, true
	}
	return "", false
}

func (a *App) publishNativeEvent(name string, payload []any) {
	if a.pluginHost == nil || len(payload) != 1 {
		return
	}
	var event string
	var data any = payload[0]
	switch name {
	case stateEventName:
		event = "vpn.state"
		if state, ok := data.(ConnectionState); ok {
			data = pluginState(state)
		} else {
			return
		}
	case trafficEventName:
		event = "vpn.traffic"
	default:
		return
	}
	permission, _ := pluginEventPermission(event)
	a.pluginHost.Publish(event, data, func(id string) bool { _, err := activePlugin(id, permission); return err == nil })
}

var pluginNotificationTimes = struct {
	sync.Mutex
	last map[string]time.Time
}{last: map[string]time.Time{}}

func pluginNotificationAllowed(id string) bool {
	pluginNotificationTimes.Lock()
	defer pluginNotificationTimes.Unlock()
	if time.Since(pluginNotificationTimes.last[id]) < 10*time.Second {
		return false
	}
	pluginNotificationTimes.last[id] = time.Now()
	return true
}

func (a *App) pluginLanguage() string {
	a.trayMu.Lock()
	defer a.trayMu.Unlock()
	if a.trayLanguage == "" {
		return "en"
	}
	return a.trayLanguage
}

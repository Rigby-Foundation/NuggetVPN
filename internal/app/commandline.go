package app

import (
	"errors"
	"fmt"
	"runtime"
	"strings"
	"time"

	"github.com/Rigby-Foundation/NuggetVPN/internal/cli"
	"github.com/Rigby-Foundation/NuggetVPN/internal/models"
	"github.com/Rigby-Foundation/NuggetVPN/internal/storage"
)

// ---------------------------------------------------------------------------
// The command line: NuggetVPN status, connect, ...
// ---------------------------------------------------------------------------

func (a *App) startCommandLine() {
	if runtime.GOOS == "android" {
		return
	}
	server, err := cli.Listen(storage.CLISocketPath(), storage.CLITokenPath(), a.handleCommand)
	if err != nil {
		a.appendLog("WARN command line: " + err.Error())
		return
	}
	a.mu.Lock()
	a.commandLine = server
	a.mu.Unlock()
}

func (a *App) stopCommandLine() {
	a.mu.Lock()
	server := a.commandLine
	a.commandLine = nil
	a.mu.Unlock()
	if server != nil {
		server.Close()
	}
}

// handleCommand answers one command from the command line.
func (a *App) handleCommand(command string, args []string) (string, any, error) {
	switch command {
	case "status":
		state := a.GetConnectionState()
		return describeState(state, a.GetTraffic()), state, nil

	case "connect":
		profiles, settings := a.snapshot()
		var state ConnectionState
		var err error
		if len(args) > 0 {
			profile, findErr := findServer(profiles, strings.Join(args, " "))
			if findErr != nil {
				return "", nil, findErr
			}
			state, err = a.Connect(profile.NormalizedSourceDomain(), ModeManual, profile.ID)
		} else {
			selection := settings.LastSelection
			if selection == nil {
				return "", nil, errors.New("no server picked yet: name one, or pick one in the app")
			}
			state, err = a.Connect(selection.Domain, selection.Mode, selection.ProfileID)
		}
		if err != nil {
			return "", nil, err
		}
		return describeState(state, TrafficSample{}), state, nil

	case "disconnect":
		state, err := a.Disconnect()
		if err != nil {
			return "", nil, err
		}
		return "Disconnected", state, nil

	case "servers":
		profiles, _ := a.snapshot()
		current := a.GetConnectionState().ProfileID
		search := strings.ToLower(strings.Join(args, " "))
		type server struct {
			ID       string `json:"id"`
			Name     string `json:"name"`
			Protocol string `json:"protocol"`
			Source   string `json:"source"`
			Current  bool   `json:"current"`
		}
		var list []server
		var lines []string
		for _, profile := range profiles {
			if search != "" && !strings.Contains(strings.ToLower(profile.Name), search) {
				continue
			}
			entry := server{profile.ID, profile.Name, profile.Protocol, profile.NormalizedSourceDomain(), profile.ID == current}
			list = append(list, entry)
			mark := " "
			if entry.Current {
				mark = "*"
			}
			lines = append(lines, fmt.Sprintf("%s %-32s %-10s %s", mark, entry.Name, entry.Protocol, entry.Source))
		}
		if len(list) == 0 {
			return "No servers", []server{}, nil
		}
		return strings.Join(lines, "\n"), list, nil

	case "setup":
		settings := a.GetSettings()
		name := func(setup models.RoutingSetup) string {
			if setup.Name == "" {
				return "Main"
			}
			return setup.Name
		}
		if len(args) == 0 {
			var lines []string
			for _, setup := range settings.RoutingSetups {
				mark := " "
				if setup.ID == settings.ActiveRoutingSetup {
					mark = "*"
				}
				lines = append(lines, mark+" "+name(setup))
			}
			return strings.Join(lines, "\n"), settings.RoutingSetups, nil
		}
		wanted := strings.ToLower(strings.Join(args, " "))
		for _, setup := range settings.RoutingSetups {
			if strings.ToLower(name(setup)) == wanted || strings.ToLower(setup.ID) == wanted {
				if _, err := a.SwitchRoutingSetup(setup.ID); err != nil {
					return "", nil, err
				}
				return "Routing: " + name(setup), setup, nil
			}
		}
		return "", nil, fmt.Errorf("no routing setup called %q", strings.Join(args, " "))

	case "speedtest":
		result, err := a.RunSpeedTest()
		if err != nil {
			return "", nil, err
		}
		return fmt.Sprintf("Through %s\nDownload  %.1f Mbps\nUpload    %.1f Mbps\nPing      %.0f ms (jitter %.1f ms)",
			result.Server, result.Download, result.Upload, result.Latency, result.Jitter), result, nil
	}
	return "", nil, fmt.Errorf("unknown command %q; try: NuggetVPN help", command)
}

// findServer picks a server by id, exact name, or a unique part of a name.
func findServer(profiles []models.Profile, query string) (models.Profile, error) {
	lower := strings.ToLower(strings.TrimSpace(query))
	var partial []models.Profile
	for _, profile := range profiles {
		if profile.ID == query || strings.ToLower(profile.Name) == lower {
			return profile, nil
		}
		if strings.Contains(strings.ToLower(profile.Name), lower) {
			partial = append(partial, profile)
		}
	}
	switch len(partial) {
	case 1:
		return partial[0], nil
	case 0:
		return models.Profile{}, fmt.Errorf("no server matches %q; see: NuggetVPN servers", query)
	}
	var names []string
	for _, profile := range partial[:min(len(partial), 8)] {
		names = append(names, profile.Name)
	}
	return models.Profile{}, fmt.Errorf("%q matches %d servers: %s", query, len(partial), strings.Join(names, ", "))
}

func describeState(state ConnectionState, traffic TrafficSample) string {
	switch {
	case state.Status == StatusConnected:
		text := "Connected to " + state.Profile
		if state.Since > 0 {
			text += " for " + time.Since(time.UnixMilli(state.Since)).Round(time.Second).String()
		}
		if traffic.Up+traffic.Down > 0 {
			text += fmt.Sprintf("\nSent %s, received %s", byteCount(traffic.Up), byteCount(traffic.Down))
		}
		return text
	case state.Reconnecting:
		return "Reconnecting to " + state.Profile
	case state.Blocked:
		return "Disconnected; the kill switch is holding all traffic"
	case state.Status == StatusConnecting:
		return "Connecting"
	case state.Status == StatusError:
		return "Error: " + state.Error
	}
	return "Disconnected"
}

func byteCount(count uint64) string {
	units := []string{"B", "KB", "MB", "GB", "TB"}
	value := float64(count)
	unit := 0
	for value >= 1024 && unit < len(units)-1 {
		value /= 1024
		unit++
	}
	if unit == 0 {
		return fmt.Sprintf("%d B", count)
	}
	return fmt.Sprintf("%.1f %s", value, units[unit])
}

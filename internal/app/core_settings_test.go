package app

import (
	"testing"

	"github.com/Rigby-Foundation/NuggetVPN/internal/models"
)

func TestCoreSettingsSignatureIgnoresClientAndCanvasChanges(t *testing.T) {
	base := models.DefaultSettings()
	base.Normalize()
	original := coreSettingsSignature(base)
	changes := []struct {
		name string
		edit func(*models.AppSettings)
	}{
		{"canvas position", func(s *models.AppSettings) { s.RoutingLayout["node"] = models.Point{X: 100, Y: 200} }},
		{"canvas note", func(s *models.AppSettings) { s.RoutingComments = []models.RoutingComment{{ID: "note", Text: "note"}} }},
		{"unused destination", func(s *models.AppSettings) { s.RoutingServers = []string{"server"} }},
		{"empty rule", func(s *models.AppSettings) {
			s.RoutingRules = []models.RoutingRule{{ID: "empty", Kind: models.SourceDomains, Action: models.ActionProxy}}
		}},
		{"unconnected rule", func(s *models.AppSettings) {
			s.RoutingRules = []models.RoutingRule{{ID: "draft", Kind: models.SourceDomains, Values: []string{"example.com"}}}
		}},
		{"autostart", func(s *models.AppSettings) { s.LaunchAtStartup = !s.LaunchAtStartup }},
		{"shortcut", func(s *models.AppSettings) { s.GlobalShortcut = "Ctrl+Alt+K" }},
		{"selection", func(s *models.AppSettings) {
			s.LastSelection = &models.Selection{Domain: "sub.example", Mode: ModeAuto}
		}},
	}
	for _, change := range changes {
		t.Run(change.name, func(t *testing.T) {
			next := models.DefaultSettings()
			next.Normalize()
			change.edit(&next)
			if coreSettingsSignature(next) != original {
				t.Fatal("this change must not ask to reload Xray")
			}
		})
	}
}

func TestCoreSettingsSignatureDetectsRuntimeChanges(t *testing.T) {
	base := models.DefaultSettings()
	base.Normalize()
	original := coreSettingsSignature(base)
	changes := []struct {
		name string
		edit func(*models.AppSettings)
	}{
		{"DNS", func(s *models.AppSettings) { s.DNS = "9.9.9.9" }},
		{"MTU", func(s *models.AppSettings) { s.MTU = 1400 }},
		{"TLS fragmentation", func(s *models.AppSettings) { s.TLSFragment = true }},
		{"SNI", func(s *models.AppSettings) {
			s.SNISpoofEnabled = true
			s.SNISpoofValue = "example.com"
		}},
		{"logging", func(s *models.AppSettings) {
			enabled := !s.LoggingOn()
			s.LoggingEnabled = &enabled
		}},
		{"routing", func(s *models.AppSettings) {
			s.RoutingRules = []models.RoutingRule{{ID: "rule", Kind: models.SourceDomains, Values: []string{"example.com"}, Action: models.ActionDirect}}
		}},
		{"default route", func(s *models.AppSettings) { s.DefaultAction = models.ActionBlock }},
		{"chain", func(s *models.AppSettings) {
			s.ProxyChainEnabled = true
			s.ProxyChain = []string{"hop"}
		}},
		{"exit", func(s *models.AppSettings) {
			s.ProxyChainEnabled = true
			s.ProxyChainExit = "exit"
		}},
		{"automatic exit balancing", func(s *models.AppSettings) { s.FastestServer = true }},
	}
	for _, change := range changes {
		t.Run(change.name, func(t *testing.T) {
			next := models.DefaultSettings()
			next.Normalize()
			change.edit(&next)
			if coreSettingsSignature(next) == original {
				t.Fatal("the running core needs to reload after this change")
			}
		})
	}
}

func TestReloadAndSwitchLeaveDisconnectedTunnelDown(t *testing.T) {
	app := &App{state: ConnectionState{Status: StatusIdle}}
	if state, err := app.ReloadCore(); err != nil || state.Status != StatusIdle {
		t.Fatalf("reload while disconnected: state=%+v err=%v", state, err)
	}
	if state, err := app.SwitchConnection("sub.example", ModeAuto, ""); err != nil || state.Status != StatusIdle {
		t.Fatalf("switch while disconnected: state=%+v err=%v", state, err)
	}
}

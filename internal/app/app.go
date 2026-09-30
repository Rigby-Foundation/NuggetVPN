// Package app is the service the frontend talks to.
//
// Every exported method on App is callable from JavaScript: Wails binds them by
// reflection when the service is registered. That is also why this lives here
// rather than in package main. A type declared in a main package reports its
// package path as the literal "main", and a Go test binary reports the real
// import path for the same type — so the name the frontend has to call by is
// one no test can observe. Out here the two agree, and TestServiceFQNMatchesGo
// can check the contract for real.
package app

import (
	"context"
	"net/http"
	"os"
	"sync"
	"sync/atomic"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/services/notifications"

	"github.com/Rigby-Foundation/NuggetVPN/internal/autostart"
	"github.com/Rigby-Foundation/NuggetVPN/internal/core"
	"github.com/Rigby-Foundation/NuggetVPN/internal/link"
	"github.com/Rigby-Foundation/NuggetVPN/internal/models"
	"github.com/Rigby-Foundation/NuggetVPN/internal/remote"
	"github.com/Rigby-Foundation/NuggetVPN/internal/storage"
)

const (
	// MixedPort exposes a local HTTP/SOCKS proxy alongside the TUN interface.
	MixedPort = 7890
	// WindowName is the main window, which the service looks up on startup.
	WindowName = "main"

	// logEventName matches the event the frontend subscribes to.
	logEventName = "vpn-log"
	// stateEventName carries the whole connection state, not just a boolean, so
	// the UI can distinguish connecting from connected from failed.
	stateEventName = "vpn-state"
	// trafficEventName carries a byte-counter sample once a second.
	trafficEventName = "vpn-traffic"
	// settingsEventName carries settings changed from outside the window,
	// such as a routing setup picked from the tray.
	settingsEventName = "settings-changed"

	// usagePersistInterval is how often accumulated bytes are written to
	// profiles.json. Every sample would mean a disk write per second.
	usagePersistInterval = 5 * time.Second
)

// App is bound to the frontend; every exported method is callable from JS.
type App struct {
	ctx context.Context

	// app and window are resolved during ServiceStartup.
	app    *application.App
	window *application.WebviewWindow
	// tray is built during ServiceStartup, from icon.
	tray *application.SystemTray
	// trayLanguage is the UI's language, for the tray menu; trayMu guards it
	// and serialises rebuilding the menu.
	trayMu       sync.Mutex
	trayLanguage string
	icon         []byte
	// quitting tells the window-close hook to stop swallowing the close.
	quitting bool

	mu       sync.Mutex
	profiles []models.Profile
	settings models.AppSettings
	state    ConnectionState

	// connectMu serialises Connect and Disconnect so two clicks cannot race a
	// half-finished failover sweep.
	connectMu sync.Mutex

	core   *core.Client
	remote *remote.Client
	http   *http.Client

	trafficMu     sync.Mutex
	traffic       TrafficSample
	trafficBase   struct{ up, down uint64 }
	pendingUp     uint64
	pendingDown   uint64
	lastPersisted time.Time

	// pendingLink is a nuggetvpn:// link received before the window could
	// take it; see TakePendingLink.
	pendingLink string

	logMu   sync.Mutex
	logFile *os.File
	// loggingOn mirrors settings.LoggingOn, readable from any goroutine
	// without taking mu — log lines are written from inside locked sections.
	loggingOn atomic.Bool

	// ruleOwners maps the running config's route rules, by index, to the
	// routing rule each came from; see sbconfig.Result.RuleOwners.
	ruleOwners []string
	// serverFor maps the running config's outbound tags to server profile
	// ids; see sbconfig.Result.ServerFor.
	serverFor map[string]string
	// ruleTexts, set while an external core runs, traces the rules it
	// reports back to routing rules; see ruleForText.
	ruleTexts map[string]string

	// connectGen counts connects and disconnects, so a reconnect in progress
	// can tell it has been superseded. lastConnect is what to reconnect to.
	connectGen  atomic.Uint64
	lastConnect connectRequest
	// alternatives are the servers the exit may switch between, from the
	// last connect; see sbconfig.Request.Alternatives.
	alternatives []models.Profile
	// lockedDown is set while the kill switch's lockdown config runs.
	lockedDown atomic.Bool

	// notifier shows system notifications; nil in tests.
	notifier *notifications.NotificationService

	// version is the running version; latest the newest release, once
	// CheckForUpdate has looked.
	version string
	latest  *release
}

// New loads persisted state and prepares the core client. icon is the tray
// icon.
func New(version string, icon []byte, notifier *notifications.NotificationService) *App {
	_ = storage.EnsureDirs()

	service := &App{
		profiles: storage.LoadProfiles(link.DecodeProfileName),
		settings: storage.LoadSettings(),
		core: core.NewClient(
			storage.ControlSocketPath(),
			storage.ControlTokenPath(),
			version,
		),
		remote: remote.NewClient(),
		http:   &http.Client{Timeout: 8 * time.Second},
		state:  ConnectionState{Status: StatusIdle},
		icon:   icon,

		notifier: notifier,
		version:  version,
	}
	service.settings.Normalize()
	service.settings.LaunchAtStartup = autostart.Enabled()
	service.loggingOn.Store(service.settings.LoggingOn())
	return service
}

// ServiceStartup is the Wails service lifecycle hook, called once during
// application startup.
//
// The application and window handles are fetched here rather than handed in by
// main, because a setter for them would be an exported method — and every
// exported method on this type becomes a JavaScript-callable binding.
func (a *App) ServiceStartup(ctx context.Context, _ application.ServiceOptions) error {
	a.ctx = ctx
	a.app = application.Get()

	if window, ok := a.app.Window.GetByName(WindowName); ok {
		a.window, _ = window.(*application.WebviewWindow)
	}
	a.buildTray()
	a.registerCloseHook()

	a.core.OnLog(func(level, message string) {
		a.appendLog(withLevel(level, message))
	})
	a.core.OnState(a.handleCoreState)
	a.core.OnStats(a.handleCoreStats)
	a.prepareNotifications()
	a.forwardCoreEvents()
	registerURLScheme()
	_, startup := a.snapshot()
	if startup.GlobalShortcut != "" {
		if err := a.registerHotkey(startup.GlobalShortcut); err != nil {
			a.appendLog("WARN global shortcut: " + err.Error())
		}
	}
	// A link the app was started with, on the platforms that pass it as an
	// argument.
	a.receiveLinks(os.Args[1:]...)
	return nil
}

// ServiceShutdown stops the tunnel and the privileged service when the GUI
// exits, so no root process is left holding the system routes.
func (a *App) ServiceShutdown() error {
	a.flushUsage()
	a.core.Shutdown()

	a.logMu.Lock()
	defer a.logMu.Unlock()
	if a.logFile != nil {
		_ = a.logFile.Close()
		a.logFile = nil
	}
	return nil
}

func (a *App) emit(name string, payload ...any) {
	if a.app == nil {
		return
	}
	a.app.Event.Emit(name, payload...)
}

func (a *App) context() context.Context {
	if a.ctx != nil {
		return a.ctx
	}
	return context.Background()
}

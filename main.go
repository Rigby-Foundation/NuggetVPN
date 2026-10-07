// NuggetVPN is a Wails desktop client with sing-box linked in as a library.
//
// The binary has two modes:
//
//	nuggetvpn                  the GUI
//	nuggetvpn --core-service   the privileged core, started by the GUI
//
// Both modes are the same executable, so the UI and the tunnel can never drift
// to different sing-box versions.
package main

import (
	"embed"
	_ "embed"
	"flag"
	"fmt"
	"log"
	"os"
	"runtime"
	"slices"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
	"github.com/wailsapp/wails/v3/pkg/services/notifications"

	"github.com/Rigby-Foundation/NuggetVPN/internal/app"
	"github.com/Rigby-Foundation/NuggetVPN/internal/autostart"
	"github.com/Rigby-Foundation/NuggetVPN/internal/cli"

	"github.com/Rigby-Foundation/NuggetVPN/internal/core"
	"github.com/Rigby-Foundation/NuggetVPN/internal/models"
	"github.com/Rigby-Foundation/NuggetVPN/internal/plugins"
	"github.com/Rigby-Foundation/NuggetVPN/internal/storage"
)

//go:embed all:frontend/dist
var assets embed.FS

//go:embed build/appicon.png
var appIcon []byte

//go:embed build/trayicon.png
var trayIcon []byte

// version is stamped into the core service handshake so the GUI can detect a
// service left behind by an older build.
var version = "2.3.0"

func main() {
	// NuggetVPN status, connect, ...: control the running app and exit.
	if cli.IsCommand(os.Args[1:]) {
		os.Exit(cli.Run(os.Args[1:], storage.CLISocketPath(), storage.CLITokenPath(), version))
	}
	for _, arg := range os.Args[1:] {
		if arg == "--core-service" {
			if err := runCoreService(); err != nil {
				log.Fatalf("core service: %v", err)
			}
			return
		}
		if arg == "--version" {
			fmt.Println("NuggetVPN", version)
			return
		}
	}
	runGUI()
}

// runCoreService hosts the embedded sing-box behind a unix socket. It is
// started by the GUI under an elevation prompt.
func runCoreService() error {
	flags := flag.NewFlagSet("core-service", flag.ContinueOnError)
	flags.Bool("core-service", true, "run the privileged core service")
	flags.String("version", version, "version of the service")
	socket := flags.String("socket", storage.ControlSocketPath(), "control socket path")
	tokenFile := flags.String("token-file", storage.ControlTokenPath(), "path to the control token")
	uid := flags.Int("uid", -1, "uid that should own the control socket")
	gid := flags.Int("gid", -1, "gid that should own the control socket")
	parent := flags.Int("parent", 0, "pid of the GUI process to watch")

	if err := flags.Parse(os.Args[1:]); err != nil {
		return err
	}

	// Consuming the token here also deletes the file, so the credential exists
	// on disk only for the moment between the GUI writing it and the elevated
	// process starting.
	token, err := core.ReadTokenFile(*tokenFile)
	if err != nil {
		return err
	}

	return core.RunService(core.ServiceOptions{
		SocketPath: *socket,
		Token:      token,
		OwnerUID:   *uid,
		OwnerGID:   *gid,
		ParentPID:  *parent,
		WorkingDir: storage.RuntimeDir(),
		Version:    version,
	})
}

func runGUI() {
	// System notifications, where Wails has them. On Android its Linux
	// notifier would look for D-Bus, fail, and stop the app from starting.
	var notifier *notifications.NotificationService
	services := []application.Service{}
	if runtime.GOOS != "android" {
		notifier = notifications.New()
		services = append(services, application.NewService(notifier))
	}
	service := app.New(version, trayIcon, notifier)
	services = append([]application.Service{application.NewService(service)}, services...)

	// Started by the system at login: come up without a window, unless
	// closing is set to quit — then there would be no tray icon to reopen it
	// from, and an invisible app with no way in.
	startHidden := false
	if slices.Contains(os.Args[1:], autostart.Flag) {
		startHidden = service.GetSettings().CloseAction != models.CloseQuit
	}

	// Set once the window exists; the second-instance callback needs it.
	var window *application.WebviewWindow

	wailsApp := application.New(application.Options{
		Name:        "NuggetVPN",
		Description: "Modern, lightweight VPN client with an embedded sing-box core",
		Icon:        appIcon,
		Services:    services,
		Assets: application.AssetOptions{
			Handler: app.PluginFiles(app.UserFilesHandler(application.AssetFileServerFS(assets))),
			// Before the runtime endpoint: see plugins.GuardRuntime.
			Middleware: plugins.GuardRuntime,
		},
		Mac: application.MacOptions{
			// The tray keeps the app (and the tunnel) alive after the last
			// window closes.
			ApplicationShouldTerminateAfterLastWindowClosed: false,
		},
		// One copy at a time. Two would each try to own the tunnel and the
		// privileged core, and fight over profiles.json. Launching again
		// instead brings the running copy to the front — which is also how a
		// window closed to the tray, or hidden completely, is reopened.
		SingleInstance: &application.SingleInstanceOptions{
			UniqueID: storage.Identifier,
			OnSecondInstanceLaunch: func(data application.SecondInstanceData) {
				if window != nil {
					service.ShowWindow()
				}
				app.ReceiveLaunchArgs(service, data.Args)
			},
		},
	})

	// macOS opens nuggetvpn:// links through an event rather than arguments.
	wailsApp.Event.OnApplicationEvent(events.Common.ApplicationLaunchedWithUrl, func(event *application.ApplicationEvent) {
		app.ReceiveLaunchArgs(service, []string{event.Context().URL()})
	})

	window = wailsApp.Window.NewWithOptions(application.WebviewWindowOptions{
		Name:      app.WindowName,
		Title:     "NuggetVPN",
		Width:     1100,
		Height:    750,
		MinWidth:  400,
		MinHeight: 500,
		URL:       "/",
		Hidden:    startHidden,
		// The UI draws its own title bar and rounded corners.
		Frameless:        true,
		BackgroundType:   application.BackgroundTypeTransparent,
		BackgroundColour: application.NewRGBA(0, 0, 0, 0),
		Mac: application.MacWindow{
			Backdrop: application.MacBackdropTranslucent,
			TitleBar: application.MacTitleBarHiddenInset,
		},
	})

	// The service looks the window up during startup and builds the tray and
	// the close behaviour around it.

	if err := wailsApp.Run(); err != nil {
		log.Fatalf("failed to start NuggetVPN: %v", err)
	}
}

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

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"

	"github.com/Rigby-Foundation/NuggetVPN/internal/core"
	"github.com/Rigby-Foundation/NuggetVPN/internal/storage"
)

//go:embed all:frontend/dist
var assets embed.FS

//go:embed build/appicon.png
var appIcon []byte

// version is stamped into the core service handshake so the GUI can detect a
// service left behind by an older build.
var version = "1.0.0"

func main() {
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
	service := NewApp(version)

	app := application.New(application.Options{
		Name:        "NuggetVPN",
		Description: "Modern, lightweight VPN client with an embedded sing-box core",
		Icon:        appIcon,
		Services: []application.Service{
			application.NewService(service),
		},
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(assets),
		},
		Mac: application.MacOptions{
			// The tray keeps the app (and the tunnel) alive after the last
			// window closes.
			ApplicationShouldTerminateAfterLastWindowClosed: false,
		},
	})

	window := app.Window.NewWithOptions(application.WebviewWindowOptions{
		Name:      "main",
		Title:     "NuggetVPN",
		Width:     1100,
		Height:    750,
		MinWidth:  400,
		MinHeight: 500,
		URL:       "/",
		// The UI draws its own title bar and rounded corners.
		Frameless:        true,
		BackgroundType:   application.BackgroundTypeTransparent,
		BackgroundColour: application.NewRGBA(0, 0, 0, 0),
		Mac: application.MacWindow{
			Backdrop: application.MacBackdropTranslucent,
			TitleBar: application.MacTitleBarHiddenInset,
		},
	})

	// Closing the window hides it; the tray is how you get it back, and the
	// tunnel keeps running in the meantime.
	window.RegisterHook(events.Common.WindowClosing, func(event *application.WindowEvent) {
		if service.quitting {
			return
		}
		event.Cancel()
		window.Hide()
	})

	newSystemTray(app, window, service)
	service.attach(app, window)

	if err := app.Run(); err != nil {
		log.Fatalf("failed to start NuggetVPN: %v", err)
	}
}

// newSystemTray builds the tray icon and its menu.
func newSystemTray(app *application.App, window *application.WebviewWindow, service *App) *application.SystemTray {
	tray := app.SystemTray.New()
	tray.SetLabel("NuggetVPN")
	tray.SetTooltip("NuggetVPN")
	tray.SetIcon(appIcon)

	menu := app.NewMenu()
	menu.Add("Open NuggetVPN").OnClick(func(*application.Context) {
		window.Show()
		window.Focus()
	})
	menu.AddSeparator()
	menu.Add("Disconnect").OnClick(func(*application.Context) {
		if _, err := service.Disconnect(); err != nil {
			app.Logger.Error("tray disconnect failed", "error", err)
		}
	})
	menu.AddSeparator()
	menu.Add("Quit NuggetVPN").OnClick(func(*application.Context) {
		// Mark the quit first so the close hook stops swallowing it.
		service.quitting = true
		app.Quit()
	})
	tray.SetMenu(menu)

	// A left click should reveal the window rather than only open the menu.
	tray.OnClick(func() {
		window.Show()
		window.Focus()
	})
	return tray
}

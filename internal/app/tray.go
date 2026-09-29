package app

import (
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"

	"github.com/Rigby-Foundation/NuggetVPN/internal/models"
)

// ---------------------------------------------------------------------------
// Tray and window lifecycle
// ---------------------------------------------------------------------------

// buildTray creates the tray icon and its menu.
//
// It lives here rather than in main because the close behaviour needs it:
// "hide completely" takes the tray icon away with the window, and bringing
// the window back has to restore it.
func (a *App) buildTray() {
	tray := a.app.SystemTray.New()
	tray.SetLabel("NuggetVPN")
	tray.SetTooltip("NuggetVPN")
	tray.SetIcon(a.icon)

	menu := a.app.NewMenu()
	menu.Add("Open NuggetVPN").OnClick(func(*application.Context) {
		a.ShowWindow()
	})
	menu.AddSeparator()
	menu.Add("Disconnect").OnClick(func(*application.Context) {
		if _, err := a.Disconnect(); err != nil {
			a.app.Logger.Error("tray disconnect failed", "error", err)
		}
	})
	menu.AddSeparator()
	menu.Add("Quit NuggetVPN").OnClick(func(*application.Context) {
		a.QuitApp()
	})
	tray.SetMenu(menu)

	// A left click should reveal the window rather than only open the menu.
	tray.OnClick(a.ShowWindow)
	a.tray = tray
}

// registerCloseHook routes the system's close — Alt+F4, the Dock, the
// window menu — through the same behaviour as the app's own close button.
func (a *App) registerCloseHook() {
	if a.window == nil {
		return
	}
	a.window.RegisterHook(events.Common.WindowClosing, func(event *application.WindowEvent) {
		if a.quitting {
			return
		}
		event.Cancel()
		a.closeWindow()
	})
}

// closeWindow does what the user chose closing the window should do.
func (a *App) closeWindow() {
	_, settings := a.snapshot()
	switch settings.CloseAction {
	case models.CloseQuit:
		a.QuitApp()
	case models.CloseHideCompletely:
		// Nothing in the taskbar, nothing in the tray, tunnel still up.
		// Launching the app again reaches this copy through the single-
		// instance lock, and ShowWindow restores both.
		if a.window != nil {
			a.window.Hide()
		}
		if a.tray != nil {
			a.tray.Hide()
		}
	default:
		if a.window != nil {
			a.window.Hide()
		}
	}
}

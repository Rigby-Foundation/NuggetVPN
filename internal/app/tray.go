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

	labels := trayLabels["en"]
	menu := a.app.NewMenu()
	open := menu.Add(labels.open).OnClick(func(*application.Context) {
		a.ShowWindow()
	})
	menu.AddSeparator()
	disconnect := menu.Add(labels.disconnect).OnClick(func(*application.Context) {
		if _, err := a.Disconnect(); err != nil {
			a.app.Logger.Error("tray disconnect failed", "error", err)
		}
	})
	menu.AddSeparator()
	quit := menu.Add(labels.quit).OnClick(func(*application.Context) {
		a.QuitApp()
	})
	tray.SetMenu(menu)
	a.trayMenu = trayMenu{menu: menu, open: open, disconnect: disconnect, quit: quit}

	// A left click should reveal the window rather than only open the menu.
	tray.OnClick(a.ShowWindow)
	a.tray = tray
}

// trayMenu keeps the tray's items, so a language change can relabel them.
type trayMenu struct {
	menu                   *application.Menu
	open, disconnect, quit *application.MenuItem
}

type trayText struct{ open, disconnect, quit string }

// trayLabels is the tray menu in each language the UI offers. The menu is
// built here, not in the webview, so it cannot use the UI's translations;
// three strings are not worth sharing a catalogue over.
var trayLabels = map[string]trayText{
	"en": {"Open NuggetVPN", "Disconnect", "Quit NuggetVPN"},
	"ru": {"Открыть NuggetVPN", "Отключиться", "Выйти из NuggetVPN"},
	"uk": {"Відкрити NuggetVPN", "Відключитися", "Вийти з NuggetVPN"},
	"zh": {"打开 NuggetVPN", "断开连接", "退出 NuggetVPN"},
	"ja": {"NuggetVPN を開く", "切断", "NuggetVPN を終了"},
	"fa": {"باز کردن NuggetVPN", "قطع اتصال", "خروج از NuggetVPN"},
}

// SetUILanguage relabels the tray menu in the language the UI is showing.
// The UI calls it at start and whenever the language changes; an unknown
// language leaves the menu in English.
func (a *App) SetUILanguage(language string) {
	labels, ok := trayLabels[language]
	if !ok {
		labels = trayLabels["en"]
	}
	if a.trayMenu.menu == nil {
		return
	}
	a.trayMenu.open.SetLabel(labels.open)
	a.trayMenu.disconnect.SetLabel(labels.disconnect)
	a.trayMenu.quit.SetLabel(labels.quit)
	a.trayMenu.menu.Update()
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

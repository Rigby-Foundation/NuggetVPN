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

	// A left click should reveal the window rather than only open the menu.
	tray.OnClick(a.ShowWindow)
	a.tray = tray
	a.trayLanguage = "en"
	a.refreshTrayMenu()
}

type trayText struct{ open, disconnect, quit, routing, mainSetup string }

// trayLabels is the tray menu in each language the UI offers. The menu is
// built here, not in the webview, so it cannot use the UI's translations;
// five strings are not worth sharing a catalogue over.
var trayLabels = map[string]trayText{
	"en": {"Open NuggetVPN", "Disconnect", "Quit NuggetVPN", "Routing", "Main"},
	"ru": {"Открыть NuggetVPN", "Отключиться", "Выйти из NuggetVPN", "Маршрутизация", "Основная"},
	"uk": {"Відкрити NuggetVPN", "Відключитися", "Вийти з NuggetVPN", "Маршрутизація", "Основна"},
	"zh": {"打开 NuggetVPN", "断开连接", "退出 NuggetVPN", "路由", "主要"},
	"ja": {"NuggetVPN を開く", "切断", "NuggetVPN を終了", "ルーティング", "メイン"},
	"fa": {"باز کردن NuggetVPN", "قطع اتصال", "خروج از NuggetVPN", "مسیریابی", "اصلی"},
}

// SetUILanguage relabels the tray menu in the language the UI is showing.
// The UI calls it at start and whenever the language changes; an unknown
// language leaves the menu in English.
func (a *App) SetUILanguage(language string) {
	if _, ok := trayLabels[language]; !ok {
		language = "en"
	}
	a.trayMu.Lock()
	a.trayLanguage = language
	a.trayMu.Unlock()
	a.refreshTrayMenu()
}

// refreshTrayMenu builds the tray menu afresh: in the UI's language, with
// the routing setups to switch between, the active one ticked. It is rebuilt
// rather than edited because the setups come and go with every settings
// save, and the menu has no way to take an item out.
func (a *App) refreshTrayMenu() {
	if a.app == nil || a.tray == nil {
		return
	}
	a.trayMu.Lock()
	defer a.trayMu.Unlock()

	labels, ok := trayLabels[a.trayLanguage]
	if !ok {
		labels = trayLabels["en"]
	}
	_, settings := a.snapshot()

	menu := a.app.NewMenu()
	menu.Add(labels.open).OnClick(func(*application.Context) {
		a.ShowWindow()
	})
	menu.AddSeparator()
	menu.Add(labels.disconnect).OnClick(func(*application.Context) {
		if _, err := a.Disconnect(); err != nil {
			a.app.Logger.Error("tray disconnect failed", "error", err)
		}
	})

	// With a single setup there is nothing to switch to.
	if len(settings.RoutingSetups) > 1 {
		routing := menu.AddSubmenu(labels.routing)
		for _, setup := range settings.RoutingSetups {
			id := setup.ID
			name := setup.Name
			if name == "" {
				name = labels.mainSetup
			}
			routing.AddRadio(name, id == settings.ActiveRoutingSetup).OnClick(func(*application.Context) {
				// Switching reconnects, which takes a moment; not on the
				// menu's thread.
				go func() {
					if _, err := a.SwitchRoutingSetup(id); err != nil {
						a.appendLog("Could not switch routing: " + err.Error())
					}
				}()
			})
		}
	}

	menu.AddSeparator()
	menu.Add(labels.quit).OnClick(func(*application.Context) {
		a.QuitApp()
	})
	a.tray.SetMenu(menu)
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

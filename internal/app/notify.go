package app

import (
	"fmt"
	"time"

	"github.com/wailsapp/wails/v3/pkg/services/notifications"
)

// ---------------------------------------------------------------------------
// System notifications
// ---------------------------------------------------------------------------

type notifyKind int

const (
	notifyDropped notifyKind = iota
	notifyReconnected
)

type notifyText struct{ dropped, droppedBody, reconnected string }

// notifyTexts are the notifications in each language the UI offers. Like the
// tray menu, they are shown by Go, outside the webview's translations.
var notifyTexts = map[string]notifyText{
	"en": {"Connection lost", "NuggetVPN is reconnecting.", "Reconnected"},
	"ru": {"Соединение потеряно", "NuggetVPN переподключается.", "Подключение восстановлено"},
	"uk": {"З'єднання втрачено", "NuggetVPN перепідключається.", "Підключення відновлено"},
	"zh": {"连接已断开", "NuggetVPN 正在重新连接。", "已重新连接"},
	"ja": {"接続が切れました", "NuggetVPN が再接続しています。", "再接続しました"},
	"fa": {"اتصال قطع شد", "NuggetVPN در حال اتصال دوباره است.", "دوباره متصل شد"},
}

// notify shows a system notification, when the user has them on. A
// notification that cannot be shown — no permission, no notification
// daemon — is logged and otherwise ignored: it is never the thing that
// breaks a reconnect.
func (a *App) notify(kind notifyKind) {
	if a.notifier == nil {
		return
	}
	_, settings := a.snapshot()
	if settings.Notifications != nil && !*settings.Notifications {
		return
	}
	a.trayMu.Lock()
	text, ok := notifyTexts[a.trayLanguage]
	a.trayMu.Unlock()
	if !ok {
		text = notifyTexts["en"]
	}

	options := notifications.NotificationOptions{
		ID:       fmt.Sprintf("nuggetvpn-%d", time.Now().UnixNano()),
		ThreadID: "connection",
	}
	switch kind {
	case notifyDropped:
		options.Title, options.Body = text.dropped, text.droppedBody
	case notifyReconnected:
		options.Title = text.reconnected
		a.mu.Lock()
		options.Body = a.state.Profile
		a.mu.Unlock()
	}
	go func() {
		if err := a.notifier.SendNotification(options); err != nil {
			a.appendLog("WARN notification: " + err.Error())
		}
	}()
}

// prepareNotifications asks for permission where the system wants it asked
// (macOS), once at startup, so the first drop is not the moment it asks.
func (a *App) prepareNotifications() {
	if a.notifier == nil {
		return
	}
	_, settings := a.snapshot()
	if settings.Notifications != nil && !*settings.Notifications {
		return
	}
	go func() {
		if granted, err := a.notifier.CheckNotificationAuthorization(); err == nil && !granted {
			_, _ = a.notifier.RequestNotificationAuthorization()
		}
	}()
}

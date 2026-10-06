package app

import (
	"errors"
	"net/url"
	"runtime"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// OpenURL opens a web page in the system browser.
//
// The renderer must never open one itself: a phone has no desktop browser to
// hand the link to, so Wails' browser call fails there, and the renderer's
// fallback — window.open — loads the page in place of the app. Phones hand it
// to the OS instead (an intent on Android, Safari on iOS).
//
// Only web addresses and Telegram links are accepted, so a link from a
// subscription cannot be used to launch some other handler.
func (a *App) OpenURL(link string) error {
	parsed, err := url.Parse(link)
	if err != nil {
		return errors.New("not a web address")
	}
	switch {
	case (parsed.Scheme == "https" || parsed.Scheme == "http") && parsed.Host != "":
	case parsed.Scheme == "tg": // a provider's Telegram, from its support link
	default:
		return errors.New("not a web address")
	}
	switch runtime.GOOS {
	case "android", "ios":
		application.Mobile.OpenURL(parsed.String())
		return nil
	}
	if a.app == nil {
		return errors.New("the app is not running")
	}
	return a.app.Browser.OpenURL(parsed.String())
}

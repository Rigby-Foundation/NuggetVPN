package app

import (
	"net/url"
	"strings"
)

// ---------------------------------------------------------------------------
// nuggetvpn:// links and copied links
// ---------------------------------------------------------------------------

// URLScheme is the app's own link scheme: a subscription page can offer a
// "Add to NuggetVPN" button pointing at
//
//	nuggetvpn://import?url=<the subscription or share link, URL-encoded>
//	nuggetvpn://import/<the same, URL-encoded>
//
// "add", "install-config" and "install-sub" work in place of "import", the
// names other clients use.
const URLScheme = "nuggetvpn"

// importLinkEventName carries a link the app was asked to import.
const importLinkEventName = "import-link"

// shareSchemes are the share-link schemes profiles can be added from.
var shareSchemes = []string{
	"vless://", "vmess://", "trojan://", "ss://", "hysteria://", "hy://", "hysteria2://", "hy2://",
	"tuic://", "wireguard://", "wg://", "socks://", "socks4://", "socks5://", "ssh://",
}

// ImportableLink reports whether text is something the Add dialog takes: a
// share link, or an http(s) address, which is taken as a subscription.
func ImportableLink(text string) bool {
	text = strings.TrimSpace(text)
	if text == "" || strings.ContainsAny(text, "\r\n") || len(text) > 64<<10 {
		return false
	}
	lower := strings.ToLower(text)
	for _, scheme := range shareSchemes {
		if strings.HasPrefix(lower, scheme) {
			return true
		}
	}
	parsed, err := url.Parse(text)
	return err == nil && (parsed.Scheme == "https" || parsed.Scheme == "http") && parsed.Host != ""
}

// ParseDeepLink extracts the link a nuggetvpn:// URL asks to import.
func ParseDeepLink(raw string) (string, bool) {
	raw = strings.TrimSpace(raw)
	if !strings.HasPrefix(strings.ToLower(raw), URLScheme+"://") {
		return "", false
	}
	parsed, err := url.Parse(raw)
	if err != nil {
		return "", false
	}
	switch strings.ToLower(parsed.Host) {
	case "import", "add", "install-config", "install-sub":
	default:
		return "", false
	}
	target := parsed.Query().Get("url")
	if target == "" {
		// nuggetvpn://import/<encoded link>
		path := strings.TrimPrefix(parsed.EscapedPath(), "/")
		if decoded, err := url.PathUnescape(path); err == nil {
			target = decoded
		}
	}
	target = strings.TrimSpace(target)
	if !ImportableLink(target) {
		return "", false
	}
	return target, true
}

// receiveLinks looks through launch arguments or a launch URL for a
// nuggetvpn:// link and hands it to the window. The link is never imported
// here: the window shows it in the Add dialog, and the user confirms.
func (a *App) receiveLinks(candidates ...string) {
	for _, candidate := range candidates {
		target, ok := ParseDeepLink(candidate)
		if !ok {
			continue
		}
		a.mu.Lock()
		a.pendingLink = target
		a.mu.Unlock()
		a.emit(importLinkEventName, target)
		a.ShowWindow()
		return
	}
}

// ReceiveLaunchArgs hands a launch's arguments or URL to the app: a second
// launch's arguments are how a nuggetvpn:// link reaches the copy already
// running. A function rather than a method, so it is not callable from the
// window.
func ReceiveLaunchArgs(a *App, args []string) {
	a.receiveLinks(args...)
}

// TakePendingLink returns, once, a link the app was launched with before the
// window was listening for it.
func (a *App) TakePendingLink() string {
	a.mu.Lock()
	defer a.mu.Unlock()
	link := a.pendingLink
	a.pendingLink = ""
	return link
}

// ReadClipboardLink returns the clipboard's text when it is something the
// Add dialog takes, so the window can offer to import a link the user has
// just copied. Anything else stays unread by the window.
func (a *App) ReadClipboardLink() string {
	if a.app == nil {
		return ""
	}
	text, ok := a.app.Clipboard.Text()
	if !ok {
		return ""
	}
	text = strings.TrimSpace(text)
	if target, ok := ParseDeepLink(text); ok {
		return target
	}
	if !ImportableLink(text) {
		return ""
	}
	return text
}

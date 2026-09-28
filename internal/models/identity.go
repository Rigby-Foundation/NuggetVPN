package models

import (
	"crypto/rand"
	"encoding/hex"
	"regexp"
	"runtime"
	"strings"
)

// Subscription request identity.
//
// Some panels gate the subscription endpoint on who is asking. Remnawave's
// optional device limit counts devices by an `x-hwid` header and refuses the
// request outright without one, and providers on several panels reject clients
// whose User-Agent they do not recognise. Neither is a security control — the
// subscription URL is the secret — so being able to present as a known client
// is what makes those subscriptions usable here at all.
//
// See https://docs.rw/features/hwid-device-limit/

// DefaultUserAgent identifies this app honestly, and is what a provider that
// does not care will see.
const DefaultUserAgent = "NuggetVPN/1.0"

// HappUserAgent presents as Happ, whose format is `Happ/<version>`. Providers
// that allow-list clients almost always allow this one.
const HappUserAgent = "Happ/3.13.0"

// hwidPattern is the format Remnawave validates against from panel v3.0.0:
// 10 to 64 characters, Latin letters, digits, "=" and "-".
var hwidPattern = regexp.MustCompile(`^[a-zA-Z0-9=-]{10,64}$`)

// ValidHWID reports whether a hardware id would be accepted.
func ValidHWID(value string) bool {
	return hwidPattern.MatchString(value)
}

// NewHWID returns a fresh random identifier in the accepted format.
//
// It is random rather than derived from real hardware: the panel only needs a
// value that is stable for this installation, and a genuine machine serial
// would be a far more identifying thing to hand a third party.
func NewHWID() string {
	buffer := make([]byte, 16)
	if _, err := rand.Read(buffer); err != nil {
		// Only reachable if the system entropy source fails, in which case a
		// fixed-shape fallback is still better than an empty header.
		return "nuggetvpn-0000000000000000"
	}
	return hex.EncodeToString(buffer)
}

// defaultDeviceOS names the platform the way a client would report it.
func defaultDeviceOS() string {
	switch runtime.GOOS {
	case "windows":
		return "Windows"
	case "darwin":
		return "macOS"
	case "linux":
		return "Linux"
	default:
		return strings.ToUpper(runtime.GOOS[:1]) + runtime.GOOS[1:]
	}
}

// normalizeIdentity fills in the subscription identity on first load.
func (s *AppSettings) normalizeIdentity() {
	if strings.TrimSpace(s.SubscriptionUserAgent) == "" {
		s.SubscriptionUserAgent = DefaultUserAgent
	}
	if s.HWIDEnabled == nil {
		// On by default: a panel with the device limit switched on answers 404
		// without the header, which reads as a broken subscription rather than
		// a missing setting. The value is random and per-installation, and the
		// subscription URL already identifies the user to that provider.
		enabled := true
		s.HWIDEnabled = &enabled
	}
	if !ValidHWID(s.HWID) {
		s.HWID = NewHWID()
	}
	if strings.TrimSpace(s.DeviceOS) == "" {
		s.DeviceOS = defaultDeviceOS()
	}
	if strings.TrimSpace(s.DeviceModel) == "" {
		s.DeviceModel = "Desktop"
	}
}

// HWIDOn reports whether the device headers should be sent.
func (s AppSettings) HWIDOn() bool {
	return s.HWIDEnabled == nil || *s.HWIDEnabled
}

// SubscriptionHeaders returns the headers to send when fetching a
// subscription. Only x-hwid is required by Remnawave; the rest let the panel
// show the user something more useful than an opaque id in its device list.
func (s AppSettings) SubscriptionHeaders() map[string]string {
	headers := map[string]string{
		"User-Agent": strings.TrimSpace(s.SubscriptionUserAgent),
	}
	if headers["User-Agent"] == "" {
		headers["User-Agent"] = DefaultUserAgent
	}
	if !s.HWIDOn() {
		return headers
	}

	// A malformed id is worse than none: the panel rejects the request rather
	// than ignoring the header.
	if ValidHWID(s.HWID) {
		headers["x-hwid"] = s.HWID
	}
	if value := strings.TrimSpace(s.DeviceOS); value != "" {
		headers["x-device-os"] = value
	}
	if value := strings.TrimSpace(s.DeviceOSVersion); value != "" {
		headers["x-ver-os"] = value
	}
	if value := strings.TrimSpace(s.DeviceModel); value != "" {
		headers["x-device-model"] = value
	}
	return headers
}

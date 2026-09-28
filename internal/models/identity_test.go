package models

import (
	"strings"
	"testing"
)

// The header names and the HWID format here are a contract with the panel, not
// a local convention: Remnawave validates x-hwid against a regex and answers
// 404 when the device limit is on and the header is missing. Getting either
// wrong looks to the user like a dead subscription, so it is pinned.
//
// https://docs.rw/features/hwid-device-limit/

func TestSubscriptionHeadersUseThePanelNames(t *testing.T) {
	settings := DefaultSettings()
	settings.Normalize()

	headers := settings.SubscriptionHeaders()

	for _, name := range []string{"x-hwid", "x-device-os", "x-device-model"} {
		if headers[name] == "" {
			t.Errorf("missing %s header: %v", name, headers)
		}
	}
	if headers["User-Agent"] == "" {
		t.Error("a request with no User-Agent is what providers block")
	}
	if !ValidHWID(headers["x-hwid"]) {
		t.Errorf("generated x-hwid %q is not in the accepted format", headers["x-hwid"])
	}
}

// TestHWIDFormat pins the rule from panel v3.0.0: 10-64 characters of Latin
// letters, digits, "=" and "-".
func TestHWIDFormat(t *testing.T) {
	accepted := []string{
		"0123456789",
		strings.Repeat("a", 64),
		"AbC-123=xyz",
		"aaaaaaaaaa==",
	}
	for _, value := range accepted {
		if !ValidHWID(value) {
			t.Errorf("ValidHWID(%q) = false, want true", value)
		}
	}

	rejected := []string{
		"",
		"tooshort9",                 // 9 characters
		strings.Repeat("a", 65),     // one over
		"has spaces here",           // space
		"underscores_are_not_listed", // underscore
		"emoji-🔒-here",              // non-Latin
		"slash/es",
	}
	for _, value := range rejected {
		if ValidHWID(value) {
			t.Errorf("ValidHWID(%q) = true, want false", value)
		}
	}
}

// TestGeneratedHWIDIsAcceptable checks the generator against the same rule,
// since an id the panel rejects is worse than none — it fails the request
// rather than being ignored.
func TestGeneratedHWIDIsAcceptable(t *testing.T) {
	seen := map[string]bool{}
	for range 50 {
		value := NewHWID()
		if !ValidHWID(value) {
			t.Fatalf("NewHWID() produced %q, which the panel would reject", value)
		}
		if seen[value] {
			t.Fatalf("NewHWID() repeated %q", value)
		}
		seen[value] = true
	}
}

// TestHWIDIsStableAcrossNormalize guards the identity the panel counts devices
// by: regenerating it on every load would burn a device slot each launch.
func TestHWIDIsStableAcrossNormalize(t *testing.T) {
	settings := DefaultSettings()
	settings.Normalize()
	first := settings.HWID

	for range 5 {
		settings.Normalize()
	}
	if settings.HWID != first {
		t.Errorf("HWID changed across Normalize: %q then %q", first, settings.HWID)
	}
}

// TestMalformedHWIDIsReplaced covers a hand-edited settings.json. Sending a
// value that fails the panel's regex gets the whole request refused.
func TestMalformedHWIDIsReplaced(t *testing.T) {
	settings := DefaultSettings()
	settings.HWID = "not valid!"
	settings.Normalize()

	if !ValidHWID(settings.HWID) {
		t.Errorf("Normalize left an unusable HWID: %q", settings.HWID)
	}
}

// TestHWIDCanBeTurnedOff checks the opt-out actually removes the device
// headers, and leaves the User-Agent alone.
func TestHWIDCanBeTurnedOff(t *testing.T) {
	settings := DefaultSettings()
	settings.Normalize()
	disabled := false
	settings.HWIDEnabled = &disabled

	headers := settings.SubscriptionHeaders()
	for _, name := range []string{"x-hwid", "x-device-os", "x-ver-os", "x-device-model"} {
		if _, present := headers[name]; present {
			t.Errorf("%s was still sent with the device id turned off", name)
		}
	}
	if headers["User-Agent"] == "" {
		t.Error("turning off the device id must not drop the User-Agent")
	}
}

func TestUserAgentIsConfigurable(t *testing.T) {
	settings := DefaultSettings()
	settings.SubscriptionUserAgent = HappUserAgent
	settings.Normalize()

	if got := settings.SubscriptionHeaders()["User-Agent"]; got != HappUserAgent {
		t.Errorf("User-Agent = %q, want %q", got, HappUserAgent)
	}
	if !strings.HasPrefix(HappUserAgent, "Happ/") {
		t.Errorf("the Happ preset must keep the Happ/<version> shape, got %q", HappUserAgent)
	}

	// An empty value must not produce a header-less request.
	settings.SubscriptionUserAgent = "   "
	settings.Normalize()
	if got := settings.SubscriptionHeaders()["User-Agent"]; got != DefaultUserAgent {
		t.Errorf("blank User-Agent fell back to %q, want %q", got, DefaultUserAgent)
	}
}

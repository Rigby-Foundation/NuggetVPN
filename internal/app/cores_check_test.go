package app

import (
	"github.com/Rigby-Foundation/NuggetVPN/internal/models"
	"testing"
)

func TestCheckProfileUsesOnlyXray(t *testing.T) {
	settings := models.DefaultSettings()
	for _, test := range []struct {
		link string
		ok   bool
	}{
		{"vless://9d4f4c4e-2b0a-4f43-9a7d-3c4b8c9a1e21@example.com:443?type=xhttp&security=tls&sni=example.com&path=%2Fx#XHTTP", true},
		{"tuic://9d4f4c4e-2b0a-4f43-9a7d-3c4b8c9a1e21:password@example.com:443#TUIC", false},
	} {
		err := checkProfile(settings, models.Profile{Name: "test", ConfigLink: test.link})
		if (err == nil) != test.ok {
			t.Errorf("%s: %v, supported=%v", test.link, err, test.ok)
		}
	}
}

package app

import (
	"testing"

	"github.com/Rigby-Foundation/NuggetVPN/internal/models"
)

// TestCheckProfileMatchesEachCore pins down what the GUI greys out per core:
// the same servers each core would refuse on connect.
func TestCheckProfileMatchesEachCore(t *testing.T) {
	hysteria := models.Profile{ID: "hy", Name: "Hysteria", ConfigLink: "hysteria2://secret@example.com:443?sni=example.com#Hysteria"}
	xhttp := models.Profile{ID: "xh", Name: "XHTTP", ConfigLink: "vless://9d4f4c4e-2b0a-4f43-9a7d-3c4b8c9a1e21@example.com:443?type=xhttp&security=tls&sni=example.com&path=%2Fx#XHTTP"}

	cases := []struct {
		core                string
		hysteriaOK, xhttpOK bool
	}{
		{models.CoreBuiltin, true, true},
		{models.CoreSingBox, true, false},
		{models.CoreXray, false, true},
		{models.CoreMihomo, true, true},
	}
	for _, c := range cases {
		settings := models.AppSettings{Core: c.core}
		if err := checkProfile(settings, hysteria); (err == nil) != c.hysteriaOK {
			t.Errorf("%s, Hysteria2: got %v, want supported=%v", c.core, err, c.hysteriaOK)
		}
		if err := checkProfile(settings, xhttp); (err == nil) != c.xhttpOK {
			t.Errorf("%s, XHTTP: got %v, want supported=%v", c.core, err, c.xhttpOK)
		}
	}
}

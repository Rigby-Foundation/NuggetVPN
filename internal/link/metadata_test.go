package link

import (
	"encoding/base64"
	"net/url"
	"testing"

	"github.com/Rigby-Foundation/NuggetVPN/internal/models"
)

func TestServerDescriptionMetadata(t *testing.T) {
	description := "Лучший сервер автоматически • VLESS"
	for _, encoding := range []*base64.Encoding{base64.StdEncoding, base64.RawStdEncoding, base64.URLEncoding, base64.RawURLEncoding} {
		encoded := encoding.EncodeToString([]byte(description))
		for _, raw := range []string{
			"vless://id@example.com:443#" + url.PathEscape("🇪🇺 Auto?serverDescription="+encoded),
			"vless://id@example.com:443?serverDescription=" + url.QueryEscape(encoded) + "#Auto",
		} {
			if got := ExtractDescription(raw); got != description {
				t.Errorf("description = %q, want %q", got, description)
			}
			if got := ExtractName(raw); got != "Auto" && got != "🇪🇺 Auto" {
				t.Errorf("name contains metadata: %q", got)
			}
		}
	}
}

func TestExistingProfileDescriptionMigration(t *testing.T) {
	description := "Fast connection"
	profile := models.Profile{ID: "saved", Name: "Auto?serverDescription=" + base64.StdEncoding.EncodeToString([]byte(description)), ConfigLink: "vless://id@example.com:443#Auto", Favorite: true}
	if !NormalizeProfileMetadata(&profile) {
		t.Fatal("metadata was not upgraded")
	}
	if profile.Name != "Auto" || profile.Description != description || profile.ID != "saved" || !profile.Favorite {
		t.Fatalf("migration changed identity or lost metadata: %+v", profile)
	}
	if NormalizeProfileMetadata(&profile) {
		t.Fatal("normalization is not idempotent")
	}
	profile.Name = "My custom label"
	NormalizeProfileMetadata(&profile)
	if profile.Name != "My custom label" || profile.Description != description {
		t.Fatal("custom name or existing description was lost")
	}
}

func TestDescriptionPlainTextAndMalformedEncoding(t *testing.T) {
	raw := "vless://id@example.com:443#Auto?serverDescription=Fast%20%26%20private&other=1"
	if got := ExtractDescription(raw); got != "Fast & private" {
		t.Errorf("encoded delimiter in description was lost: %q", got)
	}
	for _, label := range []string{"Auto?serverDescription=Fast%20server", "Auto?serverDescription=Fast server"} {
		name, description := ProfileLabel(label)
		if name != "Auto" || description != "Fast server" {
			t.Errorf("metadata = %q, %q", name, description)
		}
	}
	name, _ := ProfileLabel("Auto?serverDescription=%%%")
	if name != "Auto" {
		t.Fatal("invalid metadata leaked into the display name")
	}
	name, description := ProfileLabel("Why? A normal server name")
	if name != "Why? A normal server name" || description != "" {
		t.Fatal("ordinary punctuation was treated as metadata")
	}
}

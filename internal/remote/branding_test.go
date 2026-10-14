package remote

import (
	"encoding/base64"
	"net/http"
	"testing"
	"time"
)

func TestBrandingHeaders(t *testing.T) {
	headers := http.Header{}
	headers.Set("Icon-Url", "https://provider.example/logo.webp")
	headers.Set("Banner-Image", "https://provider.example/card.svg")
	headers.Set("Banner-Color", "#6C5CE7")
	headers.Set("Community-Url", "https://t.me/provider")
	headers.Set("Support-Url", "https://t.me/provider") // the same link twice is fine
	headers.Set("Banner-Url", "https://t.me/provider_news")
	info := ParseSubscriptionInfo(headers, time.Now())
	if info == nil {
		t.Fatal("no info")
	}
	want := map[string]string{
		"icon": "https://provider.example/logo.webp", "image": "https://provider.example/card.svg",
		"color": "#6C5CE7", "community": "https://t.me/provider", "support": "https://t.me/provider",
		"announce": "https://t.me/provider_news",
	}
	got := map[string]string{
		"icon": info.IconURL, "image": info.BannerImage, "color": info.BannerColor,
		"community": info.CommunityURL, "support": info.SupportURL, "announce": info.AnnounceURL,
	}
	for key, value := range want {
		if got[key] != value {
			t.Errorf("%s = %q, want %q", key, got[key], value)
		}
	}
}

func TestBeamBrandingWinsAndBadValuesAreDropped(t *testing.T) {
	json := `{"iconUrl":"https://cdn.example/a.png","bannerText":"Привет","bannerColor":"rgb(10, 20, 30)",` +
		`"bannerImage":"http://cdn.example/clear.png","supportUrl":"javascript:alert(1)","communityUrl":"tg://resolve?domain=x"}`
	headers := http.Header{}
	headers.Set("Beam-Branding", base64.StdEncoding.EncodeToString([]byte(json)))
	headers.Set("Icon-Url", "https://old.example/logo.png")
	headers.Set("Banner-Color", "red;background:url(x)")
	info := ParseSubscriptionInfo(headers, time.Now())
	if info == nil {
		t.Fatal("no info")
	}
	if info.IconURL != "https://cdn.example/a.png" {
		t.Errorf("icon = %q, want the Beam-Branding one", info.IconURL)
	}
	if info.Announce != "Привет" || info.BannerColor != "rgb(10, 20, 30)" {
		t.Errorf("announce %q, colour %q", info.Announce, info.BannerColor)
	}
	if info.BannerImage != "" || info.SupportURL != "" {
		t.Errorf("an http image (%q) or a javascript: link (%q) got through", info.BannerImage, info.SupportURL)
	}
	if info.CommunityURL != "tg://resolve?domain=x" {
		t.Errorf("community = %q", info.CommunityURL)
	}
}

func TestBrandingFromBodyLines(t *testing.T) {
	body := "#icon-url: https://provider.example/logo.png\n#banner-color: teal\nvless://x@example.com:443#a\n"
	info := ParseSubscriptionInfoWithBody(nil, body, time.Now())
	if info == nil || info.IconURL != "https://provider.example/logo.png" || info.BannerColor != "teal" {
		t.Fatalf("body branding not read: %+v", info)
	}
}

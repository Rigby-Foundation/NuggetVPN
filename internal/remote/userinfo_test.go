package remote

import (
	"encoding/base64"
	"net/http"
	"testing"
	"time"

	"github.com/Rigby-Foundation/NuggetVPN/internal/models"
)

func TestParseSubscriptionInfo(t *testing.T) {
	headers := http.Header{}
	headers.Set("subscription-userinfo", "upload=1024; download=2048; total=1.073741824e+10; expire=1767225600")
	headers.Set("profile-title", "base64:0JzQvtC5IFZQTg==")
	headers.Set("support-url", "https://t.me/provider")
	headers.Set("profile-web-page-url", "javascript:alert(1)")

	info := ParseSubscriptionInfo(headers, time.Unix(100, 0))
	if info == nil {
		t.Fatal("no info parsed")
	}
	want := models.SubscriptionInfo{
		Upload: 1024, Download: 2048, Total: 10737418240, Expire: 1767225600,
		Title: "Мой VPN", SupportURL: "https://t.me/provider", UpdatedAt: 100,
	}
	if *info != want {
		t.Errorf("got %+v\nwant %+v", *info, want)
	}
	if ParseSubscriptionInfo(http.Header{}, time.Now()) != nil {
		t.Error("a response without the headers has no info")
	}
}

func TestRefreshKeepsFavoritesAndInfo(t *testing.T) {
	info := &models.SubscriptionInfo{Total: 5}
	previous := []models.Profile{{ID: "a", Name: "One", ConfigLink: "vless://1", Favorite: true, SubscriptionInfo: info}}
	fresh := []models.Profile{{ID: "new", Name: "One", ConfigLink: "vless://1"}}
	kept := KeepIdentities(previous, fresh)
	if kept[0].ID != "a" || !kept[0].Favorite || kept[0].SubscriptionInfo != info {
		t.Errorf("refresh lost the favourite or the info: %+v", kept[0])
	}
}

func TestAnnounceFromHeaderAndBody(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	message := "⚪ Белый интернет доступен\n🚫 — сервера без шифрования"
	encoded := "base64:" + base64.StdEncoding.EncodeToString([]byte(message))

	headers := http.Header{}
	headers.Set("Announce", encoded)
	headers.Set("Announce-Url", "https://t.me/provider")
	info := ParseSubscriptionInfo(headers, now)
	if info == nil || info.Announce != message || info.AnnounceURL != "https://t.me/provider" {
		t.Fatalf("header announce: got %+v", info)
	}

	body := "#profile-title: Provider\n#announce: Plain text from the body\nvless://id@example.com:443#a\n#announce: too late, after a link\n"
	info = ParseSubscriptionInfoWithBody(nil, body, now)
	if info == nil || info.Announce != "Plain text from the body" || info.Title != "Provider" {
		t.Fatalf("body announce: got %+v", info)
	}

	// A header wins over the same line in the body.
	info = ParseSubscriptionInfoWithBody(headers, body, now)
	if info.Announce != message {
		t.Fatalf("header should win: got %q", info.Announce)
	}

	headers.Set("Announce-Url", "javascript:alert(1)")
	if info := ParseSubscriptionInfo(headers, now); info.AnnounceURL != "" {
		t.Fatalf("unsafe announce link kept: %q", info.AnnounceURL)
	}
}

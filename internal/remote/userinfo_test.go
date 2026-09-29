package remote

import (
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

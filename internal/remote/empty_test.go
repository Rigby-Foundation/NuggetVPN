package remote

import (
	"encoding/base64"
	"net/http"
	"strings"
	"testing"
	"time"
)

func TestEmptySubscriptionExplainsExpiredPlan(t *testing.T) {
	// What a provider sends once a plan has run out: one placeholder whose
	// name is the message, base64 as usual, and an expiry in the past.
	body := base64.StdEncoding.EncodeToString([]byte(
		"vless://00000000-0000-0000-0000-000000000000@0.0.0.0:1?encryption=none#%D0%9F%D0%BE%D0%B4%D0%BF%D0%B8%D1%81%D0%BA%D0%B0%20%D0%B8%D1%81%D1%82%D0%B5%D0%BA%D0%BB%D0%B0\n"))
	now := time.Date(2026, 10, 2, 12, 0, 0, 0, time.UTC)
	headers := http.Header{}
	headers.Set("Subscription-Userinfo", "upload=0; download=0; total=0; expire=1790812800")

	if links := SubscriptionLinks(body); len(links) != 0 {
		t.Fatalf("placeholder kept as a server: %v", links)
	}
	message := emptySubscription("foxkey.link", body, headers, now).Error()
	for _, want := range []string{"foxkey.link lists no servers right now", "expired on", "Подписка истекла"} {
		if !strings.Contains(message, want) {
			t.Errorf("message %q lacks %q", message, want)
		}
	}
	if strings.Contains(message, "dmxlc3M6") {
		t.Errorf("message still quotes the base64 body: %q", message)
	}
}

func TestEmptySubscriptionPreviewIsDecoded(t *testing.T) {
	body := base64.StdEncoding.EncodeToString([]byte("not a link at all"))
	message := emptySubscription("example.com", body, nil, time.Now()).Error()
	if !strings.Contains(message, "not a link at all") {
		t.Errorf("preview not decoded: %q", message)
	}
}

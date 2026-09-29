package remote

import (
	"encoding/base64"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/Rigby-Foundation/NuggetVPN/internal/models"
)

// ParseSubscriptionInfo reads what a subscription says about itself in its
// response headers, as the common panels (Marzban, 3x-ui, Remnawave) and
// clients (Clash, Happ, v2rayN) agree on:
//
//	subscription-userinfo: upload=123; download=456; total=789; expire=1767225600
//	profile-title: base64:TXkgVlBO           (or plain text)
//	support-url: https://t.me/provider
//	profile-web-page-url: https://provider.example/account
//
// It returns nil when the response carries none of it.
func ParseSubscriptionInfo(headers http.Header, now time.Time) *models.SubscriptionInfo {
	if headers == nil {
		return nil
	}
	info := &models.SubscriptionInfo{}
	found := false

	if raw := headers.Get("Subscription-Userinfo"); raw != "" {
		for _, part := range strings.Split(raw, ";") {
			key, value, ok := strings.Cut(strings.TrimSpace(part), "=")
			if !ok {
				continue
			}
			// Some panels send decimals ("total=1.073741824e+11").
			number, err := strconv.ParseFloat(strings.TrimSpace(value), 64)
			if err != nil || number < 0 {
				continue
			}
			switch strings.ToLower(strings.TrimSpace(key)) {
			case "upload":
				info.Upload, found = int64(number), true
			case "download":
				info.Download, found = int64(number), true
			case "total":
				info.Total, found = int64(number), true
			case "expire":
				info.Expire, found = int64(number), true
			}
		}
	}
	if title := decodeTitle(headers.Get("Profile-Title")); title != "" {
		info.Title, found = title, true
	}
	for header, target := range map[string]*string{
		"Support-Url":          &info.SupportURL,
		"Profile-Web-Page-Url": &info.WebPageURL,
	} {
		if value := strings.TrimSpace(headers.Get(header)); safeLink(value) {
			*target, found = value, true
		}
	}
	if !found {
		return nil
	}
	info.UpdatedAt = now.Unix()
	return info
}

// decodeTitle reads a profile-title, which is either plain text or
// "base64:" followed by the UTF-8 title encoded — the only way to send a
// non-ASCII name in a header.
func decodeTitle(raw string) string {
	raw = strings.TrimSpace(raw)
	if encoded, ok := strings.CutPrefix(raw, "base64:"); ok {
		decoded, err := base64.StdEncoding.DecodeString(strings.TrimSpace(encoded))
		if err != nil {
			decoded, err = base64.RawStdEncoding.DecodeString(strings.TrimSpace(encoded))
		}
		if err != nil {
			return ""
		}
		raw = string(decoded)
	}
	raw = strings.TrimSpace(raw)
	if len([]rune(raw)) > 80 {
		raw = string([]rune(raw)[:80])
	}
	return raw
}

// safeLink accepts the links a support button may open: web pages and
// Telegram. Anything else — javascript:, file: — is dropped.
func safeLink(value string) bool {
	parsed, err := url.Parse(value)
	if err != nil || parsed.Host == "" && parsed.Scheme != "tg" {
		return false
	}
	switch parsed.Scheme {
	case "https", "http", "tg":
		return true
	}
	return false
}

// attachInfo records a subscription's info on each of its profiles.
func attachInfo(profiles []models.Profile, info *models.SubscriptionInfo) {
	for index := range profiles {
		profiles[index].SubscriptionInfo = info
	}
}

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
//	announce: base64:0J/RgNC40LLQtdGC         (or plain text)
//	announce-url: https://t.me/provider_news
//
// It returns nil when the response carries none of it.
func ParseSubscriptionInfo(headers http.Header, now time.Time) *models.SubscriptionInfo {
	return ParseSubscriptionInfoWithBody(headers, "", now)
}

// ParseSubscriptionInfoWithBody also reads the same fields from "#key: value"
// lines at the top of the body, where panels that cannot set headers put
// them (Happ reads them there too). A header wins over the same body line.
func ParseSubscriptionInfoWithBody(headers http.Header, body string, now time.Time) *models.SubscriptionInfo {
	if headers == nil {
		headers = http.Header{}
	}
	for key, value := range bodyDirectives(body) {
		if headers.Get(key) == "" {
			headers = headers.Clone()
			headers.Set(key, value)
		}
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
	if title := decodeText(headers.Get("Profile-Title"), 80); title != "" {
		info.Title, found = title, true
	}
	if announce := decodeText(headers.Get("Announce"), 1000); announce != "" {
		info.Announce, found = announce, true
	}
	for header, target := range map[string]*string{
		"Support-Url":          &info.SupportURL,
		"Profile-Web-Page-Url": &info.WebPageURL,
		"Announce-Url":         &info.AnnounceURL,
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

// decodeText reads a profile-title or an announce, which is either plain
// text or "base64:" followed by the UTF-8 text encoded — the only way to send
// non-ASCII text, or more than one line, in a header. It is cut to limit
// characters.
func decodeText(raw string, limit int) string {
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
	raw = strings.TrimSpace(strings.ReplaceAll(raw, "\r\n", "\n"))
	if len([]rune(raw)) > limit {
		raw = string([]rune(raw)[:limit])
	}
	return raw
}

// bodyDirectives reads "#key: value" lines from the top of a subscription
// body, before its first link, for the keys a header would carry.
func bodyDirectives(body string) map[string]string {
	known := map[string]bool{
		"profile-title": true, "announce": true, "announce-url": true,
		"support-url": true, "profile-web-page-url": true, "subscription-userinfo": true,
	}
	result := map[string]string{}
	for _, line := range strings.Split(decodeSubscriptionBody(body), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		if !strings.HasPrefix(line, "#") {
			break
		}
		key, value, ok := strings.Cut(strings.TrimPrefix(line, "#"), ":")
		key = strings.ToLower(strings.TrimSpace(key))
		if ok && known[key] {
			result[key] = strings.TrimSpace(value)
		}
	}
	return result
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

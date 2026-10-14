package remote

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/url"
	"regexp"
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
//	community-url: https://t.me/provider_channel
//	icon-url: https://provider.example/logo.webp
//	banner-image: https://provider.example/card.svg
//	banner-color: #6C5CE7
//	banner-url: https://t.me/provider_news       (the same as announce-url)
//
// The branding ones are also read all at once from Beam-Branding, base64
// JSON with the keys iconUrl, bannerText, bannerUrl, bannerColor,
// bannerImage, webPageUrl, supportUrl and communityUrl, as BEAM reads it, so
// a provider set up for one client needs nothing more for this one. It wins
// over the single headers. A value that is not valid is dropped and the rest
// kept.
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
	branding := decodeBranding(headers.Get("Beam-Branding"))
	if announce := decodeText(branding.BannerText, 1000); announce != "" {
		info.Announce, found = announce, true
	}
	pick := func(fromBranding, header string) string {
		if value := strings.TrimSpace(fromBranding); value != "" {
			return value
		}
		return strings.TrimSpace(headers.Get(header))
	}
	announceURL := strings.TrimSpace(headers.Get("Announce-Url"))
	if announceURL == "" {
		announceURL = pick(branding.BannerURL, "Banner-Url")
	} else if branding.BannerURL != "" {
		announceURL = branding.BannerURL
	}
	for _, link := range []struct {
		value  string
		target *string
	}{
		{pick(branding.SupportURL, "Support-Url"), &info.SupportURL},
		{pick(branding.WebPageURL, "Profile-Web-Page-Url"), &info.WebPageURL},
		{pick(branding.CommunityURL, "Community-Url"), &info.CommunityURL},
		{announceURL, &info.AnnounceURL},
	} {
		if safeLink(link.value) {
			*link.target, found = link.value, true
		}
	}
	if value := pick(branding.IconURL, "Icon-Url"); httpsURL(value) {
		info.IconURL, found = value, true
	}
	if value := pick(branding.BannerImage, "Banner-Image"); httpsURL(value) {
		info.BannerImage, found = value, true
	}
	if value := pick(branding.BannerColor, "Banner-Color"); cssColor(value) {
		info.BannerColor, found = value, true
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
		"community-url": true, "icon-url": true, "banner-image": true, "banner-color": true,
		"banner-url": true, "beam-branding": true,
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
	case "mailto":
		return parsed.Opaque != ""
	}
	return false
}

// branding is the Beam-Branding header: the branding fields as base64 JSON.
type branding struct {
	IconURL      string `json:"iconUrl"`
	BannerText   string `json:"bannerText"`
	BannerURL    string `json:"bannerUrl"`
	BannerColor  string `json:"bannerColor"`
	BannerImage  string `json:"bannerImage"`
	WebPageURL   string `json:"webPageUrl"`
	SupportURL   string `json:"supportUrl"`
	CommunityURL string `json:"communityUrl"`
}

func decodeBranding(raw string) branding {
	var result branding
	raw = strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(raw), "base64:"))
	if raw == "" {
		return result
	}
	decoded, err := base64.StdEncoding.DecodeString(raw)
	if err != nil {
		decoded, err = base64.RawStdEncoding.DecodeString(raw)
	}
	if err != nil {
		decoded = []byte(raw) // Some send the JSON as it is.
	}
	_ = json.Unmarshal(decoded, &result)
	return result
}

// httpsURL accepts an image address: https only, so a picture is never
// fetched in the clear, and no data: URLs, which belong in no header.
func httpsURL(value string) bool {
	parsed, err := url.Parse(value)
	return err == nil && parsed.Scheme == "https" && parsed.Host != "" && len(value) <= 2048
}

// cssColorPattern is the colours a banner may be: hex, rgb()/rgba(),
// hsl()/hsla() with plain numbers, or a colour name. Nothing that could
// close the CSS value it is put into.
var cssColorPattern = regexp.MustCompile(`^(#[0-9a-fA-F]{3,8}|(rgb|rgba|hsl|hsla)\([0-9.,%\s/deg]+\)|[a-zA-Z]{3,20})$`)

func cssColor(value string) bool {
	return len(value) <= 64 && cssColorPattern.MatchString(value)
}

// attachInfo records a subscription's info on each of its profiles.
func attachInfo(profiles []models.Profile, info *models.SubscriptionInfo) {
	for index := range profiles {
		profiles[index].SubscriptionInfo = info
	}
}

package link

import (
	"net/url"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/Rigby-Foundation/Kage/internal/models"
)

// ServerDescription is provider metadata, sometimes appended after the link's
// fragment instead of in its query. It must never become part of a server name.
func descriptionParameter(text string) (string, bool) {
	for _, pair := range strings.Split(text, "&") {
		key, value, found := strings.Cut(pair, "=")
		key, _ = url.QueryUnescape(key)
		if found && strings.EqualFold(key, "serverDescription") {
			return DecodeProfileName(value), true
		}
	}
	return "", false
}

func decodeDescription(value string) string {
	if len(value) > 16384 {
		return ""
	}
	if decoded, err := decodeBase64(value); err == nil && utf8.Valid(decoded) {
		valid := true
		for _, char := range string(decoded) {
			if unicode.IsControl(char) && char != '\n' && char != '\t' && char != '\r' {
				valid = false
				break
			}
		}
		if valid {
			value = string(decoded)
		}
	}
	if !utf8.ValidString(value) {
		return ""
	}
	return strings.TrimSpace(value)
}

// ProfileLabel separates a provider's display name and optional description.
func ProfileLabel(value string) (string, string) {
	if name, description, found := profileLabelMetadata(value); found {
		return name, description
	}
	return strings.TrimSpace(DecodeProfileName(value)), ""
}

func profileLabelMetadata(value string) (string, string, bool) {
	for attempt := 0; attempt <= 4; attempt++ {
		if name, description, found := splitProfileLabel(value); found {
			return name, description, true
		}
		decoded, err := url.PathUnescape(value)
		if err != nil || decoded == value {
			break
		}
		value = decoded
	}
	return "", "", false
}

func splitProfileLabel(value string) (string, string, bool) {
	for index, char := range value {
		if char != '?' && char != '&' {
			continue
		}
		if description, found := descriptionParameter(value[index+1:]); found {
			return strings.TrimSpace(DecodeProfileName(value[:index])), decodeDescription(description), true
		}
	}
	return "", "", false
}

// ExtractDescription accepts normal query metadata and the fragment convention
// used by subscription providers, including standard and URL-safe base64 UTF-8.
func ExtractDescription(raw string) string {
	raw = strings.TrimSpace(strings.ReplaceAll(raw, "&amp;", "&"))
	parsed, err := url.Parse(raw)
	if err != nil {
		return ""
	}
	_, fragment, _ := strings.Cut(raw, "#")
	if _, description := ProfileLabel(fragment); description != "" {
		return description
	}
	if value, found := descriptionParameter(parsed.RawQuery); found {
		return decodeDescription(value)
	}
	if name, ok := nameFromVMessLink(raw); ok {
		_, description := ProfileLabel(name)
		return description
	}
	return ""
}

// NormalizeProfileMetadata upgrades existing saved labels without changing IDs,
// subscription addresses, or the original share link.
func NormalizeProfileMetadata(profile *models.Profile) bool {
	name, savedDescription, found := profileLabelMetadata(profile.Name)
	if !found {
		name = profile.Name
	}
	description := ExtractDescription(profile.ConfigLink)
	if description == "" {
		description = savedDescription
	}
	if description == "" {
		description = profile.Description
	}
	changed := profile.Name != name || profile.Description != description
	profile.Name, profile.Description = name, description
	return changed
}

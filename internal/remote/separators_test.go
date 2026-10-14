package remote

import (
	"encoding/base64"
	"net/url"
	"testing"
)

func TestSeparatorsBecomeGroups(t *testing.T) {
	described := func(name, description string) string {
		return "ss://YWVzLTEyOC1nY206eA@127.0.0.1:80#" +
			url.PathEscape(name+"?serverDescription="+base64.StdEncoding.EncodeToString([]byte(description)))
	}
	body := "#profile-title: Test\n" +
		// A message before any server: not a heading.
		"ss://YWVzLTEyOC1nY206eA@127.0.0.1:8080#" + url.PathEscape("⏳ Подписка до 01.01") + "\n" +
		"vless://a@1.1.1.1:443#" + url.PathEscape("Без группы") + "\n" +
		described("⬇️ —WiFi — ⬇️", "Разделитель") + "\n" +
		"vless://b@2.2.2.2:443#" + url.PathEscape("🇩🇪 Германия") + "\n" +
		"hysteria2://c@3.3.3.3:8443#" + url.PathEscape("🇩🇪 Германия ⚡") + "\n" +
		// Drawn as a divider, no description.
		"ss://YWVzLTEyOC1nY206eA@127.0.0.1:80#" + url.PathEscape("⬇️ — Белый интернет — ⬇️") + "\n" +
		"vless://d@4.4.4.4:443#" + url.PathEscape("🇷🇺 Белый интернет #1") + "\n"

	entries := subscriptionEntries(body)
	want := []string{"", "WiFi", "WiFi", "Белый интернет"}
	if len(entries) != len(want) {
		t.Fatalf("got %d entries, want %d: %+v", len(entries), len(want), entries)
	}
	for index, entry := range entries {
		if entry.group != want[index] {
			t.Errorf("entry %d (%s) is in %q, want %q", index, entry.link, entry.group, want[index])
		}
	}
	profiles := buildProfiles(entries, "provider.example", "https://provider.example/sub")
	if len(profiles) != 4 || profiles[1].Group != "WiFi" {
		t.Fatalf("profiles lost their groups: %+v", profiles)
	}
}

func TestMessagesAreNotSeparators(t *testing.T) {
	for _, line := range []string{
		"ss://x@127.0.0.1:8080#" + url.PathEscape("📵 Превышен лимит устройств"),
		"vless://00000000-0000-0000-0000-000000000000@0.0.0.0:1#" + url.PathEscape("Подписка истекла"),
		"ss://x@127.0.0.1:80#" + url.PathEscape("⬇️ — ⬇️"),
	} {
		if name, ok := separatorName(line); ok {
			t.Errorf("%s read as the heading %q", line, name)
		}
	}
}

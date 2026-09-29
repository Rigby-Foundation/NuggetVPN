package app

import "testing"

func TestParseDeepLink(t *testing.T) {
	for input, want := range map[string]string{
		"nuggetvpn://import?url=https%3A%2F%2Fsub.example%2Fs%2Fabc": "https://sub.example/s/abc",
		"nuggetvpn://import/https%3A%2F%2Fsub.example%2Fs%2Fabc":     "https://sub.example/s/abc",
		"NuggetVPN://add?url=vless%3A%2F%2Fid%40host%3A443%23Name":   "vless://id@host:443#Name",
		"nuggetvpn://install-sub?url=https://sub.example/x":          "https://sub.example/x",
	} {
		got, ok := ParseDeepLink(input)
		if !ok || got != want {
			t.Errorf("ParseDeepLink(%q) = %q, %v; want %q", input, got, ok, want)
		}
	}
	for _, bad := range []string{
		"https://sub.example",
		"nuggetvpn://delete?url=https://x.example",
		"nuggetvpn://import?url=javascript:alert(1)",
		"nuggetvpn://import?url=file%3A%2F%2F%2Fetc%2Fpasswd",
		"nuggetvpn://import",
	} {
		if got, ok := ParseDeepLink(bad); ok {
			t.Errorf("ParseDeepLink(%q) accepted %q", bad, got)
		}
	}
}

func TestImportableLink(t *testing.T) {
	for text, want := range map[string]bool{
		"vless://abc@host:443":  true,
		"hy2://pass@host:443":   true,
		"https://sub.example/s": true,
		"just some text":        false,
		"vless://a\nvless://b":  false,
		"ftp://files.example":   false,
	} {
		if got := ImportableLink(text); got != want {
			t.Errorf("ImportableLink(%q) = %v", text, got)
		}
	}
}

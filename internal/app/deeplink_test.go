package app

import "testing"

func TestParseDeepLink(t *testing.T) {
	for input, want := range map[string]string{
		"kage://import?url=https%3A%2F%2Fsub.example%2Fs%3Fa%3Db%26c%3Dd%23name": "https://sub.example/s?a=b&c=d#name",
		"kage://import/https%3A%2F%2Fsub.example%2Fs%2Fabc":                      "https://sub.example/s/abc",
		"KAGE://add?url=vless%3A%2F%2Fid%40host%3A443%23Name":                    "vless://id@host:443#Name",
		"kage://install-config?url=hy2%3A%2F%2Fsecret%40host%3A443":              "hy2://secret@host:443",
		"kage://install-sub?url=https://sub.example/x":                           "https://sub.example/x",
		"nuggetvpn://import?url=https%3A%2F%2Fsub.example%2Fs%2Fabc":             "https://sub.example/s/abc",
		"nuggetvpn://import/https%3A%2F%2Fsub.example%2Fs%2Fabc":                 "https://sub.example/s/abc",
		"NuggetVPN://add?url=vless%3A%2F%2Fid%40host%3A443%23Name":               "vless://id@host:443#Name",
		"nuggetvpn://install-sub?url=https://sub.example/x":                      "https://sub.example/x",
	} {
		got, ok := ParseDeepLink(input)
		if !ok || got != want {
			t.Errorf("ParseDeepLink(%q) = %q, %v; want %q", input, got, ok, want)
		}
	}
	for _, bad := range []string{
		"https://sub.example",
		"kagex://import?url=https://x.example",
		"kage://delete?url=https://x.example",
		"kage://import?url=javascript:alert(1)",
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

func TestLaunchLinkCanBeTakenOnce(t *testing.T) {
	a := &App{}
	ReceiveLaunchArgs(a, []string{"--flag", "kage://import?url=https%3A%2F%2Fsub.example%2Fsubscription"})
	if got := a.TakePendingLink(); got != "https://sub.example/subscription" {
		t.Fatalf("pending import target = %q", got)
	}
	if got := a.TakePendingLink(); got != "" {
		t.Fatalf("import target was delivered twice: %q", got)
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

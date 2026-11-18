package app

import (
	"encoding/json"
	"testing"
)

func TestPickAsset(t *testing.T) {
	var latest release
	if err := json.Unmarshal([]byte(`{"assets":[
		{"name":"Kage-v3.0.0-windows-arm64-silent-installer.exe","size":10,"browser_download_url":"https://github.com/silent"},
		{"name":"Kage-v3.0.0-windows-arm64.zip","size":20,"browser_download_url":"https://github.com/zip"},
		{"name":"Kage-v3.0.0-windows-arm64-installer.exe","size":30,"browser_download_url":"https://github.com/arm64"},
		{"name":"Kage-v3.0.0-windows-amd64-installer.exe","size":40,"browser_download_url":"https://github.com/amd64"},
		{"name":"Kage-v3.0.0-macos-universal.dmg","size":50,"browser_download_url":"https://github.com/macos"}
	]}`), &latest); err != nil {
		t.Fatal(err)
	}
	for _, testCase := range []struct {
		platform, arch, name, link string
		size                       int64
	}{
		{"windows", "arm64", "Kage-v3.0.0-windows-arm64-installer.exe", "https://github.com/arm64", 30},
		{"windows", "amd64", "Kage-v3.0.0-windows-amd64-installer.exe", "https://github.com/amd64", 40},
		{"darwin", "arm64", "Kage-v3.0.0-macos-universal.dmg", "https://github.com/macos", 50},
		{"windows", "386", "", "", 0},
		{"android", "arm64", "", "", 0},
	} {
		t.Run(testCase.platform+"/"+testCase.arch, func(t *testing.T) {
			name, size, link, ok := pickAsset(latest, testCase.platform, testCase.arch)
			if name != testCase.name || size != testCase.size || link != testCase.link || ok != (testCase.name != "") {
				t.Fatalf("pickAsset() = (%q, %d, %q, %v), want (%q, %d, %q, %v)",
					name, size, link, ok, testCase.name, testCase.size, testCase.link, testCase.name != "")
			}
		})
	}

	// An ARM64 install must not receive an x64 installer if the release lacks its target.
	latest.Assets = latest.Assets[3:]
	if name, _, _, ok := pickAsset(latest, "windows", "arm64"); ok {
		t.Fatalf("selected incompatible ARM64 update %q", name)
	}
}

func TestNewerVersion(t *testing.T) {
	for _, testCase := range []struct {
		candidate, current string
		want               bool
	}{
		{"2.0.1", "2.0.0", true},
		{"v2.1.0", "2.0.9", true},
		{"2.0.0", "2.0.0", false},
		{"1.9.9", "2.0.0", false},
		{"2.0.0", "2.0.0-beta.2", true},
		{"2.1.0-beta.1", "2.0.0", true},
		{"2.0.0-beta.3", "2.0.0", false},
		{"10.0.0", "9.9.9", true},
	} {
		if got := newerVersion(testCase.candidate, testCase.current); got != testCase.want {
			t.Errorf("newerVersion(%q, %q) = %v", testCase.candidate, testCase.current, got)
		}
	}
}

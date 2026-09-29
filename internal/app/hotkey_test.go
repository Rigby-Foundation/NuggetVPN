package app

import "testing"

func TestParseHotkey(t *testing.T) {
	for _, good := range []string{"Ctrl+Alt+V", "ctrl+shift+F9", "Super+1", "Alt+F24"} {
		if _, err := parseHotkey(good); err != nil {
			t.Errorf("parseHotkey(%q): %v", good, err)
		}
	}
	for _, bad := range []string{"V", "Shift+V", "Ctrl+Alt+Space", "Ctrl+F25", "Hyper+V", "Ctrl+"} {
		if _, err := parseHotkey(bad); err == nil {
			t.Errorf("parseHotkey(%q) should fail", bad)
		}
	}
	if code, ok := virtualKey("F1"); !ok || code != 0x70 {
		t.Errorf("F1 = %#x", code)
	}
}

package core

import (
	"strings"
	"testing"
)

func TestSanitizeXray(t *testing.T) {
	config := `{"log":{"access":"/etc/x","loglevel":"warning"},"api":{"listen":"0.0.0.0:1"},"inbounds":[{"port":1,"protocol":"socks"}]}`
	out, err := sanitizeXray([]byte(config))
	if err != nil {
		t.Fatal(err)
	}
	text := string(out)
	if strings.Contains(text, "/etc/x") || strings.Contains(text, `"api"`) || !strings.Contains(text, `"listen":"127.0.0.1"`) {
		t.Errorf("config = %s", text)
	}
}

package models

import (
	"encoding/json"
	"testing"
)

func TestLegacyCoreSelectionIsIgnoredAndNotWrittenBack(t *testing.T) {
	for _, legacy := range []string{"builtin", "sing-box", "mihomo", "xray"} {
		var settings AppSettings
		if err := json.Unmarshal([]byte(`{"core":"`+legacy+`","mtu":1500,"dns":"1.1.1.1"}`), &settings); err != nil {
			t.Fatal(err)
		}
		settings.Normalize()
		data, err := json.Marshal(settings)
		if err != nil {
			t.Fatal(err)
		}
		var saved map[string]json.RawMessage
		_ = json.Unmarshal(data, &saved)
		if _, present := saved["core"]; present {
			t.Fatalf("legacy %s core selector survived", legacy)
		}
		if settings.MTU != 1500 {
			t.Fatal("migration changed unrelated settings")
		}
	}
}

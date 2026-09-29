package remote

import (
	"testing"

	"github.com/Rigby-Foundation/NuggetVPN/internal/models"
)

func usage(n uint64) *uint64 { return &n }

func TestRefreshKeepsProfileIdentity(t *testing.T) {
	previous := []models.Profile{
		{ID: "keep-by-link", Name: "Frankfurt", ConfigLink: "vless://a@1.1.1.1:443#Frankfurt", TotalDown: usage(500)},
		{ID: "keep-by-name", Name: "Tokyo", ConfigLink: "vless://old@2.2.2.2:443#Tokyo"},
		{ID: "gone", Name: "Helsinki", ConfigLink: "vless://h@3.3.3.3:443#Helsinki"},
	}
	fresh := []models.Profile{
		{ID: "new-1", Name: "Frankfurt", ConfigLink: "vless://a@1.1.1.1:443#Frankfurt"},
		// The provider rotated this server's credentials; the name stayed.
		{ID: "new-2", Name: "Tokyo", ConfigLink: "vless://rotated@2.2.2.2:8443#Tokyo"},
		{ID: "new-3", Name: "Warsaw", ConfigLink: "vless://w@4.4.4.4:443#Warsaw"},
	}

	kept := KeepIdentities(previous, fresh)

	want := []string{"keep-by-link", "keep-by-name", "new-3"}
	for i, id := range want {
		if kept[i].ID != id {
			t.Errorf("%s: id %q, want %q", kept[i].Name, kept[i].ID, id)
		}
	}
	if kept[0].TotalDown == nil || *kept[0].TotalDown != 500 {
		t.Error("usage totals should carry over with the id")
	}
	if kept[1].ConfigLink != "vless://rotated@2.2.2.2:8443#Tokyo" {
		t.Error("the refreshed link must win; only the identity carries over")
	}
}

func TestRefreshNeverReusesAnIDTwice(t *testing.T) {
	// Two fresh entries with the same name must not both claim one old id.
	previous := []models.Profile{{ID: "only", Name: "Auto", ConfigLink: "a"}}
	fresh := []models.Profile{
		{ID: "n1", Name: "Auto", ConfigLink: "b"},
		{ID: "n2", Name: "Auto", ConfigLink: "c"},
	}
	kept := KeepIdentities(previous, fresh)
	if kept[0].ID == kept[1].ID {
		t.Fatalf("duplicate id %q", kept[0].ID)
	}
}

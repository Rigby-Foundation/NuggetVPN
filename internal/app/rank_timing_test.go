package app

import (
	"fmt"
	"testing"
	"time"

	"github.com/Rigby-Foundation/NuggetVPN/internal/models"
)

// TestRankByLatencyIsBounded checks the worst case: fifty servers that answer
// neither ping nor TCP (a blackholed TEST-NET address). Ranking used to wait
// out every probe; it must now give up at rankBudget.
func TestRankByLatencyIsBounded(t *testing.T) {
	if testing.Short() {
		t.Skip("waits on real network timeouts")
	}
	var candidates []models.Profile
	for i := 0; i < 50; i++ {
		candidates = append(candidates, models.Profile{
			ID:           fmt.Sprintf("p%d", i),
			Name:         fmt.Sprintf("Server %d", i),
			SourceDomain: "example.com",
			ConfigLink:   fmt.Sprintf("trojan://secret@192.0.2.%d:443#s%d", i+1, i),
		})
	}
	a := &App{}
	start := time.Now()
	order := a.rankByLatency(candidates, models.AppSettings{}, "example.com")
	elapsed := time.Since(start)
	if len(order) != len(candidates) {
		t.Fatalf("ranked %d of %d", len(order), len(candidates))
	}
	if elapsed > rankBudget+500*time.Millisecond {
		t.Fatalf("ranking took %v, budget %v", elapsed, rankBudget)
	}
	t.Logf("50 unreachable servers ranked in %v", elapsed)
}

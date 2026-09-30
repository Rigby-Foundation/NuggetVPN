package speedtest

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"
)

func TestRunAgainstALocalServer(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost {
			io.Copy(io.Discard, r.Body)
			return
		}
		size, _ := strconv.Atoi(r.URL.Query().Get("bytes"))
		chunk := make([]byte, 64<<10)
		for size > 0 {
			n := min(size, len(chunk))
			if _, err := w.Write(chunk[:n]); err != nil {
				return
			}
			size -= n
		}
	}))
	defer server.Close()
	oldDown, oldUp, oldPhase := downURL, upURL, phaseTime
	downURL, upURL, phaseTime = server.URL+"/down?bytes=%d", server.URL+"/up", 1500*time.Millisecond
	defer func() { downURL, upURL, phaseTime = oldDown, oldUp, oldPhase }()

	var phases []string
	result, err := Run(context.Background(), func(p Progress) {
		if len(phases) == 0 || phases[len(phases)-1] != p.Phase {
			phases = append(phases, p.Phase)
		}
	})
	if err != nil {
		t.Fatal(err)
	}
	// Latency can read 0 on loopback, which answers faster than the timer ticks.
	if result.Download <= 0 || result.Upload <= 0 || result.Latency < 0 {
		t.Errorf("result %+v", result)
	}
	if len(phases) != 3 {
		t.Errorf("phases %v", phases)
	}
	t.Logf("%+v", result)
}

func TestRunStopsWhenCancelled(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := Run(ctx, nil); err == nil {
		t.Error("a cancelled test should fail")
	}
}

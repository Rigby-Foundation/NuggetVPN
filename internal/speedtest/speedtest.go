// Package speedtest measures latency and throughput against Cloudflare's
// speed test service, the way speed.cloudflare.com does in a browser.
//
// While the tunnel is up the system's traffic goes through it, this test's
// included, so what it measures is the connection through the current
// server.
package speedtest

import (
	"context"
	"fmt"
	"io"
	"math"
	"net/http"
	"sort"
	"sync"
	"sync/atomic"
	"time"
)

// Endpoints and phase length; variables so tests can point them at a local
// server and keep it short.
var (
	downURL   = "https://speed.cloudflare.com/__down?bytes=%d"
	upURL     = "https://speed.cloudflare.com/__up"
	phaseTime = 8 * time.Second
)

// Tunables.
const (
	latencyRounds = 10
	streams       = 4
	chunkDown     = 25 << 20
	chunkUp       = 8 << 20
)

// Phases, reported in Progress.
const (
	PhaseLatency  = "latency"
	PhaseDownload = "download"
	PhaseUpload   = "upload"
)

// Progress is the test so far.
type Progress struct {
	Phase string `json:"phase"`
	// Fraction of the whole test done, 0–1.
	Fraction float64 `json:"fraction"`
	// Mbps is the current phase's speed so far.
	Mbps    float64 `json:"mbps"`
	Latency float64 `json:"latency_ms"`
}

// Result is a finished test.
type Result struct {
	Download float64 `json:"download_mbps"`
	Upload   float64 `json:"upload_mbps"`
	Latency  float64 `json:"latency_ms"`
	Jitter   float64 `json:"jitter_ms"`
}

// Run measures latency, then download, then upload. progress may be nil.
func Run(ctx context.Context, progress func(Progress)) (Result, error) {
	report := func(p Progress) {
		if progress != nil {
			progress(p)
		}
	}
	client := &http.Client{Transport: &http.Transport{
		Proxy:               nil,
		MaxIdleConnsPerHost: streams,
		ForceAttemptHTTP2:   false,
	}}
	defer client.CloseIdleConnections()

	latency, jitter, err := measureLatency(ctx, client, func(done int, median float64) {
		report(Progress{Phase: PhaseLatency, Fraction: 0.1 * float64(done) / latencyRounds, Latency: median})
	})
	if err != nil {
		return Result{}, err
	}
	result := Result{Latency: latency, Jitter: jitter}

	result.Download, err = measure(ctx, func(ctx context.Context, counter *atomic.Int64) error {
		return download(ctx, client, counter)
	}, func(fraction, mbps float64) {
		report(Progress{Phase: PhaseDownload, Fraction: 0.1 + 0.45*fraction, Mbps: mbps, Latency: latency})
	})
	if err != nil {
		return Result{}, fmt.Errorf("download: %w", err)
	}

	result.Upload, err = measure(ctx, func(ctx context.Context, counter *atomic.Int64) error {
		return upload(ctx, client, counter)
	}, func(fraction, mbps float64) {
		report(Progress{Phase: PhaseUpload, Fraction: 0.55 + 0.45*fraction, Mbps: mbps, Latency: latency})
	})
	if err != nil {
		return Result{}, fmt.Errorf("upload: %w", err)
	}
	report(Progress{Phase: PhaseUpload, Fraction: 1, Mbps: result.Upload, Latency: latency})
	return result, nil
}

// measureLatency times small requests over a warm connection: the median is
// the latency, the mean change between rounds the jitter.
func measureLatency(ctx context.Context, client *http.Client, step func(int, float64)) (float64, float64, error) {
	var times []float64
	// One to open the connection, not counted.
	for round := 0; round <= latencyRounds; round++ {
		request, err := http.NewRequestWithContext(ctx, http.MethodGet, fmt.Sprintf(downURL, 0), nil)
		if err != nil {
			return 0, 0, err
		}
		started := time.Now()
		response, err := client.Do(request)
		if err != nil {
			return 0, 0, err
		}
		_, _ = io.Copy(io.Discard, response.Body)
		response.Body.Close()
		if response.StatusCode != http.StatusOK {
			return 0, 0, fmt.Errorf("the test server answered %s", response.Status)
		}
		if round == 0 {
			continue
		}
		times = append(times, float64(time.Since(started).Microseconds())/1000)
		step(round, median(times))
	}
	var jitter float64
	for index := 1; index < len(times); index++ {
		jitter += math.Abs(times[index] - times[index-1])
	}
	jitter /= float64(len(times) - 1)
	return median(times), jitter, nil
}

func median(values []float64) float64 {
	sorted := append([]float64(nil), values...)
	sort.Float64s(sorted)
	middle := len(sorted) / 2
	if len(sorted)%2 == 0 {
		return (sorted[middle-1] + sorted[middle]) / 2
	}
	return sorted[middle]
}

// measure runs transfer on several streams for phaseTime and returns the
// throughput in Mbps. The first half second is not counted: that is TCP
// finding its pace, not the connection's speed.
func measure(ctx context.Context, transfer func(context.Context, *atomic.Int64) error, step func(float64, float64)) (float64, error) {
	ctx, cancel := context.WithTimeout(ctx, phaseTime)
	defer cancel()
	var counter atomic.Int64
	var failures atomic.Int32
	var group sync.WaitGroup
	for range streams {
		group.Add(1)
		go func() {
			defer group.Done()
			for ctx.Err() == nil {
				if err := transfer(ctx, &counter); err != nil && ctx.Err() == nil {
					if failures.Add(1) > streams*3 {
						return
					}
				}
			}
		}()
	}

	started := time.Now()
	const warmup = 500 * time.Millisecond
	var base int64
	var baseAt time.Time
	speed := 0.0
	ticker := time.NewTicker(250 * time.Millisecond)
	defer ticker.Stop()
	done := make(chan struct{})
	go func() { group.Wait(); close(done) }()
loop:
	for {
		select {
		case <-done:
			break loop
		case <-ticker.C:
			elapsed := time.Since(started)
			if baseAt.IsZero() && elapsed >= warmup {
				base, baseAt = counter.Load(), time.Now()
			}
			if !baseAt.IsZero() {
				if seconds := time.Since(baseAt).Seconds(); seconds > 0 {
					speed = float64(counter.Load()-base) * 8 / seconds / 1e6
				}
			}
			step(math.Min(1, elapsed.Seconds()/phaseTime.Seconds()), speed)
		}
	}
	if parent := context.Cause(ctx); parent != nil && parent != context.DeadlineExceeded {
		return 0, parent
	}
	if counter.Load() == 0 {
		return 0, fmt.Errorf("nothing got through")
	}
	if baseAt.IsZero() {
		speed = float64(counter.Load()) * 8 / time.Since(started).Seconds() / 1e6
	}
	return speed, nil
}

// countingReader counts what passes through it.
type countingReader struct {
	source  io.Reader
	counter *atomic.Int64
}

func (r countingReader) Read(buffer []byte) (int, error) {
	n, err := r.source.Read(buffer)
	r.counter.Add(int64(n))
	return n, err
}

func download(ctx context.Context, client *http.Client, counter *atomic.Int64) error {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, fmt.Sprintf(downURL, chunkDown), nil)
	if err != nil {
		return err
	}
	response, err := client.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	_, err = io.Copy(io.Discard, countingReader{response.Body, counter})
	return err
}

// zeros is an endless run of zero bytes, to upload.
type zeros struct{ left int64 }

func (z *zeros) Read(buffer []byte) (int, error) {
	if z.left <= 0 {
		return 0, io.EOF
	}
	n := int64(len(buffer))
	if n > z.left {
		n = z.left
	}
	clear(buffer[:n])
	z.left -= n
	return int(n), nil
}

func upload(ctx context.Context, client *http.Client, counter *atomic.Int64) error {
	body := countingReader{&zeros{left: chunkUp}, counter}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, upURL, body)
	if err != nil {
		return err
	}
	request.ContentLength = chunkUp
	request.Header.Set("Content-Type", "application/octet-stream")
	response, err := client.Do(request)
	if err != nil {
		return err
	}
	_, _ = io.Copy(io.Discard, response.Body)
	return response.Body.Close()
}

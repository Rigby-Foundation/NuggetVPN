package app

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/Rigby-Foundation/NuggetVPN/internal/storage"
)

const (
	// brandingMaxBytes bounds one image: a logo is a few KB, a card
	// background a few hundred at most.
	brandingMaxBytes = 512 << 10
	// brandingMaxAge is how long a downloaded image is kept before it is
	// fetched again; a provider changing its logo usually changes its URL.
	brandingMaxAge     = 7 * 24 * time.Hour
	brandingTimeout    = 10 * time.Second
	brandingMaxPerCall = 16
)

// brandingTypes are the image types a provider's branding may be, by the
// Content-Type it is served with. SVG is drawn through <img>, where it can
// run no scripts.
var brandingTypes = map[string]string{
	"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp",
	"image/gif": "gif", "image/svg+xml": "svg", "image/avif": "avif",
}

var brandingFetches sync.Map // url -> *sync.Mutex, one download at a time per image

// GetBrandingImages returns subscription providers' images (their logo, the
// background of their card) by URL, as data URLs; "" for one that could not
// be had. Each is downloaded once and kept on disk, so the cards draw from
// the computer rather than asking the provider's server every time they are
// shown, and still show offline.
func (a *App) GetBrandingImages(urls []string) map[string]string {
	result := map[string]string{}
	var mu sync.Mutex
	var wait sync.WaitGroup
	for index, raw := range urls {
		if index >= brandingMaxPerCall {
			break
		}
		wait.Add(1)
		go func(raw string) {
			defer wait.Done()
			image := brandingImage(raw)
			mu.Lock()
			result[raw] = image
			mu.Unlock()
		}(raw)
	}
	wait.Wait()
	return result
}

func brandingImage(raw string) string {
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Scheme != "https" || parsed.Host == "" {
		return ""
	}
	sum := sha256.Sum256([]byte(raw))
	base := filepath.Join(storage.DataDir(), "branding", hex.EncodeToString(sum[:12]))

	lock, _ := brandingFetches.LoadOrStore(raw, &sync.Mutex{})
	lock.(*sync.Mutex).Lock()
	defer lock.(*sync.Mutex).Unlock()

	cached, cachedType, fresh := readBranding(base)
	if fresh {
		return dataURL(cachedType, cached)
	}
	data, kind, err := downloadBranding(raw)
	if err != nil {
		// The copy we have beats nothing while the provider is unreachable.
		if cached != nil {
			return dataURL(cachedType, cached)
		}
		return ""
	}
	if err := os.MkdirAll(filepath.Dir(base), 0o755); err == nil {
		_ = os.WriteFile(base+".img", data, 0o644)
		_ = os.WriteFile(base+".type", []byte(kind), 0o644)
	}
	return dataURL(kind, data)
}

// readBranding is a stored image, its type, and whether it is recent enough
// to use without asking again.
func readBranding(base string) ([]byte, string, bool) {
	info, err := os.Stat(base + ".img")
	if err != nil {
		return nil, "", false
	}
	data, err := os.ReadFile(base + ".img")
	if err != nil {
		return nil, "", false
	}
	kind, err := os.ReadFile(base + ".type")
	if err != nil || brandingTypes[string(kind)] == "" {
		return nil, "", false
	}
	return data, string(kind), time.Since(info.ModTime()) < brandingMaxAge
}

func downloadBranding(raw string) ([]byte, string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), brandingTimeout)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, raw, nil)
	if err != nil {
		return nil, "", err
	}
	request.Header.Set("User-Agent", "NuggetVPN")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return nil, "", err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, "", io.ErrUnexpectedEOF
	}
	kind := strings.ToLower(strings.TrimSpace(strings.Split(response.Header.Get("Content-Type"), ";")[0]))
	if brandingTypes[kind] == "" {
		// Served without a usable type: go by what the bytes are.
		head := make([]byte, 512)
		n, _ := io.ReadFull(response.Body, head)
		kind = http.DetectContentType(head[:n])
		if brandingTypes[kind] == "" {
			return nil, "", io.ErrUnexpectedEOF
		}
		rest, err := io.ReadAll(io.LimitReader(response.Body, brandingMaxBytes))
		if err != nil {
			return nil, "", err
		}
		data := append(head[:n], rest...)
		if len(data) > brandingMaxBytes {
			return nil, "", io.ErrShortBuffer
		}
		return data, kind, nil
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, brandingMaxBytes+1))
	if err != nil {
		return nil, "", err
	}
	if len(data) > brandingMaxBytes {
		return nil, "", io.ErrShortBuffer
	}
	return data, kind, nil
}

func dataURL(kind string, data []byte) string {
	return "data:" + kind + ";base64," + base64.StdEncoding.EncodeToString(data)
}

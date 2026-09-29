package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"
)

// ---------------------------------------------------------------------------
// Updates
// ---------------------------------------------------------------------------

// releasesURL is the newest published release. Drafts are not listed, so a
// release is only offered once it has been published.
const releasesURL = "https://api.github.com/repos/Rigby-Foundation/NuggetVPN/releases/latest"

// updateProgressEventName carries download progress while an update is
// being fetched.
const updateProgressEventName = "update-progress"

// UpdateInfo describes the newest release against the running version.
type UpdateInfo struct {
	Current   string `json:"current"`
	Latest    string `json:"latest"`
	Available bool   `json:"available"`
	// Notes are the release notes, as written on the release.
	Notes   string `json:"notes"`
	PageURL string `json:"page_url"`
	// Asset is the download for this platform; empty when there is none, and
	// the release page is the way to update.
	Asset     string `json:"asset,omitempty"`
	AssetSize int64  `json:"asset_size,omitempty"`
	// Installable is true where the app can install the download itself.
	Installable bool  `json:"installable"`
	CheckedAt   int64 `json:"checked_at"`
}

type release struct {
	Tag     string `json:"tag_name"`
	Body    string `json:"body"`
	HTMLURL string `json:"html_url"`
	Draft   bool   `json:"draft"`
	Assets  []struct {
		Name string `json:"name"`
		Size int64  `json:"size"`
		URL  string `json:"browser_download_url"`
	} `json:"assets"`
}

// GetVersion returns the running version.
func (a *App) GetVersion() string {
	return a.version
}

// CheckForUpdate asks GitHub for the newest release.
func (a *App) CheckForUpdate() (UpdateInfo, error) {
	info := UpdateInfo{Current: a.version, CheckedAt: time.Now().Unix()}
	latest, err := a.latestRelease()
	if err != nil {
		return info, err
	}
	info.Latest = strings.TrimPrefix(latest.Tag, "v")
	info.Notes = latest.Body
	info.PageURL = latest.HTMLURL
	info.Available = newerVersion(info.Latest, a.version)
	if name, size, _, ok := pickAsset(latest); ok {
		info.Asset, info.AssetSize = name, size
		info.Installable = runtime.GOOS == "windows" || runtime.GOOS == "darwin"
	}
	a.mu.Lock()
	a.latest = &latest
	a.mu.Unlock()
	return info, nil
}

func (a *App) latestRelease() (release, error) {
	ctx, cancel := context.WithTimeout(a.context(), 20*time.Second)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, releasesURL, nil)
	if err != nil {
		return release{}, err
	}
	request.Header.Set("Accept", "application/vnd.github+json")
	request.Header.Set("User-Agent", "NuggetVPN/"+a.version)
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return release{}, fmt.Errorf("could not reach GitHub: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return release{}, fmt.Errorf("GitHub answered %d", response.StatusCode)
	}
	var latest release
	if err := json.NewDecoder(io.LimitReader(response.Body, 4<<20)).Decode(&latest); err != nil {
		return release{}, err
	}
	if latest.Draft || latest.Tag == "" {
		return release{}, errors.New("no published release")
	}
	return latest, nil
}

// pickAsset chooses the download for this platform, by the names the
// release workflow gives them.
func pickAsset(latest release) (name string, size int64, link string, ok bool) {
	suffix := map[string]string{
		"windows": "-windows-amd64-installer.exe",
		"darwin":  "-macos-universal.dmg",
		"linux":   "-linux-amd64.AppImage",
	}[runtime.GOOS]
	if suffix == "" {
		return "", 0, "", false
	}
	for _, asset := range latest.Assets {
		if strings.HasSuffix(asset.Name, suffix) {
			return asset.Name, asset.Size, asset.URL, true
		}
	}
	return "", 0, "", false
}

// InstallUpdate downloads the newest release and starts installing it. On
// Windows the installer runs and the app quits so its files can be
// replaced; on macOS the disk image opens, for the app to be dragged over
// the old one. Elsewhere the release page is the way to update.
func (a *App) InstallUpdate() error {
	a.mu.Lock()
	latest := a.latest
	a.mu.Unlock()
	if latest == nil {
		fresh, err := a.latestRelease()
		if err != nil {
			return err
		}
		latest = &fresh
	}
	name, size, link, ok := pickAsset(*latest)
	if !ok || (runtime.GOOS != "windows" && runtime.GOOS != "darwin") {
		return errors.New("no installer for this system; download it from the release page")
	}
	// Only from GitHub's own download address.
	parsed, err := url.Parse(link)
	if err != nil || parsed.Scheme != "https" || parsed.Host != "github.com" {
		return errors.New("the download is not from GitHub")
	}

	target := filepath.Join(os.TempDir(), name)
	if err := a.download(link, target, size); err != nil {
		return err
	}

	switch runtime.GOOS {
	case "windows":
		if err := exec.Command(target).Start(); err != nil {
			return fmt.Errorf("could not start the installer: %w", err)
		}
		// The installer replaces the running binary; get out of its way.
		go func() {
			time.Sleep(1500 * time.Millisecond)
			a.QuitApp()
		}()
	case "darwin":
		if err := exec.Command("open", target).Start(); err != nil {
			return fmt.Errorf("could not open the disk image: %w", err)
		}
	}
	return nil
}

// download fetches link to target, reporting progress to the window.
func (a *App) download(link, target string, size int64) error {
	ctx, cancel := context.WithTimeout(a.context(), 15*time.Minute)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, link, nil)
	if err != nil {
		return err
	}
	request.Header.Set("User-Agent", "NuggetVPN/"+a.version)
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return fmt.Errorf("download failed: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("download failed: the server answered %d", response.StatusCode)
	}
	if size <= 0 {
		size = response.ContentLength
	}

	temporary := target + ".part"
	file, err := os.Create(temporary)
	if err != nil {
		return err
	}
	fail := func(err error) error {
		file.Close()
		os.Remove(temporary)
		return err
	}
	var received int64
	last := time.Time{}
	buffer := make([]byte, 256<<10)
	for {
		count, readErr := response.Body.Read(buffer)
		if count > 0 {
			if _, err := file.Write(buffer[:count]); err != nil {
				return fail(err)
			}
			received += int64(count)
			if time.Since(last) > 200*time.Millisecond {
				last = time.Now()
				a.emit(updateProgressEventName, map[string]int64{"received": received, "total": size})
			}
		}
		if errors.Is(readErr, io.EOF) {
			break
		}
		if readErr != nil {
			return fail(fmt.Errorf("download failed: %w", readErr))
		}
	}
	if size > 0 && received != size {
		return fail(fmt.Errorf("download incomplete: %d of %d bytes", received, size))
	}
	if err := file.Close(); err != nil {
		return err
	}
	a.emit(updateProgressEventName, map[string]int64{"received": received, "total": size})
	return os.Rename(temporary, target)
}

// newerVersion reports whether candidate is a later version than current,
// comparing dotted numbers; a pre-release ("2.1.0-beta.1") ranks below the
// release it precedes.
func newerVersion(candidate, current string) bool {
	parse := func(value string) ([]int, bool) {
		value = strings.TrimPrefix(strings.TrimSpace(value), "v")
		main, pre, _ := strings.Cut(value, "-")
		parts := strings.Split(main, ".")
		numbers := make([]int, 3)
		for index := 0; index < 3 && index < len(parts); index++ {
			number, err := strconv.Atoi(parts[index])
			if err == nil {
				numbers[index] = number
			}
		}
		return numbers, pre != ""
	}
	a, aPre := parse(candidate)
	b, bPre := parse(current)
	for index := range a {
		if a[index] != b[index] {
			return a[index] > b[index]
		}
	}
	return !aPre && bPre
}

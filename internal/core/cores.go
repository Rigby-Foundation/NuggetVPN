package core

import (
	"archive/tar"
	"archive/zip"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"sync"
	"time"
)

// ---------------------------------------------------------------------------
// External cores
// ---------------------------------------------------------------------------
//
// Besides the built-in sing-box fork, the app can run official sing-box,
// mihomo or Xray. Those are separate programs, run by this privileged
// service, so how they get onto the disk is a privilege boundary: a program
// the unprivileged side could swap out would be arbitrary code running as
// root. Therefore:
//
//   - The service downloads them itself, only from a fixed list of official
//     GitHub repositories, and checks each download against the SHA-256
//     GitHub publishes for it. The GUI can ask for a core by name; it cannot
//     supply a URL or a file.
//   - They are stored in a directory only administrators can write to.
//   - Each is hashed again, against the hash recorded at install, every time
//     before it is started.

// Core names.
const (
	CoreBuiltin = "builtin"
	CoreSingBox = "sing-box"
	CoreMihomo  = "mihomo"
	CoreXray    = "xray"
)

// CoreInfo describes one external core for the GUI.
type CoreInfo struct {
	Name      string `json:"name"`
	Installed bool   `json:"installed"`
	Version   string `json:"version,omitempty"`
	// Path is where the binary is, for routing rules that must let it out
	// directly (see the Xray engine).
	Path string `json:"path,omitempty"`
}

// coreSource says where a core comes from and how to find this system's
// build of it among a release's files.
type coreSource struct {
	repo string
	// tagPrefix, when set, restricts releases to that line — pre-releases
	// included — instead of taking the newest stable one.
	tagPrefix string
	asset     func(goos, goarch string) *regexp.Regexp
	binary    string
}

var coreSources = map[string]coreSource{
	CoreXray: {
		repo: "XTLS/Xray-core",
		asset: func(goos, goarch string) *regexp.Regexp {
			system := map[string]string{"windows": "windows", "darwin": "macos", "linux": "linux"}[goos]
			arch := map[string]string{"amd64": "64", "arm64": "arm64-v8a"}[goarch]
			return regexp.MustCompile(`^Xray-` + system + `-` + regexp.QuoteMeta(arch) + `\.zip$`)
		},
		binary: "xray",
	},
	CoreMihomo: {
		repo: "MetaCubeX/mihomo",
		asset: func(goos, goarch string) *regexp.Regexp {
			return regexp.MustCompile(`^mihomo-` + goos + `-` + goarch + `-v\d+\.\d+\.\d+\.(zip|gz)$`)
		},
		binary: "mihomo",
	},
	// The 1.15 line, which the app's own sing-box fork is built on. It may
	// still be a pre-release; 1.14 is not offered.
	CoreSingBox: {
		repo:      "SagerNet/sing-box",
		tagPrefix: "v1.15.",
		asset: func(goos, goarch string) *regexp.Regexp {
			return regexp.MustCompile(`^sing-box-1\.15\.\d+(-[a-z]+\.\d+)?-` + goos + `-` + goarch + `\.(zip|tar\.gz)$`)
		},
		binary: "sing-box",
	},
}

// ExternalCores lists the cores that can be installed, in display order.
var ExternalCores = []string{CoreSingBox, CoreMihomo, CoreXray}

// maxCoreDownload bounds a core download; the largest are around 35 MB.
const maxCoreDownload = 200 << 20

// coresRoot is the administrator-only directory cores live in. A variable so
// tests can point it somewhere writable.
var coresRoot = defaultCoresRoot

// lockCoresRoot restricts the directory to administrators; off in tests, which
// do not run as one.
var lockCoresRoot = true

func defaultCoresRoot() string {
	switch runtime.GOOS {
	case "windows":
		base := os.Getenv("ProgramData")
		if base == "" {
			base = `C:\ProgramData`
		}
		return filepath.Join(base, "NuggetVPN", "cores")
	case "darwin":
		return "/Library/Application Support/NuggetVPN/cores"
	default:
		return "/var/lib/nuggetvpn/cores"
	}
}

// coreManifest records what was installed and its hash.
type coreManifest struct {
	Version string `json:"version"`
	File    string `json:"file"`
	SHA256  string `json:"sha256"`
}

var manifestMu sync.Mutex

func manifestPath() string { return filepath.Join(coresRoot(), "manifest.json") }

func readManifest() map[string]coreManifest {
	manifest := map[string]coreManifest{}
	data, err := os.ReadFile(manifestPath())
	if err == nil {
		_ = json.Unmarshal(data, &manifest)
	}
	return manifest
}

func writeManifest(manifest map[string]coreManifest) error {
	data, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return err
	}
	temporary := manifestPath() + ".part"
	if err := os.WriteFile(temporary, data, 0o644); err != nil {
		return err
	}
	return os.Rename(temporary, manifestPath())
}

// CoreStatus reports every external core.
func CoreStatus() []CoreInfo {
	manifestMu.Lock()
	manifest := readManifest()
	manifestMu.Unlock()
	result := make([]CoreInfo, 0, len(ExternalCores))
	for _, name := range ExternalCores {
		info := CoreInfo{Name: name}
		if entry, ok := manifest[name]; ok {
			if _, err := os.Stat(entry.File); err == nil {
				info.Installed, info.Version, info.Path = true, entry.Version, entry.File
			}
		}
		result = append(result, info)
	}
	return result
}

// verifiedCore returns the path of an installed core after checking the file
// is still exactly what was installed.
func verifiedCore(name string) (string, error) {
	manifestMu.Lock()
	entry, ok := readManifest()[name]
	manifestMu.Unlock()
	if !ok {
		return "", fmt.Errorf("%s is not installed", name)
	}
	file, err := os.Open(entry.File)
	if err != nil {
		return "", fmt.Errorf("%s is not installed: %w", name, err)
	}
	defer file.Close()
	hash := sha256.New()
	if _, err := io.Copy(hash, file); err != nil {
		return "", err
	}
	if hex.EncodeToString(hash.Sum(nil)) != entry.SHA256 {
		return "", fmt.Errorf("%s has changed since it was installed; install it again", name)
	}
	return entry.File, nil
}

type githubRelease struct {
	Tag    string `json:"tag_name"`
	Draft  bool   `json:"draft"`
	Pre    bool   `json:"prerelease"`
	Assets []struct {
		Name   string `json:"name"`
		Size   int64  `json:"size"`
		URL    string `json:"browser_download_url"`
		Digest string `json:"digest"`
	} `json:"assets"`
}

// InstallCore downloads, verifies and installs the newest build of a core,
// replacing any installed one. progress reports bytes received.
func InstallCore(ctx context.Context, name string, progress func(received, total int64)) (CoreInfo, error) {
	source, ok := coreSources[name]
	if !ok {
		return CoreInfo{}, fmt.Errorf("unknown core %q", name)
	}
	pattern := source.asset(runtime.GOOS, runtime.GOARCH)

	release, err := findRelease(ctx, source)
	if err != nil {
		return CoreInfo{}, err
	}
	var assetURL, digest string
	var size int64
	var assetName string
	for _, asset := range release.Assets {
		if pattern.MatchString(asset.Name) {
			assetURL, digest, size, assetName = asset.URL, asset.Digest, asset.Size, asset.Name
			break
		}
	}
	if assetURL == "" {
		return CoreInfo{}, fmt.Errorf("%s %s has no build for %s/%s", name, release.Tag, runtime.GOOS, runtime.GOARCH)
	}
	expected, found := strings.CutPrefix(digest, "sha256:")
	if !found || len(expected) != 64 {
		return CoreInfo{}, fmt.Errorf("GitHub published no checksum for %s; refusing to install it", assetName)
	}
	parsed, err := urlHost(assetURL)
	if err != nil || parsed != "github.com" {
		return CoreInfo{}, errors.New("the download is not from GitHub")
	}

	archive, err := downloadVerified(ctx, assetURL, size, expected, progress)
	if err != nil {
		return CoreInfo{}, err
	}
	binary, err := extractBinary(assetName, archive, source.binary)
	if err != nil {
		return CoreInfo{}, err
	}

	if err := prepareCoresRoot(); err != nil {
		return CoreInfo{}, err
	}
	fileName := source.binary
	if runtime.GOOS == "windows" {
		fileName += ".exe"
	}
	dir := filepath.Join(coresRoot(), name)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return CoreInfo{}, err
	}
	target := filepath.Join(dir, fileName)
	temporary := target + ".part"
	if err := os.WriteFile(temporary, binary, 0o755); err != nil {
		return CoreInfo{}, err
	}
	// A running copy of the old binary cannot be replaced on Windows; the
	// caller stops the core first.
	if err := os.Rename(temporary, target); err != nil {
		_ = os.Remove(temporary)
		return CoreInfo{}, fmt.Errorf("could not replace %s (is it running?): %w", fileName, err)
	}
	sum := sha256.Sum256(binary)

	manifestMu.Lock()
	manifest := readManifest()
	manifest[name] = coreManifest{Version: strings.TrimPrefix(release.Tag, "v"), File: target, SHA256: hex.EncodeToString(sum[:])}
	err = writeManifest(manifest)
	manifestMu.Unlock()
	if err != nil {
		return CoreInfo{}, err
	}
	return CoreInfo{Name: name, Installed: true, Version: strings.TrimPrefix(release.Tag, "v"), Path: target}, nil
}

// RemoveCore deletes an installed core.
func RemoveCore(name string) error {
	if _, ok := coreSources[name]; !ok {
		return fmt.Errorf("unknown core %q", name)
	}
	manifestMu.Lock()
	defer manifestMu.Unlock()
	manifest := readManifest()
	if entry, ok := manifest[name]; ok {
		if err := os.RemoveAll(filepath.Dir(entry.File)); err != nil {
			return err
		}
		delete(manifest, name)
	}
	return writeManifest(manifest)
}

func findRelease(ctx context.Context, source coreSource) (githubRelease, error) {
	endpoint := "https://api.github.com/repos/" + source.repo + "/releases/latest"
	if source.tagPrefix != "" {
		// Each release lists dozens of files; ten releases is enough to
		// reach the newest of a line and still a few megabytes.
		endpoint = "https://api.github.com/repos/" + source.repo + "/releases?per_page=10"
	}
	body, err := httpGet(ctx, endpoint, 64<<20)
	if err != nil {
		return githubRelease{}, err
	}
	if source.tagPrefix == "" {
		var release githubRelease
		if err := json.Unmarshal(body, &release); err != nil {
			return githubRelease{}, err
		}
		return release, nil
	}
	var releases []githubRelease
	if err := json.Unmarshal(body, &releases); err != nil {
		return githubRelease{}, err
	}
	// Newest first, as GitHub lists them.
	for _, release := range releases {
		if !release.Draft && strings.HasPrefix(release.Tag, source.tagPrefix) {
			return release, nil
		}
	}
	return githubRelease{}, fmt.Errorf("no %s* release of %s is published yet", source.tagPrefix, source.repo)
}

func httpGet(ctx context.Context, link string, limit int64) ([]byte, error) {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, link, nil)
	if err != nil {
		return nil, err
	}
	request.Header.Set("Accept", "application/vnd.github+json")
	request.Header.Set("User-Agent", "NuggetVPN")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return nil, fmt.Errorf("could not reach GitHub: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("GitHub answered %d", response.StatusCode)
	}
	return io.ReadAll(io.LimitReader(response.Body, limit))
}

func urlHost(link string) (string, error) {
	rest, ok := strings.CutPrefix(link, "https://")
	if !ok {
		return "", errors.New("not https")
	}
	host, _, _ := strings.Cut(rest, "/")
	return host, nil
}

// downloadVerified fetches link and checks it against the expected SHA-256.
func downloadVerified(ctx context.Context, link string, size int64, expected string, progress func(received, total int64)) ([]byte, error) {
	ctx, cancel := context.WithTimeout(ctx, 15*time.Minute)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, link, nil)
	if err != nil {
		return nil, err
	}
	request.Header.Set("User-Agent", "NuggetVPN")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return nil, fmt.Errorf("download failed: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("download failed: the server answered %d", response.StatusCode)
	}
	var buffer bytes.Buffer
	chunk := make([]byte, 256<<10)
	last := time.Time{}
	for {
		count, readErr := response.Body.Read(chunk)
		if count > 0 {
			buffer.Write(chunk[:count])
			if int64(buffer.Len()) > maxCoreDownload {
				return nil, errors.New("the download is larger than expected")
			}
			if progress != nil && time.Since(last) > 200*time.Millisecond {
				last = time.Now()
				progress(int64(buffer.Len()), size)
			}
		}
		if errors.Is(readErr, io.EOF) {
			break
		}
		if readErr != nil {
			return nil, fmt.Errorf("download failed: %w", readErr)
		}
	}
	if progress != nil {
		progress(int64(buffer.Len()), size)
	}
	sum := sha256.Sum256(buffer.Bytes())
	if hex.EncodeToString(sum[:]) != strings.ToLower(expected) {
		return nil, errors.New("the download does not match the checksum GitHub published; nothing was installed")
	}
	return buffer.Bytes(), nil
}

// extractBinary takes the core's program out of a release file: a zip, a
// tar.gz, or (mihomo on macOS and Linux) the gzipped binary itself.
func extractBinary(assetName string, archive []byte, binary string) ([]byte, error) {
	wanted := func(name string) bool {
		base := path.Base(strings.ReplaceAll(name, `\`, "/"))
		base = strings.TrimSuffix(base, ".exe")
		// mihomo names its binary after the platform: mihomo-windows-amd64.exe.
		return base == binary || strings.HasPrefix(base, binary+"-")
	}
	switch {
	case strings.HasSuffix(assetName, ".zip"):
		reader, err := zip.NewReader(bytes.NewReader(archive), int64(len(archive)))
		if err != nil {
			return nil, err
		}
		for _, file := range reader.File {
			if file.FileInfo().IsDir() || !wanted(file.Name) {
				continue
			}
			if runtime.GOOS == "windows" && !strings.HasSuffix(strings.ToLower(file.Name), ".exe") {
				continue
			}
			opened, err := file.Open()
			if err != nil {
				return nil, err
			}
			defer opened.Close()
			return io.ReadAll(io.LimitReader(opened, maxCoreDownload))
		}
	case strings.HasSuffix(assetName, ".tar.gz"):
		unzipped, err := gzip.NewReader(bytes.NewReader(archive))
		if err != nil {
			return nil, err
		}
		reader := tar.NewReader(unzipped)
		for {
			header, err := reader.Next()
			if errors.Is(err, io.EOF) {
				break
			}
			if err != nil {
				return nil, err
			}
			if header.Typeflag == tar.TypeReg && wanted(header.Name) {
				return io.ReadAll(io.LimitReader(reader, maxCoreDownload))
			}
		}
	case strings.HasSuffix(assetName, ".gz"):
		unzipped, err := gzip.NewReader(bytes.NewReader(archive))
		if err != nil {
			return nil, err
		}
		return io.ReadAll(io.LimitReader(unzipped, maxCoreDownload))
	}
	return nil, fmt.Errorf("%s has no %s program in it", assetName, binary)
}

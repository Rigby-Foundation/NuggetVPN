package core

import (
	"os"
	"path/filepath"
	"runtime"
	"runtime/debug"
	"strings"

	xraycore "github.com/xtls/xray-core/core"
)

// ---------------------------------------------------------------------------
// Cores
// ---------------------------------------------------------------------------
//
// Besides the built-in sing-box fork, the tunnel can run on official
// sing-box, mihomo or Xray. All four are linked into this binary and run
// inside this service, so there is nothing to download, verify or launch,
// and nothing another program could swap out.

// Core names.
const (
	CoreBuiltin = "builtin"
	CoreSingBox = "sing-box"
	CoreMihomo  = "mihomo"
	CoreXray    = "xray"
)

// officialSingBoxVersion is the release third_party/sing-box-official was
// copied from.
const officialSingBoxVersion = "1.15.0-alpha.9"

// CoreInfo describes one core for the GUI.
type CoreInfo struct {
	Name    string `json:"name"`
	Version string `json:"version,omitempty"`
}

// Cores lists the cores in display order, with the versions built in.
func Cores() []CoreInfo {
	return []CoreInfo{
		{Name: CoreBuiltin, Version: moduleVersion("github.com/sagernet/sing-box")},
		{Name: CoreSingBox, Version: officialSingBoxVersion},
		{Name: CoreMihomo, Version: moduleVersion("github.com/metacubex/mihomo")},
		{Name: CoreXray, Version: xraycore.Version()},
	}
}

// moduleVersion is the version a dependency was built at, following a
// replace directive.
func moduleVersion(path string) string {
	info, ok := debug.ReadBuildInfo()
	if !ok {
		return ""
	}
	for _, module := range info.Deps {
		if module.Path != path {
			continue
		}
		if module.Replace != nil && module.Replace.Version != "" {
			module = module.Replace
		}
		return strings.TrimPrefix(module.Version, "v")
	}
	return ""
}

// dataRoot is the administrator-only directory the cores keep their files
// in while they run. A variable so tests can point it somewhere writable.
var dataRoot = defaultDataRoot

// lockDataRoot restricts the directory to administrators; off in tests,
// which do not run as one.
var lockDataRoot = true

func defaultDataRoot() string {
	switch runtime.GOOS {
	case "windows":
		base := os.Getenv("ProgramData")
		if base == "" {
			base = `C:\ProgramData`
		}
		return filepath.Join(base, "NuggetVPN", "cores")
	case "darwin":
		return "/Library/Application Support/NuggetVPN/cores"
	case "ios", "android":
		home, err := os.UserHomeDir()
		if err != nil {
			home = "."
		}
		return filepath.Join(home, ".local", "share", "org.rigbyfoundation.nuggetvpn", "cores")
	default:
		return "/var/lib/nuggetvpn/cores"
	}
}

// runDir is a core's working directory, made on first use.
func runDir(name string) (string, error) {
	if err := prepareDataRoot(); err != nil {
		return "", err
	}
	dir := filepath.Join(dataRoot(), name)
	return dir, os.MkdirAll(dir, 0o755)
}

package core

import (
	"archive/tar"
	"archive/zip"
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"testing"
)

// Each core's pattern picks exactly this system's build out of the real file
// names its releases carry, and none of the variants beside it.
func TestCoreAssetSelection(t *testing.T) {
	releases := map[string][]string{
		CoreXray: {"Xray-windows-64.zip", "Xray-windows-arm64-v8a.zip", "Xray-macos-64.zip", "Xray-macos-arm64-v8a.zip", "Xray-linux-64.zip", "Xray-linux-arm64-v8a.zip", "Xray-windows-64.zip.dgst"},
		CoreMihomo: {"mihomo-windows-amd64-v1.19.31.zip", "mihomo-windows-amd64-compatible-v1.19.31.zip", "mihomo-windows-amd64-v1-v1.19.31.zip",
			"mihomo-darwin-arm64-v1.19.31.gz", "mihomo-darwin-amd64-v1.19.31.gz", "mihomo-linux-amd64-v1.19.31.gz", "mihomo-linux-amd64-v3-v1.19.31.gz", "mihomo-linux-arm64-v1.19.31.gz"},
		CoreSingBox: {"sing-box-1.15.0-beta.4-windows-amd64.zip", "sing-box-1.15.0-beta.4-windows-amd64-legacy-windows-7.zip",
			"sing-box-1.15.0-beta.4-darwin-arm64.tar.gz", "sing-box-1.15.0-beta.4-linux-amd64.tar.gz", "sing-box-1.15.0-beta.4-linux-amd64-glibc.tar.gz",
			"sing-box-1.14.2-windows-amd64.zip"},
	}
	want := map[string]map[[2]string]string{
		CoreXray: {
			{"windows", "amd64"}: "Xray-windows-64.zip", {"darwin", "arm64"}: "Xray-macos-arm64-v8a.zip", {"linux", "amd64"}: "Xray-linux-64.zip",
		},
		CoreMihomo: {
			{"windows", "amd64"}: "mihomo-windows-amd64-v1.19.31.zip", {"darwin", "arm64"}: "mihomo-darwin-arm64-v1.19.31.gz", {"linux", "amd64"}: "mihomo-linux-amd64-v1.19.31.gz",
		},
		CoreSingBox: {
			{"windows", "amd64"}: "sing-box-1.15.0-beta.4-windows-amd64.zip", {"darwin", "arm64"}: "sing-box-1.15.0-beta.4-darwin-arm64.tar.gz", {"linux", "amd64"}: "sing-box-1.15.0-beta.4-linux-amd64.tar.gz",
		},
	}
	for core, systems := range want {
		for system, expected := range systems {
			pattern := coreSources[core].asset(system[0], system[1])
			var matched []string
			for _, name := range releases[core] {
				if pattern.MatchString(name) {
					matched = append(matched, name)
				}
			}
			if len(matched) != 1 || matched[0] != expected {
				t.Errorf("%s on %s/%s matched %v, want %s", core, system[0], system[1], matched, expected)
			}
		}
	}
}

func TestExtractBinary(t *testing.T) {
	program := []byte("the program")

	var zipped bytes.Buffer
	writer := zip.NewWriter(&zipped)
	for _, name := range []string{"LICENSE", "geoip.dat", "xray.exe", "xray"} {
		entry, _ := writer.Create(name)
		entry.Write(program)
	}
	writer.Close()
	if got, err := extractBinary("Xray-windows-64.zip", zipped.Bytes(), "xray"); err != nil || !bytes.Equal(got, program) {
		t.Errorf("zip: %q %v", got, err)
	}

	var tarred bytes.Buffer
	gz := gzip.NewWriter(&tarred)
	archive := tar.NewWriter(gz)
	archive.WriteHeader(&tar.Header{Name: "sing-box-1.15.0-linux-amd64/LICENSE", Mode: 0o644, Size: 3, Typeflag: tar.TypeReg})
	archive.Write([]byte("mit"))
	archive.WriteHeader(&tar.Header{Name: "sing-box-1.15.0-linux-amd64/sing-box", Mode: 0o755, Size: int64(len(program)), Typeflag: tar.TypeReg})
	archive.Write(program)
	archive.Close()
	gz.Close()
	if got, err := extractBinary("sing-box-1.15.0-linux-amd64.tar.gz", tarred.Bytes(), "sing-box"); err != nil || !bytes.Equal(got, program) {
		t.Errorf("tar.gz: %q %v", got, err)
	}

	var gzipped bytes.Buffer
	plain := gzip.NewWriter(&gzipped)
	plain.Write(program)
	plain.Close()
	if got, err := extractBinary("mihomo-linux-amd64-v1.19.31.gz", gzipped.Bytes(), "mihomo"); err != nil || !bytes.Equal(got, program) {
		t.Errorf("gz: %q %v", got, err)
	}
}

// A core whose file no longer matches the hash recorded at install is not
// started: whatever replaced it is not what was verified.
func TestVerifiedCoreRefusesChangedBinary(t *testing.T) {
	root := t.TempDir()
	original := coresRoot
	coresRoot = func() string { return root }
	defer func() { coresRoot = original }()

	binary := filepath.Join(root, "xray", "xray")
	os.MkdirAll(filepath.Dir(binary), 0o755)
	os.WriteFile(binary, []byte("verified"), 0o755)
	sum := sha256.Sum256([]byte("verified"))
	if err := writeManifest(map[string]coreManifest{CoreXray: {Version: "1", File: binary, SHA256: hex.EncodeToString(sum[:])}}); err != nil {
		t.Fatal(err)
	}
	if _, err := verifiedCore(CoreXray); err != nil {
		t.Fatalf("an untouched core was refused: %v", err)
	}
	os.WriteFile(binary, []byte("swapped"), 0o755)
	if _, err := verifiedCore(CoreXray); err == nil {
		t.Fatal("a changed core was accepted")
	}
	if status := CoreStatus(); !status[2].Installed || status[0].Installed {
		t.Errorf("status: %+v", status)
	}
}

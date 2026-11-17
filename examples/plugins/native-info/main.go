// Command native-info builds the hybrid example for the current desktop.
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"

	"github.com/Rigby-Foundation/Kage/internal/plugins"
)

func main() {
	output := flag.String("output", "native-info.nuggetplugin", "output file")
	flag.Parse()
	if err := build(*output); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func build(output string) error {
	if !plugins.NativeAllowed() {
		return fmt.Errorf("this example supports desktops only")
	}
	dir, err := os.MkdirTemp("", "native-info-build-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(dir)
	executable := "backend"
	if runtime.GOOS == "windows" {
		executable += ".exe"
	}
	cmd := exec.Command("go", "build", "-trimpath", "-ldflags=-s -w", "-o", filepath.Join(dir, executable), "./examples/plugins/native-info/backend")
	cmd.Stdout, cmd.Stderr = os.Stdout, os.Stderr
	if err := cmd.Run(); err != nil {
		return err
	}
	manifest := plugins.Manifest{Format: 1, ID: "com.example.native-info", Name: "Native system info", Version: "1.0.0", Description: "A hybrid example with a JS panel and a native system-info backend.", Panel: &plugins.Panel{Title: "System info", File: "panel.html"}, Backend: &plugins.Backend{API: 1, Executables: map[string]string{runtime.GOOS + "/" + runtime.GOARCH: executable}}}
	data, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(dir, "plugin.json"), data, 0o644); err != nil {
		return err
	}
	page, err := os.ReadFile("examples/plugins/native-info/panel.html")
	if err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(dir, "panel.html"), page, 0o644); err != nil {
		return err
	}
	packed, pkg, err := plugins.Pack(dir)
	if err != nil {
		return err
	}
	if err := os.WriteFile(output, packed, 0o644); err != nil {
		return err
	}
	fmt.Printf("%s\nSHA-256: %s\n", output, pkg.Checksum())
	return nil
}

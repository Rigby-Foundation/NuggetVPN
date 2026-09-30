// Command nuggetplugin builds a .nuggetplugin file from a plugin's folder,
// checking it the way the app will when it is installed.
//
//	go run ./cmd/nuggetplugin examples/plugins/glance
//
// writes glance.nuggetplugin next to the folder.
package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/Rigby-Foundation/NuggetVPN/internal/plugins"
)

func main() {
	if len(os.Args) < 2 || len(os.Args) > 3 {
		fmt.Fprintln(os.Stderr, "usage: nuggetplugin <plugin folder> [output file]")
		os.Exit(2)
	}
	dir := filepath.Clean(os.Args[1])
	data, pkg, err := plugins.Pack(dir)
	if err != nil {
		fmt.Fprintln(os.Stderr, "not a valid plugin:", err)
		os.Exit(1)
	}
	output := filepath.Clean(dir) + plugins.Extension
	if len(os.Args) == 3 {
		output = os.Args[2]
	}
	if !strings.HasSuffix(output, plugins.Extension) {
		output += plugins.Extension
	}
	if err := os.WriteFile(output, data, 0o644); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	fmt.Printf("%s %s: %s (%d KB)\n", pkg.Manifest.Name, pkg.Manifest.Version, output, (len(data)+1023)/1024)
	if len(pkg.Manifest.Permissions) > 0 || len(pkg.Manifest.Network) > 0 {
		fmt.Printf("asks for: %s\n", strings.Join(append(pkg.Manifest.Permissions, pkg.Manifest.Network...), ", "))
	}
}

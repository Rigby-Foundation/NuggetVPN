// fetchwintun packages the signed driver required by Xray's native Windows TUN.
package main

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"time"
)

// Published by https://www.wintun.net/ for the signed 0.14.1 distribution.
const archiveURL = "https://www.wintun.net/builds/wintun-0.14.1.zip"
const archiveSHA256 = "07c256185d6ee3652e09fa55c0b673e2624b565e02c4b9091c79ca7d2f24ef51"

func main() {
	arch := flag.String("arch", runtime.GOARCH, "target Windows architecture")
	output := flag.String("out", "bin", "output directory")
	flag.Parse()
	if err := fetch(*arch, *output); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func fetch(arch, output string) error {
	if arch == "386" {
		arch = "x86"
	}
	switch arch {
	case "amd64", "arm64", "arm", "x86":
	default:
		return fmt.Errorf("unsupported Wintun architecture %q", arch)
	}
	client := http.Client{Timeout: 30 * time.Second}
	response, err := client.Get(archiveURL)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("download Wintun: %s", response.Status)
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, 16<<20))
	if err != nil {
		return err
	}
	digest := sha256.Sum256(data)
	if hex.EncodeToString(digest[:]) != archiveSHA256 {
		return fmt.Errorf("Wintun archive checksum mismatch")
	}
	reader, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return err
	}
	wanted := map[string]string{"wintun/bin/" + arch + "/wintun.dll": "wintun.dll", "wintun/LICENSE.txt": "Wintun-LICENSE.txt"}
	if err = os.MkdirAll(output, 0o755); err != nil {
		return err
	}
	for _, file := range reader.File {
		name, ok := wanted[file.Name]
		if !ok {
			continue
		}
		source, err := file.Open()
		if err != nil {
			return err
		}
		body, err := io.ReadAll(io.LimitReader(source, 8<<20))
		_ = source.Close()
		if err != nil {
			return err
		}
		if err = os.WriteFile(filepath.Join(output, name), body, 0o644); err != nil {
			return err
		}
		delete(wanted, file.Name)
	}
	if len(wanted) > 0 {
		return fmt.Errorf("Wintun archive is missing the driver or license for %s", arch)
	}
	return nil
}

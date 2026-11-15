//go:build linux && !android

package app

import (
	"context"
	"os/exec"
	"strings"
	"time"
)

func systemFontFamilies() []string {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	output, err := exec.CommandContext(ctx, "fc-list", "--format", "%{family}\n").Output()
	if err != nil {
		return nil
	}
	lines := strings.Split(string(output), "\n")
	for index, family := range lines {
		// Fontconfig lists the primary family first and may append localized aliases.
		lines[index], _, _ = strings.Cut(family, ",")
	}
	return lines
}

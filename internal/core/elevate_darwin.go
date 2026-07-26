package core

import (
	"fmt"
	"os/exec"
	"strings"
)

// elevateAndRun launches the core service as root via the standard macOS
// authorization prompt. The command is backgrounded so osascript returns as
// soon as the user authorises it.
func elevateAndRun(executable string, args []string) error {
	quoted := make([]string, 0, len(args)+1)
	quoted = append(quoted, shellQuote(executable))
	for _, arg := range args {
		quoted = append(quoted, shellQuote(arg))
	}
	command := strings.Join(quoted, " ") + " >/dev/null 2>&1 &"

	script := fmt.Sprintf(
		"do shell script %s with administrator privileges",
		appleScriptString(command),
	)

	output, err := exec.Command("osascript", "-e", script).CombinedOutput()
	if err != nil {
		message := strings.TrimSpace(string(output))
		if strings.Contains(message, "-128") || strings.Contains(message, "User canceled") {
			return fmt.Errorf("administrator approval is required to create the VPN interface")
		}
		if message == "" {
			return fmt.Errorf("failed to start the privileged core service: %w", err)
		}
		return fmt.Errorf("failed to start the privileged core service: %s", message)
	}
	return nil
}

// shellQuote wraps a value in single quotes for /bin/sh.
func shellQuote(value string) string {
	return "'" + strings.ReplaceAll(value, "'", `'\''`) + "'"
}

// appleScriptString renders a Go string as an AppleScript string literal.
func appleScriptString(value string) string {
	escaped := strings.ReplaceAll(value, `\`, `\\`)
	escaped = strings.ReplaceAll(escaped, `"`, `\"`)
	return `"` + escaped + `"`
}

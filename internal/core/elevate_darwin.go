//go:build darwin && !ios

package core

import (
	"encoding/base64"
	"fmt"
	"html"
	"os/exec"
	"strings"
)

// serviceLogDir is where the service's output and its launchd job are kept.
const serviceLogDir = "/Library/Application Support/NuggetVPN"

// serviceLabel names the service's launchd job.
const serviceLabel = "org.rigbyfoundation.nuggetvpn.core"

// elevateAndRun launches the core service as root via the standard macOS
// authorization prompt.
//
// The service runs as a launchd job of its own, not as a child of the
// command the prompt runs. That command runs under
// com.apple.security.authtrampoline, and a process started from it stays in
// the trampoline's jetsam coalition: when macOS reclaims the idle trampoline
// (JETSAM_REASON_MEMORY_IDLE_EXIT, about half an hour in, sooner under memory
// pressure and on battery) it kills everything in the coalition, the service
// and the tunnel with it, and the app could only start a new one behind
// another password prompt. Under launchd the service is nobody's child, and
// "Interactive" keeps it from being throttled or reclaimed as idle.
//
// If launchd will not take the job, the old way still runs it.
func elevateAndRun(executable string, args []string) error {
	quoted := make([]string, 0, len(args)+1)
	quoted = append(quoted, shellQuote(executable))
	for _, arg := range args {
		quoted = append(quoted, shellQuote(arg))
	}
	// The service's own output goes to a log beside the cores, with the
	// previous run's kept: a service that dies takes its reason with it
	// otherwise, and the app only sees the control connection close.
	dir := shellQuote(serviceLogDir)
	current := shellQuote(serviceLogDir + "/service.log")
	previous := shellQuote(serviceLogDir + "/service.prev.log")
	plist := serviceLogDir + "/" + serviceLabel + ".plist"
	job := base64.StdEncoding.EncodeToString(launchdJob(append([]string{executable}, args...), serviceLogDir+"/service.log"))
	command := "mkdir -p " + dir + "; mv -f " + current + " " + previous + " 2>/dev/null; " +
		// A job from an earlier run, finished or not, is replaced.
		"launchctl bootout system/" + serviceLabel + " 2>/dev/null; " +
		"echo " + job + " | base64 -D > " + shellQuote(plist) + " && chmod 644 " + shellQuote(plist) + " && " +
		"launchctl bootstrap system " + shellQuote(plist) + " || { " +
		strings.Join(quoted, " ") + " >" + current + " 2>&1 & }"

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

// launchdJob is the service's launchd property list: run once now, never
// restarted by launchd (the app starts it when it is needed, and it stops
// itself when the app goes), its output in logPath.
func launchdJob(arguments []string, logPath string) []byte {
	var program strings.Builder
	for _, argument := range arguments {
		program.WriteString("\t\t<string>" + html.EscapeString(argument) + "</string>\n")
	}
	escapedLog := html.EscapeString(logPath)
	return []byte(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>` + serviceLabel + `</string>
	<key>ProgramArguments</key>
	<array>
` + program.String() + `	</array>
	<key>RunAtLoad</key>
	<true/>
	<key>KeepAlive</key>
	<false/>
	<key>ProcessType</key>
	<string>Interactive</string>
	<key>StandardOutPath</key>
	<string>` + escapedLog + `</string>
	<key>StandardErrorPath</key>
	<string>` + escapedLog + `</string>
</dict>
</plist>
`)
}

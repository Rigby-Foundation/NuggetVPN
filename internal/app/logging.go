package app

import (
	"errors"
	"fmt"
	"os"
	"regexp"
	"slices"
	"strings"
	"time"

	"github.com/Rigby-Foundation/NuggetVPN/internal/storage"
)

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

// LogBatch is the payload of a vpn-log event. It is a struct rather than a
// bare slice so the renderer never has to guess whether the runtime handed it
// one argument that is a list, or a list of arguments.
type LogBatch struct {
	Lines []string `json:"lines"`
}

const recentLogLimit = 1000

// logBuffer keeps recent lines in their original form, including ANSI colours.
// The file on disk is plain text, so it cannot serve as the viewer's history.
type logBuffer struct {
	lines []string
	next  int
}

func (b *logBuffer) append(lines []string) {
	for _, line := range lines {
		if len(b.lines) < recentLogLimit {
			b.lines = append(b.lines, line)
			continue
		}
		b.lines[b.next] = line
		b.next = (b.next + 1) % recentLogLimit
	}
}

// GetLogs returns the latest lines recorded during this run.
func (a *App) GetLogs() LogBatch {
	a.logMu.Lock()
	defer a.logMu.Unlock()
	if !a.loggingOn.Load() {
		return LogBatch{}
	}
	return LogBatch{Lines: slices.Concat(a.recentLogs.lines[a.recentLogs.next:], a.recentLogs.lines[:a.recentLogs.next])}
}

// ExportLogs saves the recent session logs as plain text at the chosen path.
func (a *App) ExportLogs() (string, error) {
	if len(a.GetLogs().Lines) == 0 {
		return "", nil
	}
	path, err := a.ShowSaveDialog("Kage-" + time.Now().Format("2006-01-02-150405") + ".log")
	if err != nil || path == "" {
		return "", err
	}
	lines := a.GetLogs().Lines
	if len(lines) == 0 {
		return "", nil
	}
	if sameLogFile(path, storage.LogPath()) {
		return "", fmt.Errorf("choose a different file to export the logs")
	}
	data := StripANSI(strings.Join(lines, "\n")) + "\n"
	if err := os.WriteFile(path, []byte(data), 0o600); err != nil {
		return "", err
	}
	return path, nil
}

func sameLogFile(path, logPath string) bool {
	if path == logPath {
		return true
	}
	selected, err := os.Stat(path)
	if err != nil {
		return false
	}
	current, err := os.Stat(logPath)
	return err == nil && os.SameFile(selected, current)
}

func (a *App) appendLog(lines ...string) {
	if len(lines) == 0 || !a.loggingOn.Load() {
		return
	}
	a.logMu.Lock()
	// Logging may have been turned off while this writer waited for the lock.
	if !a.loggingOn.Load() {
		a.logMu.Unlock()
		return
	}
	a.recentLogs.append(lines)
	if a.logFile == nil {
		a.logFile, _ = os.OpenFile(storage.LogPath(), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	}
	if a.logFile != nil {
		for _, line := range lines {
			_, _ = a.logFile.WriteString(StripANSI(line) + "\n")
		}
	}
	a.logMu.Unlock()
	a.emit(logEventName, LogBatch{Lines: lines})
}

// discardLogs closes the log file and deletes it. Called when logging is
// switched off: someone turning logs off does not want the old ones left
// behind either.
func (a *App) discardLogs() {
	a.logMu.Lock()
	defer a.logMu.Unlock()
	a.recentLogs = logBuffer{}
	if a.logFile != nil {
		_ = a.logFile.Close()
		a.logFile = nil
	}
	if err := os.Remove(storage.LogPath()); err != nil && !errors.Is(err, os.ErrNotExist) {
		// Nothing to tell the user through: the log is what is off.
		return
	}
}

// ansiSequence matches the colour codes Xray writes (SGR: ESC [ ... m).
var ansiSequence = regexp.MustCompile(`\x1b\[[0-9;:]*m`)

// StripANSI removes terminal colour codes.
//
// The core colours its log for a terminal. The UI renders those colours, so
// the live stream keeps them; the log file is read in text editors and
// attached to bug reports, where they are only noise.
func StripANSI(line string) string {
	return ansiSequence.ReplaceAllString(line, "")
}

// withLevel prefixes a core log line only if its formatter omitted the level.
func withLevel(level, message string) string {
	upper := strings.ToUpper(strings.TrimSpace(level))
	plain := strings.ToUpper(StripANSI(message))
	if upper == "" || strings.HasPrefix(plain, upper) || strings.HasPrefix(plain, "["+upper+"]") ||
		(upper == "WARN" && strings.HasPrefix(plain, "[WARNING]")) {
		return message
	}
	return upper + " " + message
}

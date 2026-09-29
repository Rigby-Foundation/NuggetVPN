package app

import (
	"errors"
	"os"
	"regexp"
	"strings"

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

func (a *App) appendLog(lines ...string) {
	if len(lines) == 0 {
		return
	}
	// With logging off nothing is kept anywhere: not on screen, not on disk.
	if !a.loggingOn.Load() {
		return
	}
	a.emit(logEventName, LogBatch{Lines: lines})

	a.logMu.Lock()
	defer a.logMu.Unlock()
	if a.logFile == nil {
		file, err := os.OpenFile(storage.LogPath(), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
		if err != nil {
			return
		}
		a.logFile = file
	}
	for _, line := range lines {
		_, _ = a.logFile.WriteString(StripANSI(line) + "\n")
	}
}

// discardLogs closes the log file and deletes it. Called when logging is
// switched off: someone turning logs off does not want the old ones left
// behind either.
func (a *App) discardLogs() {
	a.logMu.Lock()
	defer a.logMu.Unlock()
	if a.logFile != nil {
		_ = a.logFile.Close()
		a.logFile = nil
	}
	if err := os.Remove(storage.LogPath()); err != nil && !errors.Is(err, os.ErrNotExist) {
		// Nothing to tell the user through: the log is what is off.
		return
	}
}

// ansiSequence matches the colour codes sing-box writes (SGR: ESC [ ... m).
var ansiSequence = regexp.MustCompile(`\x1b\[[0-9;]*m`)

// StripANSI removes terminal colour codes.
//
// The core colours its log for a terminal. The UI renders those colours, so
// the live stream keeps them; the log file is read in text editors and
// attached to bug reports, where they are only noise.
func StripANSI(line string) string {
	return ansiSequence.ReplaceAllString(line, "")
}

// withLevel prefixes a core log line with its level, unless the core's own
// formatter already led with it — which it does, so the prefix used to print
// every level twice: "INFO INFO[0000] ...".
func withLevel(level, message string) string {
	upper := strings.ToUpper(strings.TrimSpace(level))
	if upper == "" || strings.HasPrefix(StripANSI(message), upper) {
		return message
	}
	return upper + " " + message
}

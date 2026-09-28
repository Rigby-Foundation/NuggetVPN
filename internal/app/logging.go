package app

import (
	"os"
	
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
		_, _ = a.logFile.WriteString(line + "\n")
	}
}

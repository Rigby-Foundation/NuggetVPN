//go:build ios

package ios

import (
	"encoding/json"
	"os"
	"runtime/debug"
	"strconv"
	"sync"

	"github.com/Rigby-Foundation/NuggetVPN/internal/xrayruntime"
)

var tunnelRunMu sync.Mutex
var instance xrayruntime.Instance

const extensionMemoryLimit = 32 << 20

// StartTunnel passes NetworkExtension's descriptor straight to native Xray.
func StartTunnel(data []byte, fd int) error {
	tunnelRunMu.Lock()
	defer tunnelRunMu.Unlock()
	_ = instance.Stop()
	debug.SetMemoryLimit(extensionMemoryLimit)
	var request struct {
		Config    json.RawMessage `json:"config"`
		Script    string          `json:"script"`
		RuleCount int             `json:"rule_count"`
	}
	if err := json.Unmarshal(data, &request); err != nil {
		return err
	}
	if err := os.Setenv("XRAY_TUN_FD", strconv.Itoa(fd)); err != nil {
		return err
	}
	if err := instance.StartConfig(request.Config, request.Script, request.RuleCount, nil); err != nil {
		_ = os.Unsetenv("XRAY_TUN_FD")
		return err
	}
	return nil
}
func StopTunnel() {
	tunnelRunMu.Lock()
	defer tunnelRunMu.Unlock()
	_ = instance.Stop()
	_ = os.Unsetenv("XRAY_TUN_FD")
}
func TunnelStats() (int64, int64) { up, down, _ := instance.Stats(); return up, down }

package core

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Controller is where an external core's Clash-compatible API listens: on
// loopback, behind a secret generated for each start, and only ever called
// by this service.
type Controller struct {
	Port   int    `json:"port"`
	Secret string `json:"secret"`
}

// StartRequest is a start of any core.
type StartRequest struct {
	// Core is CoreBuiltin (or empty), CoreSingBox, CoreMihomo, or CoreXray.
	Core string
	// Config is the built-in core's config; for CoreSingBox and CoreMihomo it
	// is that core's own config (JSON or YAML). With CoreXray it is the
	// built-in core's config, which reaches the servers through Xray.
	Config []byte
	// Aux is Xray's own config, for CoreXray.
	Aux []byte
	// Controller is the external core's API, for CoreSingBox and CoreMihomo.
	Controller *Controller
}

// externalProcess is a core running as a child process.
type externalProcess struct {
	name       string
	cmd        *exec.Cmd
	done       chan struct{}
	controller *Controller
	stopping   bool
	mu         sync.Mutex
}

func (p *externalProcess) alive() bool {
	if p == nil {
		return false
	}
	select {
	case <-p.done:
		return false
	default:
		return true
	}
}

// stop ends the process, waiting briefly for it to exit.
func (p *externalProcess) stop() {
	if p == nil || !p.alive() {
		return
	}
	p.mu.Lock()
	p.stopping = true
	p.mu.Unlock()
	_ = p.cmd.Process.Kill()
	select {
	case <-p.done:
	case <-time.After(5 * time.Second):
	}
}

// runDir is where a core's config and data live while it runs: inside the
// administrator-only cores directory, so no unprivileged process can change
// a config between being written and being read.
func runDir(name string) string {
	return filepath.Join(coresRoot(), "run", name)
}

// launchCore starts an installed core with its config written to its run
// directory. onExit is called if it exits without being asked to.
func launchCore(name string, files map[string][]byte, args func(dir string) []string, controller *Controller, sink LogSink, onExit func(error)) (*externalProcess, error) {
	binary, err := verifiedCore(name)
	if err != nil {
		return nil, err
	}
	dir := runDir(name)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	for file, data := range files {
		if err := os.WriteFile(filepath.Join(dir, file), data, 0o600); err != nil {
			return nil, err
		}
	}

	cmd := exec.Command(binary, args(dir)...)
	cmd.Dir = dir
	hideWindow(cmd)
	output, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	cmd.Stderr = cmd.Stdout
	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("start %s: %w", name, err)
	}

	process := &externalProcess{name: name, cmd: cmd, done: make(chan struct{}), controller: controller}
	var tail lastLines
	go func() {
		scanner := bufio.NewScanner(output)
		scanner.Buffer(make([]byte, 0, 64<<10), 1<<20)
		for scanner.Scan() {
			line := strings.TrimSpace(scanner.Text())
			if line == "" {
				continue
			}
			tail.add(line)
			if sink != nil {
				sink(levelOf(line), line)
			}
		}
	}()
	go func() {
		waitErr := cmd.Wait()
		close(process.done)
		process.mu.Lock()
		stopping := process.stopping
		process.mu.Unlock()
		if !stopping && onExit != nil {
			onExit(fmt.Errorf("%s exited: %v%s", name, waitErr, tail.suffix()))
		}
	}()
	return process, nil
}

// waitReady waits for an external core to either answer on its controller
// or exit, so a config it rejects is reported as a failed start rather than
// as a drop a moment later.
func (p *externalProcess) waitReady(timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if !p.alive() {
			return fmt.Errorf("%s stopped straight away; see the log for why", p.name)
		}
		if p.controller == nil {
			// Nothing to ask; staying up for a moment is the best sign.
			if time.Until(deadline) < timeout-1500*time.Millisecond {
				return nil
			}
		} else if _, err := p.api(http.MethodGet, "/version"); err == nil {
			return nil
		}
		time.Sleep(150 * time.Millisecond)
	}
	if p.controller != nil {
		return fmt.Errorf("%s did not come up in time", p.name)
	}
	return nil
}

// api calls the external core's controller.
func (p *externalProcess) api(method, route string) ([]byte, error) {
	if p == nil || p.controller == nil {
		return nil, errors.New("no controller")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, method, "http://127.0.0.1:"+strconv.Itoa(p.controller.Port)+route, nil)
	if err != nil {
		return nil, err
	}
	request.Header.Set("Authorization", "Bearer "+p.controller.Secret)
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, 32<<20))
	if err != nil {
		return nil, err
	}
	if response.StatusCode >= 300 {
		return nil, fmt.Errorf("%s answered %d", p.name, response.StatusCode)
	}
	return body, nil
}

// clashConnections is the Clash API's connection list, which mihomo and
// sing-box both serve.
type clashConnections struct {
	DownloadTotal int64 `json:"downloadTotal"`
	UploadTotal   int64 `json:"uploadTotal"`
	Connections   []struct {
		ID       string `json:"id"`
		Metadata struct {
			Network         string `json:"network"`
			Type            string `json:"type"`
			DestinationIP   string `json:"destinationIP"`
			DestinationPort string `json:"destinationPort"`
			Host            string `json:"host"`
			SniffHost       string `json:"sniffHost"`
			ProcessPath     string `json:"processPath"`
			Process         string `json:"process"`
		} `json:"metadata"`
		Upload      int64    `json:"upload"`
		Download    int64    `json:"download"`
		Start       string   `json:"start"`
		Chains      []string `json:"chains"`
		Rule        string   `json:"rule"`
		RulePayload string   `json:"rulePayload"`
	} `json:"connections"`
}

func (p *externalProcess) connections() (clashConnections, error) {
	var result clashConnections
	body, err := p.api(http.MethodGet, "/connections")
	if err != nil {
		return result, err
	}
	err = json.Unmarshal(body, &result)
	return result, err
}

// externalConnections converts the Clash API's list to the service's own.
func (p *externalProcess) externalConnections() ([]ConnectionInfo, bool) {
	list, err := p.connections()
	if err != nil {
		return nil, false
	}
	result := make([]ConnectionInfo, 0, len(list.Connections))
	for _, connection := range list.Connections {
		metadata := connection.Metadata
		info := ConnectionInfo{
			ID:          connection.ID,
			Network:     strings.ToLower(metadata.Network),
			Host:        firstNonEmpty(metadata.Host, metadata.SniffHost),
			Destination: joinHostPort(metadata.DestinationIP, metadata.DestinationPort),
			Process:     firstNonEmpty(metadata.ProcessPath, metadata.Process),
			Rule:        -1,
			Upload:      connection.Upload,
			Download:    connection.Download,
		}
		if connection.Rule != "" {
			info.RuleText = connection.Rule
			if connection.RulePayload != "" {
				info.RuleText += "," + connection.RulePayload
			}
		}
		// The first chain entry is the proxy the connection actually left
		// through; the rest are the groups that chose it.
		if len(connection.Chains) > 0 {
			info.Outbound = connection.Chains[0]
		}
		if started, err := time.Parse(time.RFC3339Nano, connection.Start); err == nil {
			info.Started = started.UnixMilli()
		}
		result = append(result, info)
	}
	sort.Slice(result, func(a, b int) bool { return result[a].Started < result[b].Started })
	return result, true
}

func (p *externalProcess) externalStats() (int64, int64, bool) {
	list, err := p.connections()
	if err != nil {
		return 0, 0, false
	}
	return list.UploadTotal, list.DownloadTotal, true
}

func (p *externalProcess) closeConnection(id string) error {
	if id == "" {
		_, err := p.api(http.MethodDelete, "/connections")
		return err
	}
	_, err := p.api(http.MethodDelete, "/connections/"+url.PathEscape(id))
	return err
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}

func joinHostPort(host, port string) string {
	if host == "" {
		return ""
	}
	if strings.Contains(host, ":") {
		host = "[" + host + "]"
	}
	if port == "" {
		return host
	}
	return host + ":" + port
}

// levelOf guesses a log line's level from the words the three cores use.
func levelOf(line string) string {
	lower := strings.ToLower(line)
	switch {
	case strings.Contains(lower, "level=error"), strings.Contains(lower, "[error]"), strings.Contains(line, "ERROR"), strings.Contains(line, "FATAL"):
		return "error"
	case strings.Contains(lower, "level=warn"), strings.Contains(lower, "[warning]"), strings.Contains(line, "WARN"):
		return "warn"
	case strings.Contains(lower, "level=debug"), strings.Contains(lower, "[debug]"), strings.Contains(line, "DEBUG"):
		return "debug"
	}
	return "info"
}

// lastLines keeps a process's last few lines, to explain why it exited.
type lastLines struct {
	mu    sync.Mutex
	lines []string
}

func (l *lastLines) add(line string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.lines = append(l.lines, line)
	if len(l.lines) > 3 {
		l.lines = l.lines[len(l.lines)-3:]
	}
}

func (l *lastLines) suffix() string {
	l.mu.Lock()
	defer l.mu.Unlock()
	if len(l.lines) == 0 {
		return ""
	}
	return " — " + strings.Join(l.lines, " / ")
}

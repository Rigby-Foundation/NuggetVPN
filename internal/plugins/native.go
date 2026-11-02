package plugins

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"sync"
	"time"
)

const maxMessage = 1 << 20

// NativeHandler handles backend calls using the identity assigned by the host,
// never a plugin-provided id. Methods share the page API's Go dispatcher.
type NativeHandler func(id, method string, params json.RawMessage) (any, error)

type wireMessage struct {
	ID     json.RawMessage `json:"id,omitempty"`
	Method string          `json:"method,omitempty"`
	Params json.RawMessage `json:"params,omitempty"`
	Result json.RawMessage `json:"result,omitempty"`
	Error  string          `json:"error,omitempty"`
	Event  string          `json:"event,omitempty"`
	Data   json.RawMessage `json:"data,omitempty"`
}

// NativeHost supervises one process per enabled native plugin. Failed plugins
// are not restarted automatically; disable/re-enable to retry.
type NativeHost struct {
	mu        sync.Mutex
	processes map[string]*nativeProcess
	closed    bool
	handle    NativeHandler
	event     func(id, name string, data json.RawMessage)
}

type nativeProcess struct {
	mu            sync.Mutex
	cmd           *exec.Cmd
	stdin         io.WriteCloser
	output        chan []byte
	done          chan struct{}
	ready         chan struct{}
	once          sync.Once
	pending       map[string]chan wireMessage
	next          uint64
	checksum      string
	err           string
	subscriptions map[string]bool
	cleanup       func()
}

func NewNativeHost(handle NativeHandler, event func(string, string, json.RawMessage)) *NativeHost {
	return &NativeHost{processes: map[string]*nativeProcess{}, handle: handle, event: event}
}

// Sync starts supported, approved plugins and stops disabled/changed ones.
func (h *NativeHost) Sync(store *Store, list []Installed) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.closed {
		return
	}
	wanted := map[string]Installed{}
	for _, plugin := range list {
		if plugin.State.Enabled && !plugin.State.ApprovalRequired && plugin.Manifest.Backend.Executable() != "" {
			wanted[plugin.Manifest.ID] = plugin
		}
	}
	for id, process := range h.processes {
		plugin, ok := wanted[id]
		if !ok || plugin.Checksum != process.checksum {
			process.stop("plugin disabled or changed")
			delete(h.processes, id)
		}
	}
	for id, plugin := range wanted {
		if _, ok := h.processes[id]; ok {
			continue
		}
		process := &nativeProcess{checksum: plugin.Checksum, pending: map[string]chan wireMessage{}, subscriptions: map[string]bool{}, output: make(chan []byte, 64), done: make(chan struct{}), ready: make(chan struct{})}
		h.processes[id] = process
		pkg, err := store.VerifiedPackage(id)
		if err != nil || pkg.Checksum() != plugin.Checksum {
			process.stop("plugin checksum changed")
			continue
		}
		if err := process.start(store, pkg, h.handle, h.event); err != nil {
			process.stop(err.Error())
		}
	}
}

func (p *nativeProcess) start(store *Store, pkg *Package, handle NativeHandler, event func(string, string, json.RawMessage)) error {
	// Execute a private copy of the verified snapshot, never reopen the installed
	// executable after verification. Runtime files are discarded on process exit.
	dir, err := os.MkdirTemp("", "nugget-plugin-")
	if err != nil {
		return err
	}
	p.cleanup = func() { _ = os.RemoveAll(dir) }
	fail := true
	defer func() {
		if fail {
			p.cleanup()
		}
	}()
	for name, content := range pkg.Files {
		target := filepath.Join(dir, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(target), 0o700); err != nil {
			return err
		}
		if err := os.WriteFile(target, content, 0o600); err != nil {
			return err
		}
	}
	executable := filepath.Join(dir, filepath.FromSlash(pkg.Manifest.Backend.Executable()))
	if err := os.Chmod(executable, 0o700); err != nil {
		return err
	}
	dataDir := filepath.Join(store.dir, "native-data", pkg.Manifest.ID)
	if err := os.MkdirAll(dataDir, 0o700); err != nil {
		return err
	}
	dataDir, err = filepath.Abs(dataDir)
	if err != nil {
		return err
	}
	cmd := exec.Command(executable)
	cmd.Dir = dir
	// Do not inherit the GUI's environment, credentials, or core-service data.
	cmd.Env = []string{"NUGGET_PLUGIN_ID=" + pkg.Manifest.ID, "NUGGET_PLUGIN_DATA=" + dataDir, "NUGGET_PLUGIN_API=1"}
	for _, key := range []string{"PATH", "SystemRoot", "WINDIR", "TEMP", "TMP", "TMPDIR", "LANG", "LC_ALL"} {
		if value, ok := os.LookupEnv(key); ok {
			cmd.Env = append(cmd.Env, key+"="+value)
		}
	}
	prepareNativeCommand(cmd)
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		stdin.Close()
		return err
	}
	// Logs cannot block protocol traffic or consume unbounded memory/disk.
	cmd.Stderr = io.Discard
	if err := cmd.Start(); err != nil {
		stdin.Close()
		stdout.Close()
		return err
	}
	p.cmd, p.stdin = cmd, stdin
	cleanup, err := containNativeCommand(cmd)
	if err != nil {
		_ = cmd.Process.Kill()
		_ = cmd.Wait()
		stdin.Close()
		return err
	}
	fail = false
	go func() {
		err := cmd.Wait()
		if err != nil {
			p.stop("backend exited: " + err.Error())
		} else {
			p.stop("backend exited")
		}
		cleanup()
		p.cleanup()
	}()
	go func() {
		for {
			select {
			case <-p.done:
				return
			case data := <-p.output:
				if _, err := stdin.Write(append(data, '\n')); err != nil {
					p.stop("backend pipe closed")
					return
				}
			}
		}
	}()
	go p.read(stdout, pkg.Manifest.ID, handle, event)
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		params, _ := json.Marshal(map[string]any{"api": 1, "plugin": pkg.Manifest.ID, "data_dir": dataDir})
		result, err := p.call(ctx, "plugin.initialize", params)
		if err != nil {
			p.stop("backend initialization failed: " + err.Error())
			return
		}
		var hello struct {
			API int `json:"api"`
		}
		if json.Unmarshal(result, &hello) != nil || hello.API != 1 {
			p.stop("backend initialization needs api 1")
			return
		}
		close(p.ready)
	}()
	return nil
}

func (p *nativeProcess) stop(reason string) {
	p.once.Do(func() {
		p.mu.Lock()
		p.err = reason
		close(p.done)
		p.mu.Unlock()
		if p.stdin != nil {
			_ = p.stdin.Close()
		}
		if p.cmd != nil {
			killNativeCommand(p.cmd)
		}
	})
}

func (p *nativeProcess) send(message wireMessage) error {
	data, err := json.Marshal(message)
	if err != nil {
		return err
	}
	if len(data) > maxMessage {
		return errors.New("backend message is too large")
	}
	select {
	case <-p.done:
		return errors.New("backend is stopped")
	default:
	}
	select {
	case <-p.done:
		return errors.New("backend is stopped")
	case p.output <- data:
		return nil
	default:
		return errors.New("backend message queue is full")
	}
}

func (p *nativeProcess) read(stdout io.Reader, id string, handle NativeHandler, event func(string, string, json.RawMessage)) {
	scanner := bufio.NewScanner(stdout)
	scanner.Buffer(make([]byte, 4096), maxMessage)
	requests := make(chan struct{}, 16)
	for scanner.Scan() {
		var message wireMessage
		if err := json.Unmarshal(scanner.Bytes(), &message); err != nil {
			p.stop("invalid backend JSON")
			return
		}
		if message.Method != "" {
			if len(message.ID) == 0 {
				p.stop("backend request needs an id")
				return
			}
			select {
			case requests <- struct{}{}:
			default:
				p.stop("too many backend requests")
				return
			}
			go func(message wireMessage) {
				defer func() { <-requests }()
				result, err := handle(id, message.Method, message.Params)
				if err == nil && message.Method == "events.subscribe" {
					var params struct {
						Event string `json:"event"`
					}
					_ = json.Unmarshal(message.Params, &params)
					p.mu.Lock()
					p.subscriptions[params.Event] = true
					p.mu.Unlock()
				}
				reply := wireMessage{ID: message.ID}
				if err != nil {
					reply.Error = err.Error()
				} else {
					reply.Result, err = json.Marshal(result)
					if err != nil {
						reply.Error = "cannot encode result"
					}
				}
				if err := p.send(reply); err != nil {
					p.stop(err.Error())
				}
			}(message)
		} else if message.Event != "" {
			if len(message.Event) > 100 {
				p.stop("backend event name is too long")
				return
			}
			if event != nil {
				event(id, message.Event, message.Data)
			}
		} else if len(message.ID) != 0 {
			p.mu.Lock()
			waiter := p.pending[string(message.ID)]
			p.mu.Unlock()
			if waiter != nil {
				select {
				case waiter <- message:
				default:
				}
			}
		} else {
			p.stop("invalid backend message")
			return
		}
	}
	p.stop("backend output closed")
}

func (p *nativeProcess) call(ctx context.Context, method string, params json.RawMessage) (json.RawMessage, error) {
	if method == "" || len(method) > 100 || len(params) > maxMessage/2 {
		return nil, errors.New("invalid backend request")
	}
	p.mu.Lock()
	if len(p.pending) >= 32 {
		p.mu.Unlock()
		return nil, errors.New("too many pending backend calls")
	}
	p.next++
	id := strconv.FormatUint(p.next, 10)
	waiter := make(chan wireMessage, 1)
	p.pending[id] = waiter
	p.mu.Unlock()
	defer func() { p.mu.Lock(); delete(p.pending, id); p.mu.Unlock() }()
	if err := p.send(wireMessage{ID: json.RawMessage(id), Method: method, Params: params}); err != nil {
		return nil, err
	}
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-p.done:
		return nil, errors.New("backend is stopped")
	case reply := <-waiter:
		if reply.Error != "" {
			return nil, errors.New(reply.Error)
		}
		if len(reply.Result) == 0 {
			return json.RawMessage("null"), nil
		}
		return reply.Result, nil
	}
}

func (h *NativeHost) Call(ctx context.Context, id, method string, params json.RawMessage) (json.RawMessage, error) {
	h.mu.Lock()
	process := h.processes[id]
	h.mu.Unlock()
	if process == nil {
		return nil, errors.New("native backend is not running")
	}
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-process.done:
		return nil, errors.New("backend is stopped")
	case <-process.ready:
	}
	return process.call(ctx, method, params)
}

func (h *NativeHost) Status(id string) string {
	h.mu.Lock()
	p := h.processes[id]
	h.mu.Unlock()
	if p == nil {
		return ""
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.err
}

func (h *NativeHost) Publish(name string, data any, allowed func(string) bool) {
	raw, err := json.Marshal(data)
	if err != nil {
		return
	}
	h.mu.Lock()
	processes := make(map[string]*nativeProcess, len(h.processes))
	for id, p := range h.processes {
		processes[id] = p
	}
	h.mu.Unlock()
	for id, p := range processes {
		p.mu.Lock()
		subscribed := p.subscriptions[name]
		p.mu.Unlock()
		if subscribed && allowed(id) {
			if err := p.send(wireMessage{Event: name, Data: raw}); err != nil {
				p.stop(err.Error())
			}
		}
	}
}

func (h *NativeHost) Stop(id string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if p := h.processes[id]; p != nil {
		p.stop("plugin stopped")
		delete(h.processes, id)
	}
}

func (h *NativeHost) Close() {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.closed = true
	for id, p := range h.processes {
		p.stop("app is shutting down")
		delete(h.processes, id)
	}
}

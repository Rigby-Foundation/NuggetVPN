package core

import (
	"bufio"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"sync"
	"time"
)

// dialTimeout bounds a single connection attempt to the control socket.
const dialTimeout = 2 * time.Second

// startupTimeout bounds how long we wait for the elevated service to come up
// after the user approves the prompt.
const startupTimeout = 60 * time.Second

// staleServiceTimeout bounds how long we wait for a service we cannot
// authenticate against to notice its own parent died and exit.
const staleServiceTimeout = 10 * time.Second

// Client drives the privileged core service from the GUI process.
type Client struct {
	socketPath string
	tokenPath  string
	version    string

	mu       sync.Mutex
	conn     net.Conn
	encoder  *json.Encoder
	nextID   uint64
	pending  map[uint64]chan Response
	closing  bool
	token    string
	onLog    func(level, message string)
	onState  func(running bool)
	onStats  func(up, down int64)
	elevated bool
}

// NewClient returns a client for the given control socket. tokenPath is where
// the per-session credential is handed to the elevated service.
func NewClient(socketPath, tokenPath, version string) *Client {
	return &Client{
		socketPath: socketPath,
		tokenPath:  tokenPath,
		version:    version,
		pending:    map[uint64]chan Response{},
	}
}

// OnLog registers the sink for sing-box log lines.
func (c *Client) OnLog(handler func(level, message string)) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.onLog = handler
}

// OnState registers the sink for running-state changes.
func (c *Client) OnState(handler func(running bool)) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.onState = handler
}

// OnStats registers the sink for the byte counters the core pushes once a
// second while the tunnel is up.
func (c *Client) OnStats(handler func(up, down int64)) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.onStats = handler
}

// Connected reports whether the control connection is currently open.
func (c *Client) Connected() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.conn != nil
}

// Ensure connects to the core service, launching it under an elevation prompt
// if it is not already running. Callers should invoke it right before Start.
func (c *Client) Ensure() error {
	if c.Connected() {
		return nil
	}

	if err := c.connect(); err == nil {
		response, handshakeErr := c.handshake()
		switch {
		case handshakeErr == nil && response.Version == c.version:
			return nil

		case handshakeErr == nil:
			// A service left over from a previous build must be replaced.
			_, _ = c.request(Request{Cmd: CmdShutdown})
			c.disconnect()
			time.Sleep(300 * time.Millisecond)

		default:
			// Something is listening that will not accept our token: almost
			// always a service from an earlier GUI session, whose token file is
			// long gone. We cannot command it, but its parent watcher will reap
			// it within a couple of seconds, so wait rather than fighting it.
			c.disconnect()
			c.waitForStaleService()
		}
	}

	// A socket file with nothing behind it blocks the new listener.
	if _, err := os.Stat(c.socketPath); err == nil {
		_ = os.Remove(c.socketPath)
	}

	if err := c.launchService(); err != nil {
		return err
	}

	deadline := time.Now().Add(startupTimeout)
	for time.Now().Before(deadline) {
		if err := c.connect(); err == nil {
			if _, err := c.handshake(); err == nil {
				return nil
			}
			c.disconnect()
		}
		time.Sleep(200 * time.Millisecond)
	}
	return errors.New("timed out waiting for the privileged core service to start")
}

// waitForStaleService blocks until nothing answers on the socket any more, or
// the timeout expires.
func (c *Client) waitForStaleService() {
	deadline := time.Now().Add(staleServiceTimeout)
	for time.Now().Before(deadline) {
		conn, err := net.DialTimeout("unix", c.socketPath, dialTimeout)
		if err != nil {
			return
		}
		_ = conn.Close()
		time.Sleep(250 * time.Millisecond)
	}
}

// handshake authenticates the open connection. It must be the first thing sent
// on a connection; the service closes anything that does not lead with it.
func (c *Client) handshake() (Response, error) {
	c.mu.Lock()
	token := c.token
	c.mu.Unlock()

	if token == "" {
		return Response{}, errors.New("no control token for this session")
	}
	return c.request(Request{Cmd: CmdHello, Token: token})
}

// newToken generates the per-session credential and writes it where the
// elevated service will read it, with owner-only permissions.
//
// It goes through a file rather than argv because argv is world-readable on
// Linux and inspectable by other processes on Windows, and the credential opens
// a root-owned control socket that accepts arbitrary sing-box configs.
func (c *Client) newToken() (string, error) {
	buffer := make([]byte, 32)
	if _, err := rand.Read(buffer); err != nil {
		return "", fmt.Errorf("generate control token: %w", err)
	}
	token := hex.EncodeToString(buffer)

	if err := os.MkdirAll(filepath.Dir(c.tokenPath), 0o755); err != nil {
		return "", err
	}
	// Created with the final mode rather than written and chmod-ed, so the
	// token is never readable by anyone else, even briefly.
	file, err := os.OpenFile(c.tokenPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	if err != nil {
		return "", fmt.Errorf("write control token: %w", err)
	}
	defer file.Close()
	if _, err := file.WriteString(token); err != nil {
		return "", fmt.Errorf("write control token: %w", err)
	}

	c.mu.Lock()
	c.token = token
	c.mu.Unlock()
	return token, nil
}

// launchService re-executes this binary with --core-service under elevation.
func (c *Client) launchService() error {
	executable, err := os.Executable()
	if err != nil {
		return fmt.Errorf("locate executable: %w", err)
	}
	if _, err := c.newToken(); err != nil {
		return err
	}

	args := []string{
		"--core-service",
		"--socket", c.socketPath,
		"--token-file", c.tokenPath,
		"--uid", strconv.Itoa(os.Getuid()),
		"--gid", strconv.Itoa(os.Getgid()),
		"--parent", strconv.Itoa(os.Getpid()),
	}
	if err := elevateAndRun(executable, args); err != nil {
		return err
	}
	c.mu.Lock()
	c.elevated = true
	c.mu.Unlock()
	return nil
}

func (c *Client) connect() error {
	conn, err := net.DialTimeout("unix", c.socketPath, dialTimeout)
	if err != nil {
		return err
	}

	c.mu.Lock()
	c.conn = conn
	c.encoder = json.NewEncoder(conn)
	c.closing = false
	c.mu.Unlock()

	go c.readLoop(conn)
	return nil
}

func (c *Client) disconnect() {
	c.mu.Lock()
	conn := c.conn
	c.conn, c.encoder = nil, nil
	c.closing = true
	pending := c.pending
	c.pending = map[uint64]chan Response{}
	c.mu.Unlock()

	if conn != nil {
		_ = conn.Close()
	}
	for _, waiter := range pending {
		close(waiter)
	}
}

// readLoop demultiplexes responses and events from the single connection.
func (c *Client) readLoop(conn net.Conn) {
	scanner := bufio.NewScanner(conn)
	scanner.Buffer(make([]byte, 0, 64*1024), 4*1024*1024)

	for scanner.Scan() {
		line := scanner.Bytes()
		if len(line) == 0 {
			continue
		}

		var envelope struct {
			ID      uint64 `json:"id"`
			Event   string `json:"event"`
			OK      bool   `json:"ok"`
			Error   string `json:"error"`
			Running bool   `json:"running"`
			Version string `json:"version"`
			Level   string `json:"level"`
			Message string `json:"message"`
			Up      int64  `json:"up"`
			Down    int64  `json:"down"`
		}
		if err := json.Unmarshal(line, &envelope); err != nil {
			continue
		}

		if envelope.Event != "" {
			c.dispatchEvent(envelope.Event, envelope.Level, envelope.Message,
				envelope.Running, envelope.Up, envelope.Down)
			continue
		}

		c.mu.Lock()
		waiter, ok := c.pending[envelope.ID]
		delete(c.pending, envelope.ID)
		c.mu.Unlock()
		if ok {
			waiter <- Response{
				ID:      envelope.ID,
				OK:      envelope.OK,
				Error:   envelope.Error,
				Running: envelope.Running,
				Version: envelope.Version,
				Up:      envelope.Up,
				Down:    envelope.Down,
			}
			close(waiter)
		}
	}

	c.mu.Lock()
	stillCurrent := c.conn == conn
	c.mu.Unlock()
	if stillCurrent {
		c.disconnect()
		// The core is gone, so whatever the UI last heard is now wrong: say so
		// explicitly rather than leaving it showing a tunnel that no longer
		// exists.
		c.dispatchEvent(EventState, "", "", false, 0, 0)
	}
}

func (c *Client) dispatchEvent(name, level, message string, running bool, up, down int64) {
	c.mu.Lock()
	onLog, onState, onStats := c.onLog, c.onState, c.onStats
	c.mu.Unlock()

	switch name {
	case EventLog:
		if onLog != nil {
			onLog(level, message)
		}
	case EventState:
		if onState != nil {
			onState(running)
		}
	case EventStats:
		if onStats != nil {
			onStats(up, down)
		}
	}
}

func (c *Client) request(request Request) (Response, error) {
	c.mu.Lock()
	if c.encoder == nil {
		c.mu.Unlock()
		return Response{}, errors.New("core service is not connected")
	}
	c.nextID++
	request.ID = c.nextID
	waiter := make(chan Response, 1)
	c.pending[request.ID] = waiter
	encoder := c.encoder
	c.mu.Unlock()

	if err := encoder.Encode(request); err != nil {
		c.mu.Lock()
		delete(c.pending, request.ID)
		c.mu.Unlock()
		return Response{}, fmt.Errorf("send %s: %w", request.Cmd, err)
	}

	select {
	case response, ok := <-waiter:
		if !ok {
			return Response{}, errors.New("core service connection closed")
		}
		if !response.OK {
			return response, errors.New(response.Error)
		}
		return response, nil
	case <-time.After(90 * time.Second):
		c.mu.Lock()
		delete(c.pending, request.ID)
		c.mu.Unlock()
		return Response{}, fmt.Errorf("core service did not answer %s in time", request.Cmd)
	}
}

// Start hands a generated config to the core service.
func (c *Client) Start(configJSON []byte) error {
	if err := c.Ensure(); err != nil {
		return err
	}
	_, err := c.request(Request{Cmd: CmdStart, Config: json.RawMessage(configJSON)})
	return err
}

// Stop tears the tunnel down but leaves the service running, so the next
// connection does not need another password prompt.
func (c *Client) Stop() error {
	if !c.Connected() {
		return nil
	}
	_, err := c.request(Request{Cmd: CmdStop})
	return err
}

// Running reports the core service's view of the tunnel state.
func (c *Client) Running() bool {
	if !c.Connected() {
		return false
	}
	response, err := c.request(Request{Cmd: CmdStatus})
	if err != nil {
		return false
	}
	return response.Running
}

// Stats reads the byte counters on demand. The core also pushes them once a
// second, so this is only for callers that need a value right now.
func (c *Client) Stats() (up, down int64, ok bool) {
	if !c.Connected() {
		return 0, 0, false
	}
	response, err := c.request(Request{Cmd: CmdStats})
	if err != nil {
		return 0, 0, false
	}
	return response.Up, response.Down, response.Running
}

// Shutdown stops the tunnel and asks the privileged service to exit. Called
// when the GUI quits so no root process outlives the app.
func (c *Client) Shutdown() {
	if !c.Connected() {
		return
	}
	_, _ = c.request(Request{Cmd: CmdShutdown})
	c.disconnect()
}

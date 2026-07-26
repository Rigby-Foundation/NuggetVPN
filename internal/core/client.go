package core

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"os"
	"strconv"
	"sync"
	"time"
)

// dialTimeout bounds a single connection attempt to the control socket.
const dialTimeout = 2 * time.Second

// startupTimeout bounds how long we wait for the elevated service to come up
// after the user approves the prompt.
const startupTimeout = 60 * time.Second

// Client drives the privileged core service from the GUI process.
type Client struct {
	socketPath string
	version    string

	mu       sync.Mutex
	conn     net.Conn
	encoder  *json.Encoder
	nextID   uint64
	pending  map[uint64]chan Response
	closing  bool
	onLog    func(level, message string)
	onState  func(running bool)
	elevated bool
}

// NewClient returns a client for the given control socket.
func NewClient(socketPath, version string) *Client {
	return &Client{
		socketPath: socketPath,
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
		// A service left over from a previous build must be replaced.
		if response, pingErr := c.request(Request{Cmd: CmdPing}); pingErr == nil {
			if response.Version == c.version {
				return nil
			}
			_, _ = c.request(Request{Cmd: CmdShutdown})
			c.disconnect()
			time.Sleep(300 * time.Millisecond)
		} else {
			c.disconnect()
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
			if _, err := c.request(Request{Cmd: CmdPing}); err == nil {
				return nil
			}
			c.disconnect()
		}
		time.Sleep(200 * time.Millisecond)
	}
	return errors.New("timed out waiting for the privileged core service to start")
}

// launchService re-executes this binary with --core-service under elevation.
func (c *Client) launchService() error {
	executable, err := os.Executable()
	if err != nil {
		return fmt.Errorf("locate executable: %w", err)
	}

	args := []string{
		"--core-service",
		"--socket", c.socketPath,
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
		}
		if err := json.Unmarshal(line, &envelope); err != nil {
			continue
		}

		if envelope.Event != "" {
			c.dispatchEvent(envelope.Event, envelope.Level, envelope.Message, envelope.Running)
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
			}
			close(waiter)
		}
	}

	c.mu.Lock()
	stillCurrent := c.conn == conn
	c.mu.Unlock()
	if stillCurrent {
		c.disconnect()
		c.dispatchEvent(EventState, "", "", false)
	}
}

func (c *Client) dispatchEvent(name, level, message string, running bool) {
	c.mu.Lock()
	onLog, onState := c.onLog, c.onState
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

// Shutdown stops the tunnel and asks the privileged service to exit. Called
// when the GUI quits so no root process outlives the app.
func (c *Client) Shutdown() {
	if !c.Connected() {
		return
	}
	_, _ = c.request(Request{Cmd: CmdShutdown})
	c.disconnect()
}

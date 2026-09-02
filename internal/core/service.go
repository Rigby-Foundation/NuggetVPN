package core

import (
	"bufio"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// statsInterval is how often the running tunnel's byte counters are pushed to
// connected clients. The GUI renders a per-second rate, so anything slower
// would make the speed readout lie.
const statsInterval = time.Second

// ServiceOptions configures the privileged core service.
type ServiceOptions struct {
	// SocketPath is the unix socket the GUI connects to.
	SocketPath string
	// Token authenticates clients. An empty token is refused outright rather
	// than silently accepting everyone.
	Token string
	// OwnerUID receives ownership of the socket so the unprivileged GUI can
	// talk to the service without opening it up to every local account.
	OwnerUID int
	// OwnerGID is the matching group; -1 leaves it unchanged.
	OwnerGID int
	// ParentPID is the GUI process. When it disappears the service tears the
	// tunnel down instead of leaving a root process owning the route table.
	ParentPID int
	// WorkingDir is where sing-box resolves relative paths (its cache file).
	WorkingDir string
	// Version is reported back on ping so a stale service can be detected.
	Version string
}

// Service hosts the embedded sing-box instance behind a unix socket.
type Service struct {
	options  ServiceOptions
	instance Instance

	mu      sync.Mutex
	clients map[*serviceClient]struct{}

	done     chan struct{}
	doneOnce sync.Once
}

type serviceClient struct {
	encoder *json.Encoder
	mu      sync.Mutex
	// authenticated flips once a valid CmdHello arrives. Until then the
	// connection may not do anything at all. It is atomic because the serve
	// goroutine sets it while broadcast reads it from the ticker goroutine.
	authenticated atomic.Bool
}

func (c *serviceClient) send(payload any) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.encoder.Encode(payload)
}

// ReadTokenFile loads the shared secret the GUI wrote for the service. The file
// is removed once read so a stale token cannot be replayed by a later process.
func ReadTokenFile(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", fmt.Errorf("read control token: %w", err)
	}
	_ = os.Remove(path)

	token := strings.TrimSpace(string(data))
	if token == "" {
		return "", errors.New("control token file is empty")
	}
	return token, nil
}

// RunService starts the privileged service and blocks until the GUI asks it to
// shut down or the parent process disappears.
func RunService(options ServiceOptions) error {
	if options.SocketPath == "" {
		return errors.New("core service requires --socket")
	}
	if options.Token == "" {
		return errors.New("core service requires a control token")
	}
	if options.WorkingDir != "" {
		if err := os.MkdirAll(options.WorkingDir, 0o755); err == nil {
			_ = os.Chdir(options.WorkingDir)
		}
	}

	service := &Service{
		options: options,
		clients: map[*serviceClient]struct{}{},
		done:    make(chan struct{}),
	}
	return service.run()
}

func (s *Service) run() error {
	if err := os.MkdirAll(filepath.Dir(s.options.SocketPath), 0o755); err != nil {
		return fmt.Errorf("create socket directory: %w", err)
	}
	// A socket left behind by a crashed service would block Listen.
	_ = os.Remove(s.options.SocketPath)

	listener, err := net.Listen("unix", s.options.SocketPath)
	if err != nil {
		return fmt.Errorf("listen on %s: %w", s.options.SocketPath, err)
	}
	defer listener.Close()
	defer os.Remove(s.options.SocketPath)

	// The service runs as root; hand the socket to the user that launched it.
	// This is defence in depth only. The token is what actually authenticates,
	// because chown and chmod do nothing for AF_UNIX sockets on Windows.
	if s.options.OwnerUID > 0 {
		gid := s.options.OwnerGID
		if gid < 0 {
			gid = -1
		}
		if err := os.Chown(s.options.SocketPath, s.options.OwnerUID, gid); err != nil {
			log.Printf("warning: could not chown control socket: %v", err)
		}
	}
	if err := os.Chmod(s.options.SocketPath, 0o600); err != nil {
		log.Printf("warning: could not chmod control socket: %v", err)
	}

	if s.options.ParentPID > 0 {
		go s.watchParent()
	}
	go s.pushStats()

	go func() {
		<-s.done
		listener.Close()
	}()

	for {
		conn, err := listener.Accept()
		if err != nil {
			select {
			case <-s.done:
				_ = s.instance.Stop()
				return nil
			default:
			}
			return fmt.Errorf("accept: %w", err)
		}
		go s.serve(conn)
	}
}

// watchParent tears the tunnel down if the GUI dies without saying goodbye.
func (s *Service) watchParent() {
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-s.done:
			return
		case <-ticker.C:
			if !processAlive(s.options.ParentPID) {
				log.Printf("parent process %d exited, shutting down", s.options.ParentPID)
				_ = s.instance.Stop()
				s.shutdown()
				return
			}
		}
	}
}

// pushStats broadcasts the byte counters while the tunnel is up, so the GUI
// never polls for them. Counting belongs here: the core owns the numbers, and a
// GUI that is minimised, backgrounded or mid-reload cannot drop samples it
// never had to ask for.
func (s *Service) pushStats() {
	ticker := time.NewTicker(statsInterval)
	defer ticker.Stop()

	for {
		select {
		case <-s.done:
			return
		case <-ticker.C:
			up, down, ok := s.instance.Stats()
			if !ok {
				continue
			}
			s.broadcast(Event{Event: EventStats, Up: up, Down: down})
		}
	}
}

func (s *Service) shutdown() {
	s.doneOnce.Do(func() { close(s.done) })
}

func (s *Service) serve(conn net.Conn) {
	defer conn.Close()

	client := &serviceClient{encoder: json.NewEncoder(conn)}
	s.mu.Lock()
	s.clients[client] = struct{}{}
	s.mu.Unlock()
	defer func() {
		s.mu.Lock()
		delete(s.clients, client)
		s.mu.Unlock()
	}()

	scanner := bufio.NewScanner(conn)
	// sing-box configs can be large; the default 64 KiB token limit is not
	// enough for a user-supplied config with rule sets.
	scanner.Buffer(make([]byte, 0, 64*1024), 8*1024*1024)

	for scanner.Scan() {
		line := scanner.Bytes()
		if len(line) == 0 {
			continue
		}
		var request Request
		if err := json.Unmarshal(line, &request); err != nil {
			_ = client.send(Response{OK: false, Error: "malformed request: " + err.Error()})
			continue
		}

		// Nothing but the handshake is served to an unauthenticated peer, and a
		// wrong token drops the connection rather than inviting another guess.
		if !client.authenticated.Load() {
			if request.Cmd != CmdHello || !s.tokenMatches(request.Token) {
				_ = client.send(Response{ID: request.ID, OK: false, Error: "unauthorized"})
				log.Printf("rejected an unauthenticated control connection")
				return
			}
			client.authenticated.Store(true)
			_ = client.send(Response{
				ID:      request.ID,
				OK:      true,
				Version: s.options.Version,
				Running: s.instance.Running(),
			})
			continue
		}

		response := s.handle(request)
		if err := client.send(response); err != nil {
			return
		}
		if request.Cmd == CmdShutdown {
			_ = s.instance.Stop()
			s.shutdown()
			return
		}
	}
	if err := scanner.Err(); err != nil && !errors.Is(err, io.EOF) {
		log.Printf("control connection error: %v", err)
	}
}

// tokenMatches compares in constant time so a wrong guess leaks nothing through
// timing. ConstantTimeCompare already returns 0 for mismatched lengths.
func (s *Service) tokenMatches(candidate string) bool {
	if s.options.Token == "" {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(candidate), []byte(s.options.Token)) == 1
}

func (s *Service) handle(request Request) Response {
	response := Response{ID: request.ID, OK: true}

	switch request.Cmd {
	case CmdHello:
		// Already authenticated; a repeated handshake is harmless.
		response.Version = s.options.Version
		response.Running = s.instance.Running()

	case CmdPing:
		response.Version = s.options.Version
		response.Running = s.instance.Running()

	case CmdStart:
		if len(request.Config) == 0 {
			response.OK, response.Error = false, "start requires a config"
			break
		}
		if err := s.instance.Start(request.Config, s.broadcastLog); err != nil {
			response.OK, response.Error = false, err.Error()
		}
		response.Running = s.instance.Running()
		s.broadcastState(response.Running)

	case CmdStop:
		if err := s.instance.Stop(); err != nil {
			response.OK, response.Error = false, err.Error()
		}
		response.Running = s.instance.Running()
		s.broadcastState(response.Running)

	case CmdStatus:
		response.Running = s.instance.Running()
		response.Version = s.options.Version

	case CmdStats:
		up, down, ok := s.instance.Stats()
		response.Running = ok
		response.Up, response.Down = up, down

	case CmdShutdown:
		response.Running = false

	default:
		response.OK, response.Error = false, "unknown command: "+request.Cmd
	}
	return response
}

func (s *Service) broadcastLog(level, message string) {
	s.broadcast(Event{Event: EventLog, Level: level, Message: message})
}

func (s *Service) broadcastState(running bool) {
	s.broadcast(Event{Event: EventState, Running: running})
}

func (s *Service) broadcast(event Event) {
	s.mu.Lock()
	clients := make([]*serviceClient, 0, len(s.clients))
	for client := range s.clients {
		// An unauthenticated peer is told nothing at all, not even that the
		// tunnel exists.
		if client.authenticated.Load() {
			clients = append(clients, client)
		}
	}
	s.mu.Unlock()

	for _, client := range clients {
		// A dead client is reaped by its own serve loop; ignore send errors.
		_ = client.send(event)
	}
}

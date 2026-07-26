package core

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// ServiceOptions configures the privileged core service.
type ServiceOptions struct {
	// SocketPath is the unix socket the GUI connects to.
	SocketPath string
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
}

func (c *serviceClient) send(payload any) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.encoder.Encode(payload)
}

// RunService starts the privileged service and blocks until the GUI asks it to
// shut down or the parent process disappears.
func RunService(options ServiceOptions) error {
	if options.SocketPath == "" {
		return errors.New("core service requires --socket")
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

func (s *Service) handle(request Request) Response {
	response := Response{ID: request.ID, OK: true}

	switch request.Cmd {
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
		clients = append(clients, client)
	}
	s.mu.Unlock()

	for _, client := range clients {
		// A dead client is reaped by its own serve loop; ignore send errors.
		_ = client.send(event)
	}
}

// Package cli lets scripts and terminals drive the running app:
//
//	NuggetVPN status
//	NuggetVPN connect Tokyo
//
// The app listens on a socket in the user's own runtime folder, and every
// request carries a token from a file beside it that only the user can read,
// so another account on the computer cannot use it. The command-line side is
// the same program, started with a command instead of nothing.
package cli

import (
	"bufio"
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Request is one command.
type Request struct {
	Token   string   `json:"token"`
	Command string   `json:"command"`
	Args    []string `json:"args,omitempty"`
}

// Response answers a Request. Text is for people, Data for --json.
type Response struct {
	OK    bool            `json:"ok"`
	Error string          `json:"error,omitempty"`
	Text  string          `json:"text,omitempty"`
	Data  json.RawMessage `json:"data,omitempty"`
}

// Commands are the commands the app answers, with what each does.
var Commands = []struct{ Name, Usage, Help string }{
	{"status", "status", "Whether the VPN is up, through which server, and the traffic"},
	{"connect", "connect [server]", "Connect, to a server by name or id, or to the one last used"},
	{"disconnect", "disconnect", "Disconnect"},
	{"servers", "servers [search]", "List the servers"},
	{"setup", "setup [name]", "List the routing setups, or switch to one"},
	{"speedtest", "speedtest", "Measure the connection through the current server"},
}

// IsCommand reports whether args ask for a command rather than the window.
func IsCommand(args []string) bool {
	if len(args) == 0 {
		return false
	}
	switch args[0] {
	case "help", "--help", "-h":
		return true
	}
	for _, command := range Commands {
		if args[0] == command.Name {
			return true
		}
	}
	return false
}

// Handler answers a command in the app.
type Handler func(command string, args []string) (text string, data any, err error)

// Server is the app's end.
type Server struct {
	listener  net.Listener
	token     string
	tokenPath string
	wait      sync.WaitGroup
	closeOnce sync.Once
}

// Listen starts answering commands at socketPath, writing a fresh token to
// tokenPath.
func Listen(socketPath, tokenPath string, handler Handler) (*Server, error) {
	random := make([]byte, 32)
	if _, err := rand.Read(random); err != nil {
		return nil, err
	}
	token := hex.EncodeToString(random)
	if err := os.MkdirAll(filepath.Dir(tokenPath), 0o700); err != nil {
		return nil, err
	}
	if err := os.WriteFile(tokenPath, []byte(token), 0o600); err != nil {
		return nil, err
	}
	network := "unix"
	if isTCP(socketPath) {
		network = "tcp"
	} else {
		// A socket left by a copy that did not exit cleanly.
		_ = os.Remove(socketPath)
	}
	listener, err := net.Listen(network, socketPath)
	if err != nil {
		return nil, err
	}
	if network == "unix" {
		_ = os.Chmod(socketPath, 0o600)
	}
	server := &Server{listener: listener, token: token, tokenPath: tokenPath}
	server.wait.Add(1)
	go server.accept(handler)
	return server, nil
}

// Close stops answering and removes the token.
func (s *Server) Close() {
	s.closeOnce.Do(func() {
		_ = s.listener.Close()
		s.wait.Wait()
		_ = os.Remove(s.tokenPath)
	})
}

func (s *Server) accept(handler Handler) {
	defer s.wait.Done()
	for {
		conn, err := s.listener.Accept()
		if err != nil {
			return
		}
		go s.serve(conn, handler)
	}
}

func (s *Server) serve(conn net.Conn, handler Handler) {
	defer conn.Close()
	// Long enough for a speed test.
	_ = conn.SetDeadline(time.Now().Add(2 * time.Minute))
	line, err := bufio.NewReader(conn).ReadBytes('\n')
	if err != nil {
		return
	}
	var request Request
	var response Response
	if json.Unmarshal(line, &request) != nil || subtle.ConstantTimeCompare([]byte(request.Token), []byte(s.token)) != 1 {
		response.Error = "not allowed"
	} else if text, data, err := handler(request.Command, request.Args); err != nil {
		response.Error = err.Error()
	} else {
		response.OK, response.Text = true, text
		if data != nil {
			response.Data, _ = json.Marshal(data)
		}
	}
	encoded, _ := json.Marshal(response)
	_, _ = conn.Write(append(encoded, '\n'))
}

// ErrNotRunning means the app is not running, or is too old to answer.
var ErrNotRunning = errors.New("NuggetVPN is not running; start it first")

// Call sends one command to the running app.
func Call(socketPath, tokenPath, command string, args []string) (Response, error) {
	token, err := os.ReadFile(tokenPath)
	if err != nil {
		return Response{}, ErrNotRunning
	}
	network := "unix"
	if isTCP(socketPath) {
		network = "tcp"
	}
	conn, err := net.DialTimeout(network, socketPath, 3*time.Second)
	if err != nil {
		return Response{}, ErrNotRunning
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(2 * time.Minute))
	request, _ := json.Marshal(Request{Token: strings.TrimSpace(string(token)), Command: command, Args: args})
	if _, err := conn.Write(append(request, '\n')); err != nil {
		return Response{}, err
	}
	line, err := bufio.NewReader(conn).ReadBytes('\n')
	if err != nil {
		return Response{}, fmt.Errorf("no answer from the app: %w", err)
	}
	var response Response
	if err := json.Unmarshal(line, &response); err != nil {
		return Response{}, err
	}
	return response, nil
}

// Run is the command-line side: it sends args to the running app, prints
// the answer, and returns the exit code.
func Run(args []string, socketPath, tokenPath, version string) int {
	attachConsole()
	asJSON := false
	var rest []string
	for _, arg := range args {
		if arg == "--json" {
			asJSON = true
			continue
		}
		rest = append(rest, arg)
	}
	if len(rest) == 0 || rest[0] == "help" || rest[0] == "--help" || rest[0] == "-h" {
		fmt.Printf("NuggetVPN %s\n\nUsage: NuggetVPN <command> [--json]\n\n", version)
		for _, command := range Commands {
			fmt.Printf("  %-20s %s\n", command.Usage, command.Help)
		}
		fmt.Println("\nThe app must be running; these control it.")
		return 0
	}
	response, err := Call(socketPath, tokenPath, rest[0], rest[1:])
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 2
	}
	if !response.OK {
		fmt.Fprintln(os.Stderr, response.Error)
		return 1
	}
	switch {
	case asJSON && len(response.Data) > 0:
		fmt.Println(string(response.Data))
	case asJSON:
		fmt.Println("{}")
	case response.Text != "":
		fmt.Println(response.Text)
	}
	return 0
}

// isTCP reports whether addr is a TCP address rather than a filesystem socket path.
func isTCP(addr string) bool {
	if strings.ContainsAny(addr, `/\`) {
		return false
	}
	_, port, err := net.SplitHostPort(addr)
	if err != nil {
		return false
	}
	p, err := strconv.Atoi(port)
	return err == nil && p >= 0 && p <= 65535
}


package cli

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestCallReachesTheHandler(t *testing.T) {
	// Short: a unix socket path is limited to about a hundred bytes.
	dir, err := os.MkdirTemp("", "nvcli-")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(dir)
	socket, token := filepath.Join(dir, "s"), filepath.Join(dir, "t")
	server, err := Listen(socket, token, func(command string, args []string) (string, any, error) {
		if command == "fail" {
			return "", nil, errors.New("nope")
		}
		return command + ":" + strings.Join(args, ","), map[string]int{"n": len(args)}, nil
	})
	if err != nil {
		t.Fatal(err)
	}
	defer server.Close()

	response, err := Call(socket, token, "connect", []string{"Tokyo"})
	if err != nil || !response.OK || response.Text != "connect:Tokyo" || string(response.Data) != `{"n":1}` {
		t.Fatalf("%+v %v", response, err)
	}
	if response, _ := Call(socket, token, "fail", nil); response.OK || response.Error != "nope" {
		t.Errorf("an error should come back: %+v", response)
	}

	// The wrong token gets nothing.
	bad := filepath.Join(dir, "bad")
	os.WriteFile(bad, []byte("0000"), 0o600)
	if response, _ := Call(socket, bad, "status", nil); response.OK {
		t.Error("a wrong token was accepted")
	}
	server.Close()
	if _, err := Call(socket, token, "status", nil); !errors.Is(err, ErrNotRunning) {
		t.Errorf("after closing: %v", err)
	}
}

func TestIsCommand(t *testing.T) {
	for arg, want := range map[string]bool{"status": true, "connect": true, "help": true, "nuggetvpn://import": false, "--core-service": false} {
		if IsCommand([]string{arg}) != want {
			t.Errorf("%s: %v", arg, !want)
		}
	}
	if IsCommand(nil) {
		t.Error("no args is the window")
	}
}

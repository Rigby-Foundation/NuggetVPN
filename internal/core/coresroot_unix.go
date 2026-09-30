//go:build !windows

package core

import "os"

// prepareCoresRoot creates the cores directory, owned by the service's user
// (root) and writable by it alone.
func prepareCoresRoot() error {
	root := coresRoot()
	if err := os.MkdirAll(root, 0o755); err != nil {
		return err
	}
	return os.Chmod(root, 0o755)
}

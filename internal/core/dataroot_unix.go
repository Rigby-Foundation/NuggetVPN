//go:build !windows

package core

import "os"

// prepareDataRoot creates the core data directory, owned by the service's user
// (root) and writable by it alone.
func prepareDataRoot() error {
	root := dataRoot()
	if err := os.MkdirAll(root, 0o755); err != nil {
		return err
	}
	return os.Chmod(root, 0o755)
}

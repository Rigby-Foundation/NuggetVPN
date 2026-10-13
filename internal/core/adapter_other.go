//go:build !windows

package core

// removeStaleAdapter: only Windows keeps a tunnel's adapter around after the
// process that made it is gone.
func removeStaleAdapter(func(string)) {}

func adapterNameTaken(error) bool { return false }

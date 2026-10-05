//go:build !android && !ios

package core

import "context"

// withPlatform is only needed on Android; see platform_android.go.
func withPlatform(ctx context.Context) context.Context { return ctx }

func platformStopped() {}

// coreAvailable reports whether a core can run here: all of them.
func coreAvailable(string) error { return nil }

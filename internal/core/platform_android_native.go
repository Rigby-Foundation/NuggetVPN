//go:build android

package core

import "github.com/Rigby-Foundation/NuggetVPN/internal/android"

func preparePlatform(config []byte) ([]byte, func(), error) {
	cleanup, err := android.StartTunnel(config)
	return config, cleanup, err
}

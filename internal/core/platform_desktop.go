//go:build !android && !ios && !darwin

package core

func preparePlatform(config []byte) ([]byte, func(), error) { return config, func() {}, nil }

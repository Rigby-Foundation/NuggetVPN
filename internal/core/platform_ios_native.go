//go:build ios

package core

func preparePlatform(config []byte) ([]byte, func(), error) { return config, func() {}, nil }

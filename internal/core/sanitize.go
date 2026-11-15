package core

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"strings"
)

// sanitizeXray confines Xray's config: no log files, no API listener, and
// entry points on loopback only.
func sanitizeXray(config []byte) ([]byte, error) {
	root, err := decodeObject(config)
	if err != nil {
		return nil, fmt.Errorf("invalid Xray config: %w", err)
	}
	if log, ok := root["log"].(map[string]any); ok {
		delete(log, "access")
		delete(log, "error")
	}
	delete(root, "api")
	if routing, ok := root["routing"].(map[string]any); ok {
		delete(routing, "script")
	}
	inbounds, _ := root["inbounds"].([]any)
	for _, entry := range inbounds {
		if object, ok := entry.(map[string]any); ok {
			if listen, _ := object["listen"].(string); !loopbackHost(listen) {
				object["listen"] = "127.0.0.1"
			}
		}
	}
	return json.Marshal(root)
}

// decodeObject reads a JSON object, keeping numbers as written: a float64
// would round marks and other large integers.
func decodeObject(data []byte) (map[string]any, error) {
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.UseNumber()
	var root map[string]any
	if err := decoder.Decode(&root); err != nil {
		return nil, err
	}
	if root == nil {
		return nil, errors.New("not a JSON object")
	}
	return root, nil
}

// loopbackHost reports whether a listen address is this computer only.
func loopbackHost(host string) bool {
	host = strings.Trim(strings.TrimSpace(host), "[]")
	if strings.EqualFold(host, "localhost") {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

// loopbackAddress is loopbackHost for a host:port.
func loopbackAddress(address string) bool {
	host, _, err := net.SplitHostPort(address)
	if err != nil {
		host = address
	}
	return loopbackHost(host)
}

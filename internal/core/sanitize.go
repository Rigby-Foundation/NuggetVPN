package core

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"strings"

	"gopkg.in/yaml.v3"
)

// sanitizeStart takes out of a start's configs whatever would let the one
// sending them use the service's root rights for more than a tunnel.
//
// The service runs whatever config it is handed, as root, and a config can
// name files: a log written anywhere, a cache or a state directory put
// anywhere, a web UI downloaded and unpacked anywhere. It can also listen on
// every interface, publishing an open proxy to the local network. The token
// keeps strangers off the socket, but a config can come from further away
// than the app: a profile holding a complete config is run as it is. So the
// service holds the line itself: files stay in its own working directory,
// and listeners stay on loopback. The configs the app builds never ask for
// more, so for them nothing changes.
func sanitizeStart(request StartRequest) (StartRequest, error) {
	var err error
	switch request.Core {
	case CoreMihomo:
		request.Config, err = sanitizeMihomo(request.Config)
	default:
		request.Config, err = sanitizeSingBox(request.Config)
		if err == nil && request.Core == CoreXray && len(request.Aux) > 0 {
			request.Aux, err = sanitizeXray(request.Aux)
		}
	}
	return request, err
}

// sanitizeSingBox confines a sing-box config. See sanitizeStart.
func sanitizeSingBox(config []byte) ([]byte, error) {
	root, err := decodeObject(config)
	if err != nil {
		return nil, fmt.Errorf("invalid sing-box config: %w", err)
	}

	if log, ok := root["log"].(map[string]any); ok {
		delete(log, "output")
	}
	// Services (DERP, the resolved and SSM APIs, ...) keep files and open
	// listeners of their own; the app runs none.
	delete(root, "services")

	if experimental, ok := root["experimental"].(map[string]any); ok {
		if cache, ok := experimental["cache_file"].(map[string]any); ok {
			if _, named := cache["path"]; named {
				// The working directory is the user's runtime folder, where
				// the app asks for it anyway.
				cache["path"] = "cache.db"
			}
		}
		if api, ok := experimental["clash_api"].(map[string]any); ok {
			for _, key := range []string{"external_ui", "external_ui_download_url", "external_ui_download_detour"} {
				delete(api, key)
			}
			if controller, _ := api["external_controller"].(string); controller != "" && !loopbackAddress(controller) {
				delete(api, "external_controller")
			}
		}
		delete(experimental, "v2ray_api")
	}

	inbounds, _ := root["inbounds"].([]any)
	for _, entry := range inbounds {
		object, ok := entry.(map[string]any)
		// The tunnel has no listen address (and refuses one).
		if !ok || object["type"] == "tun" {
			continue
		}
		// Left out, it is every interface.
		if listen, _ := object["listen"].(string); !loopbackHost(listen) {
			object["listen"] = "127.0.0.1"
		}
	}
	endpoints, _ := root["endpoints"].([]any)
	for _, entry := range endpoints {
		if object, ok := entry.(map[string]any); ok {
			// Tailscale keeps its state here; left out, it is a folder in the
			// working directory.
			delete(object, "state_directory")
		}
	}
	return json.Marshal(root)
}

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

// sanitizeMihomo confines a mihomo config. Its own safe-path check already
// keeps provider files in its home directory; what is left are the
// listeners that ignore allow-lan, and the controller.
func sanitizeMihomo(config []byte) ([]byte, error) {
	var root map[string]any
	if err := yaml.Unmarshal(config, &root); err != nil {
		return nil, fmt.Errorf("invalid mihomo config: %w", err)
	}
	if root == nil {
		return config, nil
	}
	for _, key := range []string{
		"listeners", "tunnels", "port", "socks-port", "redir-port", "tproxy-port",
		"external-controller", "external-controller-tls", "external-controller-unix",
		"external-controller-pipe", "external-controller-cors", "external-doh-server",
		"external-ui", "external-ui-url", "external-ui-name", "secret",
	} {
		delete(root, key)
	}
	root["allow-lan"] = false
	root["bind-address"] = "127.0.0.1"
	return yaml.Marshal(root)
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

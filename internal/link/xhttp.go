package link

import (
	"encoding/json"
	"strconv"
)

// XHTTP's finer settings.
//
// Share links carry the basics as parameters (path, host, mode) and the rest
// as "extra": Xray's own JSON for the transport, URL-encoded. A server can
// insist on any of it; one that expects uploads as GET requests with the data
// in a header refuses a client that sends the default POST bodies, so leaving
// "extra" out made such servers fail to connect at all.
//
// The built-in core reads these settings under Xray's names, so they are kept
// as they come. Only the names it knows are kept, since it refuses a config
// with a field it does not; Xray and mihomo convert from the same set.

// XHTTPFields are the XHTTP settings the built-in core reads besides host,
// path and mode, under Xray's names (option/v2ray_xhttp.go in the core).
var XHTTPFields = map[string]bool{
	"headers":              true,
	"xPaddingBytes":        true,
	"xPaddingObfsMode":     true,
	"xPaddingKey":          true,
	"xPaddingHeader":       true,
	"xPaddingPlacement":    true,
	"xPaddingMethod":       true,
	"uplinkHTTPMethod":     true,
	"sessionIDPlacement":   true,
	"sessionIDKey":         true,
	"sessionIDTable":       true,
	"sessionIDLength":      true,
	"seqPlacement":         true,
	"seqKey":               true,
	"uplinkDataPlacement":  true,
	"uplinkDataKey":        true,
	"uplinkChunkSize":      true,
	"noGRPCHeader":         true,
	"noSSEHeader":          true,
	"scMaxEachPostBytes":   true,
	"scMinPostsIntervalMs": true,
	"scMaxBufferedPosts":   true,
	"scStreamUpServerSecs": true,
	"serverMaxHeaderBytes": true,
}

// XMuxFields are the connection-reuse settings ("xmux") the core reads.
var XMuxFields = map[string]bool{
	"maxConcurrency":   true,
	"maxConnections":   true,
	"cMaxReuseTimes":   true,
	"hMaxRequestTimes": true,
	"hMaxReusableSecs": true,
	"hKeepAlivePeriod": true,
}

// applyXHTTPExtra merges a share link's "extra" into the transport. Settings
// the link gives as parameters stay as given.
func applyXHTTPExtra(transport map[string]any, raw string) {
	var extra map[string]any
	if json.Unmarshal([]byte(raw), &extra) != nil {
		return
	}
	mergeXHTTP(transport, extra)
}

func mergeXHTTP(transport, settings map[string]any) {
	for key, value := range settings {
		switch {
		case XHTTPFields[key]:
			if _, set := transport[key]; !set {
				transport[key] = value
			}
		case key == "xmux":
			if mux, ok := value.(map[string]any); ok {
				kept := map[string]any{}
				for name, setting := range mux {
					if XMuxFields[name] {
						kept[name] = setting
					}
				}
				if len(kept) > 0 {
					transport["xmux"] = kept
				}
			}
		case key == "downloadSettings":
			if download := xhttpDownload(value); download != nil {
				transport["downloadSettings"] = download
			}
		case key == "extra":
			// Xray also accepts the same settings nested one level down.
			if nested, ok := value.(map[string]any); ok {
				mergeXHTTP(transport, nested)
			}
		}
	}
}

// xhttpDownload converts Xray's "downloadSettings", a whole stream setup for
// a separate downlink, into the core's: the server, its TLS, and the XHTTP
// settings side by side.
func xhttpDownload(value any) map[string]any {
	stream, ok := value.(map[string]any)
	if !ok {
		return nil
	}
	address, _ := stream["address"].(string)
	port := anyInt(stream["port"])
	if address == "" || port <= 0 {
		return nil
	}
	download := map[string]any{"server": address, "server_port": port}
	if settings, ok := stream["xhttpSettings"].(map[string]any); ok {
		for _, key := range []string{"host", "path", "mode"} {
			if text, _ := settings[key].(string); text != "" {
				download[key] = text
			}
		}
		mergeXHTTP(download, settings)
		delete(download, "downloadSettings")
	}

	security, _ := stream["security"].(string)
	switch security {
	case "tls":
		settings, _ := stream["tlsSettings"].(map[string]any)
		tls := map[string]any{"enabled": true}
		if name, _ := settings["serverName"].(string); name != "" {
			tls["server_name"] = name
		}
		if alpn := anyStrings(settings["alpn"]); len(alpn) > 0 {
			tls["alpn"] = alpn
		}
		if fingerprint, _ := settings["fingerprint"].(string); fingerprint != "" {
			tls["utls"] = map[string]any{"enabled": true, "fingerprint": fingerprint}
		}
		if insecure, _ := settings["allowInsecure"].(bool); insecure {
			tls["insecure"] = true
		}
		download["tls"] = tls
	case "reality":
		settings, _ := stream["realitySettings"].(map[string]any)
		fingerprint, _ := settings["fingerprint"].(string)
		if fingerprint == "" {
			fingerprint = "chrome"
		}
		name, _ := settings["serverName"].(string)
		publicKey, _ := settings["publicKey"].(string)
		shortID, _ := settings["shortId"].(string)
		download["tls"] = map[string]any{
			"enabled":     true,
			"server_name": name,
			"utls":        map[string]any{"enabled": true, "fingerprint": fingerprint},
			"reality":     map[string]any{"enabled": true, "public_key": publicKey, "short_id": shortID},
		}
	}
	return download
}

func anyInt(value any) int {
	switch number := value.(type) {
	case float64:
		return int(number)
	case int:
		return number
	case string:
		parsed, _ := strconv.Atoi(number)
		return parsed
	}
	return 0
}

func anyStrings(value any) []string {
	switch items := value.(type) {
	case []string:
		return items
	case []any:
		var result []string
		for _, item := range items {
			if text, ok := item.(string); ok {
				result = append(result, text)
			}
		}
		return result
	case string:
		return splitList(items)
	}
	return nil
}

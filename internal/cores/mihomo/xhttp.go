package mihomo

import "fmt"

// mihomo's names for the XHTTP settings the built-in core reads under
// Xray's (see link/xhttp.go). Its range settings are strings; a bare number
// from a share link is written as one. Settings only a server uses
// (noSSEHeader, scMaxBufferedPosts, scStreamUpServerSecs,
// serverMaxHeaderBytes) have no counterpart and are left out.
var xhttpNames = map[string]string{
	"headers":              "headers",
	"noGRPCHeader":         "no-grpc-header",
	"xPaddingBytes":        "x-padding-bytes",
	"xPaddingObfsMode":     "x-padding-obfs-mode",
	"xPaddingKey":          "x-padding-key",
	"xPaddingHeader":       "x-padding-header",
	"xPaddingPlacement":    "x-padding-placement",
	"xPaddingMethod":       "x-padding-method",
	"uplinkHTTPMethod":     "uplink-http-method",
	"sessionIDPlacement":   "session-placement",
	"sessionIDKey":         "session-key",
	"sessionIDTable":       "session-table",
	"sessionIDLength":      "session-length",
	"seqPlacement":         "seq-placement",
	"seqKey":               "seq-key",
	"uplinkDataPlacement":  "uplink-data-placement",
	"uplinkDataKey":        "uplink-data-key",
	"uplinkChunkSize":      "uplink-chunk-size",
	"scMaxEachPostBytes":   "sc-max-each-post-bytes",
	"scMinPostsIntervalMs": "sc-min-posts-interval-ms",
}

var xmuxNames = map[string]string{
	"maxConcurrency":   "max-concurrency",
	"maxConnections":   "max-connections",
	"cMaxReuseTimes":   "c-max-reuse-times",
	"hMaxRequestTimes": "h-max-request-times",
	"hMaxReusableSecs": "h-max-reusable-secs",
	"hKeepAlivePeriod": "h-keep-alive-period",
}

// xhttpOptions is mihomo's xhttp-opts for a transport.
func xhttpOptions(transport map[string]any) map[string]any {
	options := map[string]any{"path": str(transport["path"])}
	if host := str(transport["host"]); host != "" {
		options["host"] = host
	}
	if mode := str(transport["mode"]); mode != "" {
		options["mode"] = mode
	}
	for key, value := range transport {
		if name, ok := xhttpNames[key]; ok {
			options[name] = mihomoValue(value)
		}
	}
	if reuse := reuseSettings(transport["xmux"]); reuse != nil {
		options["reuse-settings"] = reuse
	}
	if download, _ := transport["downloadSettings"].(map[string]any); download != nil {
		options["download-settings"] = downloadSettings(download)
	}
	return options
}

func reuseSettings(value any) map[string]any {
	mux, _ := value.(map[string]any)
	if len(mux) == 0 {
		return nil
	}
	reuse := map[string]any{}
	for key, setting := range mux {
		if name, ok := xmuxNames[key]; ok {
			if key == "hKeepAlivePeriod" {
				reuse[name] = num(setting)
			} else {
				reuse[name] = mihomoValue(setting)
			}
		}
	}
	return reuse
}

// downloadSettings is a separate downlink: the XHTTP part and the server
// with its TLS, flattened together as mihomo has them.
func downloadSettings(download map[string]any) map[string]any {
	options := map[string]any{
		"server": str(download["server"]),
		"port":   num(download["server_port"]),
	}
	for _, key := range []string{"path", "host"} {
		if text := str(download[key]); text != "" {
			options[key] = text
		}
	}
	if headers, ok := download["headers"]; ok {
		options["headers"] = headers
	}
	if reuse := reuseSettings(download["xmux"]); reuse != nil {
		options["reuse-settings"] = reuse
	}
	if tls, _ := download["tls"].(map[string]any); tls != nil && tls["enabled"] == true {
		options["tls"] = true
		if name := str(tls["server_name"]); name != "" {
			options["servername"] = name
		}
		if alpn := texts(tls["alpn"]); len(alpn) > 0 {
			options["alpn"] = alpn
		}
		if utls, _ := tls["utls"].(map[string]any); utls != nil {
			if fingerprint := str(utls["fingerprint"]); fingerprint != "" {
				options["client-fingerprint"] = fingerprint
			}
		}
		if tls["insecure"] == true {
			options["skip-cert-verify"] = true
		}
		if reality, _ := tls["reality"].(map[string]any); reality != nil && reality["enabled"] == true {
			options["reality-opts"] = map[string]any{
				"public-key": str(reality["public_key"]),
				"short-id":   str(reality["short_id"]),
			}
		}
	}
	return options
}

// mihomoValue writes numbers as the strings mihomo's range settings take.
func mihomoValue(value any) any {
	switch number := value.(type) {
	case float64:
		return fmt.Sprint(int64(number))
	case int:
		return fmt.Sprint(number)
	}
	return value
}

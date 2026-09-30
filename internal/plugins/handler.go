package plugins

import (
	_ "embed"
	"net/http"
	"runtime"
	"strings"
)

// PagesAllowed says whether plugin pages may run. Not on Android, where the
// WebView hands its native bridge (addJavascriptInterface) to every frame,
// sandboxed or not, so a plugin page could reach the app's Go methods.
// Plugins there bring their themes, fonts and routing setups only.
var PagesAllowed = runtime.GOOS != "android"

// Prefix is the path plugin files are served under: /plugins/<id>/<file>.
const Prefix = "/plugins/"

// sdkPath is where the plugin SDK is served. "_sdk" can never be a plugin id.
const sdkPath = Prefix + "_sdk/nugget.js"

//go:embed sdk/nugget.js
var sdk []byte

// Handler serves the enabled plugins' files, and the SDK, and passes every
// other request to next.
//
// Plugin pages run in frames sandboxed without allow-same-origin, so they
// cannot touch the window or call the app. The Content-Security-Policy on
// them closes what the sandbox leaves open: they load code only from their
// own folder and the SDK, and reach the network only at the hosts their
// manifest names.
func (s *Store) Handler(next http.Handler) http.Handler {
	return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		rest, ok := strings.CutPrefix(request.URL.Path, Prefix)
		if !ok {
			next.ServeHTTP(writer, request)
			return
		}
		header := writer.Header()
		header.Set("X-Content-Type-Options", "nosniff")
		header.Set("Cache-Control", "no-store")
		if request.URL.Path == sdkPath {
			header.Set("Content-Type", "text/javascript; charset=utf-8")
			_, _ = writer.Write(sdk)
			return
		}
		id, name, found := strings.Cut(rest, "/")
		if !found || !Valid(id) {
			http.NotFound(writer, request)
			return
		}
		plugin, installed := s.Get(id)
		if !installed || !plugin.State.Enabled {
			http.NotFound(writer, request)
			return
		}
		kind, known := contentType(name)
		if !known {
			http.NotFound(writer, request)
			return
		}
		content, err := s.ReadFile(id, name)
		if err != nil {
			http.NotFound(writer, request)
			return
		}
		// Plugin pages only where they can be sandboxed; see PagesAllowed.
		if !PagesAllowed && (strings.HasPrefix(kind, "text/html") || strings.HasPrefix(kind, "text/javascript")) {
			http.NotFound(writer, request)
			return
		}
		header.Set("Content-Type", kind)
		if strings.HasPrefix(kind, "text/html") || strings.HasPrefix(kind, "image/svg") {
			header.Set("Content-Security-Policy", policy(request.Host, id, plugin.Manifest.Network))
		}
		_, _ = writer.Write(content)
	})
}

// policy is the Content-Security-Policy for a plugin's pages.
//
// Sources are written out with every scheme the app is served over, because
// a sandboxed page has no origin of its own for 'self' to mean.
func policy(host, id string, network []string) string {
	var own, sdkSource []string
	for _, scheme := range []string{"http", "https", "wails"} {
		own = append(own, scheme+"://"+host+Prefix+id+"/")
		sdkSource = append(sdkSource, scheme+"://"+host+sdkPath)
	}
	var connect []string
	for _, remote := range network {
		connect = append(connect, "https://"+remote, "wss://"+remote)
	}
	if len(connect) == 0 {
		connect = []string{"'none'"}
	}
	join := func(parts ...[]string) string {
		var all []string
		for _, part := range parts {
			all = append(all, part...)
		}
		return strings.Join(all, " ")
	}
	return strings.Join([]string{
		"default-src 'none'",
		"script-src 'unsafe-inline' " + join(own, sdkSource),
		"style-src 'unsafe-inline' " + join(own),
		"img-src data: blob: " + join(own),
		"font-src data: " + join(own),
		"media-src " + join(own),
		"connect-src " + join(connect),
		"frame-src 'none'",
		"worker-src 'none'",
		"object-src 'none'",
		"form-action 'none'",
		"base-uri 'none'",
	}, "; ")
}

// GuardRuntime refuses calls to the app's Go methods that do not come from
// the app's own window.
//
// The Wails runtime endpoint accepts a call as query parameters as well as a
// JSON body, so without this, a plugin page could call any method just by
// navigating its frame to a URL. The window's runtime always POSTs, with a
// client id header that a navigation cannot carry and a sandboxed page
// cannot add without a CORS preflight, which is refused here too.
func GuardRuntime(next http.Handler) http.Handler {
	// Android calls the runtime through its JavaScript bridge, not these
	// requests, and runs no plugin pages at all; see PagesAllowed.
	if !PagesAllowed {
		return next
	}
	return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path == "/wails/runtime" &&
			(request.Method != http.MethodPost || request.Header.Get("x-wails-client-id") == "") {
			http.Error(writer, "forbidden", http.StatusForbidden)
			return
		}
		next.ServeHTTP(writer, request)
	})
}

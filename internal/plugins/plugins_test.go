package plugins

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// pack builds a plugin file from name → content.
func pack(t *testing.T, files map[string]string) []byte {
	t.Helper()
	var buffer bytes.Buffer
	writer := zip.NewWriter(&buffer)
	for name, content := range files {
		entry, err := writer.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		entry.Write([]byte(content))
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return buffer.Bytes()
}

const sampleManifest = `{
  "format": 1,
  "id": "com.example.sample",
  "name": "Sample",
  "version": "1.0.0",
  "author": "Someone",
  "themes": [{"id": "dusk", "name": "Dusk", "mode": "dark",
              "background": {"h": 280, "c": 0.03, "l": 0.16}, "accent": {"h": 30, "c": 0.15},
              "image": {"file": "images/dusk.png", "blur": 10, "brightness": 0.9, "saturate": 1, "dim": 0.3, "panel": 0.7}}],
  "fonts": [{"name": "Sample Sans", "file": "fonts/sample.woff2"}],
  "routing": [{"name": "Everything direct", "file": "routing/direct.vflow"}],
  "panel": {"title": "Sample", "file": "panel.html"},
  "background": "background.html",
  "permissions": ["control", "state"],
  "network": ["api.example.com"]
}`

func sampleFiles() map[string]string {
	return map[string]string{
		"plugin.json":          sampleManifest,
		"images/dusk.png":      "\x89PNG\r\n\x1a\n",
		"fonts/sample.woff2":   "wOF2",
		"routing/direct.vflow": "{}",
		"panel.html":           "<!doctype html><p>hi</p>",
		"background.html":      "<!doctype html>",
	}
}

func TestReadAcceptsAWellFormedPlugin(t *testing.T) {
	pkg, err := Read(pack(t, sampleFiles()))
	if err != nil {
		t.Fatal(err)
	}
	manifest := pkg.Manifest
	if manifest.ID != "com.example.sample" || len(manifest.Themes) != 1 || manifest.Panel.File != "panel.html" {
		t.Errorf("manifest %+v", manifest)
	}
	// Permissions come back in the prompt's order, whatever the file's.
	if strings.Join(manifest.Permissions, ",") != "state,control" {
		t.Errorf("permissions %v", manifest.Permissions)
	}
	if !manifest.HasScript() {
		t.Error("a plugin with pages runs script")
	}
}

func TestReadRefusesBadPlugins(t *testing.T) {
	withManifest := func(change func(map[string]any)) map[string]string {
		var manifest map[string]any
		json.Unmarshal([]byte(sampleManifest), &manifest)
		change(manifest)
		data, _ := json.Marshal(manifest)
		files := sampleFiles()
		files["plugin.json"] = string(data)
		return files
	}
	cases := map[string]map[string]string{
		"no manifest":          {"panel.html": "x"},
		"escaping path":        {"plugin.json": sampleManifest, "../evil.html": "x"},
		"absolute path":        {"plugin.json": sampleManifest, "/etc/evil": "x"},
		"backslash path":       {"plugin.json": sampleManifest, `a\..\b.html`: "x"},
		"hidden file":          {"plugin.json": sampleManifest, ".hidden": "x"},
		"missing file":         withManifest(func(m map[string]any) { m["background"] = "nope.html" }),
		"script as font":       withManifest(func(m map[string]any) { m["fonts"] = []any{map[string]any{"name": "x", "file": "panel.html"}} }),
		"unknown permission":   withManifest(func(m map[string]any) { m["permissions"] = []any{"root"} }),
		"bad id":               withManifest(func(m map[string]any) { m["id"] = "../x" }),
		"sdk id":               withManifest(func(m map[string]any) { m["id"] = "_sdk" }),
		"newer format":         withManifest(func(m map[string]any) { m["format"] = 2 }),
		"local host":           withManifest(func(m map[string]any) { m["network"] = []any{"localhost"} }),
		"wails host":           withManifest(func(m map[string]any) { m["network"] = []any{"wails.localhost"} }),
		"address":              withManifest(func(m map[string]any) { m["network"] = []any{"192.168.1.1"} }),
		"network with no page": withManifest(func(m map[string]any) { delete(m, "panel"); delete(m, "background") }),
	}
	for name, files := range cases {
		if _, err := Read(pack(t, files)); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
	if _, err := Read([]byte("not a zip")); err == nil {
		t.Error("accepted something that is not a zip")
	}
}

func TestReadStopsAtTheSizeLimit(t *testing.T) {
	files := sampleFiles()
	files["big.txt"] = strings.Repeat("a", maxEntry+1)
	if _, err := Read(pack(t, files)); err == nil || !strings.Contains(err.Error(), "larger") {
		t.Errorf("an oversized file got through: %v", err)
	}
}

func installed(t *testing.T) *Store {
	t.Helper()
	store := NewStore(t.TempDir())
	pkg, err := Read(pack(t, sampleFiles()))
	if err != nil {
		t.Fatal(err)
	}
	if got := store.NewPermissions(pkg); len(got) != 2 {
		t.Errorf("a new plugin's permissions are all new: %v", got)
	}
	if err := store.Install(pkg); err != nil {
		t.Fatal(err)
	}
	return store
}

func TestInstallUpdateAndRemove(t *testing.T) {
	store := installed(t)
	list := store.List()
	if len(list) != 1 || !list[0].State.Enabled || len(list[0].State.Granted) != 2 {
		t.Fatalf("installed %+v", list)
	}

	// An update asking for more names only what is new.
	files := sampleFiles()
	files["plugin.json"] = strings.Replace(sampleManifest, `"control", "state"`, `"control", "state", "routing"`, 1)
	files["plugin.json"] = strings.Replace(files["plugin.json"], `"1.0.0"`, `"1.1.0"`, 1)
	update, err := Read(pack(t, files))
	if err != nil {
		t.Fatal(err)
	}
	if added := store.NewPermissions(update); strings.Join(added, ",") != "routing" {
		t.Errorf("new permissions %v", added)
	}
	if err := store.Install(update); err != nil {
		t.Fatal(err)
	}
	if plugin, _ := store.Get("com.example.sample"); plugin.Manifest.Version != "1.1.0" {
		t.Errorf("not updated: %+v", plugin.Manifest)
	}

	if err := store.SetValue("com.example.sample", "count", json.RawMessage(`3`)); err != nil {
		t.Fatal(err)
	}
	if err := store.Remove("com.example.sample"); err != nil {
		t.Fatal(err)
	}
	if len(store.List()) != 0 {
		t.Error("still listed after removal")
	}
	if value, _ := store.GetValue("com.example.sample", "count"); string(value) != "null" {
		t.Errorf("storage outlived the plugin: %s", value)
	}
}

func TestStorage(t *testing.T) {
	store := installed(t)
	id := "com.example.sample"
	if err := store.SetValue(id, "k", json.RawMessage(`{"a":1}`)); err != nil {
		t.Fatal(err)
	}
	if value, _ := store.GetValue(id, "k"); string(value) != `{"a":1}` {
		t.Errorf("read back %s", value)
	}
	if err := store.SetValue(id, "k", json.RawMessage(`not json`)); err == nil {
		t.Error("stored something that is not JSON")
	}
	huge, _ := json.Marshal(strings.Repeat("x", maxStorage))
	if err := store.SetValue(id, "big", huge); err == nil {
		t.Error("stored past the limit")
	}
	if err := store.SetValue(id, "k", json.RawMessage(`null`)); err != nil {
		t.Fatal(err)
	}
	if value, _ := store.GetValue(id, "k"); string(value) != "null" {
		t.Errorf("null should delete: %s", value)
	}
}

func TestHandlerServesEnabledPluginsWithAPolicy(t *testing.T) {
	store := installed(t)
	fallback := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusTeapot) })
	handler := store.Handler(fallback)
	get := func(path string) *httptest.ResponseRecorder {
		recorder := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodGet, "http://wails.localhost"+path, nil)
		handler.ServeHTTP(recorder, request)
		return recorder
	}

	page := get("/plugins/com.example.sample/panel.html")
	if page.Code != http.StatusOK {
		t.Fatalf("panel: %d", page.Code)
	}
	policy := page.Header().Get("Content-Security-Policy")
	for _, want := range []string{
		"default-src 'none'",
		"connect-src https://api.example.com wss://api.example.com",
		"http://wails.localhost/plugins/com.example.sample/",
		"http://wails.localhost/plugins/_sdk/nugget.js",
		"form-action 'none'",
		"frame-src 'none'",
	} {
		if !strings.Contains(policy, want) {
			t.Errorf("policy lacks %q: %s", want, policy)
		}
	}
	if get("/plugins/com.example.sample/fonts/sample.woff2").Header().Get("Content-Type") != "font/woff2" {
		t.Error("font served with the wrong type")
	}
	if code := get("/plugins/_sdk/nugget.js").Code; code != http.StatusOK {
		t.Errorf("sdk: %d", code)
	}
	for _, path := range []string{
		"/plugins/com.example.sample/../state.json",
		"/plugins/com.example.sample/plugin.json.bak",
		"/plugins/com.example.other/panel.html",
		"/plugins/com.example.sample/missing.html",
	} {
		if code := get(path).Code; code != http.StatusNotFound {
			t.Errorf("%s: %d", path, code)
		}
	}
	if code := get("/index.html").Code; code != http.StatusTeapot {
		t.Errorf("other paths should pass through: %d", code)
	}

	store.SetEnabled("com.example.sample", false)
	if code := get("/plugins/com.example.sample/panel.html").Code; code != http.StatusNotFound {
		t.Errorf("a turned-off plugin is still served: %d", code)
	}
}

func TestGuardRuntime(t *testing.T) {
	handler := GuardRuntime(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	call := func(method string, header bool) int {
		request := httptest.NewRequest(method, "http://wails.localhost/wails/runtime?object=0&method=1", nil)
		if header {
			request.Header.Set("x-wails-client-id", "abc")
		}
		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, request)
		return recorder.Code
	}
	if call(http.MethodPost, true) != http.StatusOK {
		t.Error("the window's own call was refused")
	}
	for _, blocked := range []struct {
		method string
		header bool
	}{{http.MethodGet, false}, {http.MethodGet, true}, {http.MethodPost, false}, {http.MethodOptions, true}} {
		if call(blocked.method, blocked.header) != http.StatusForbidden {
			t.Errorf("%s (header %v) got through", blocked.method, blocked.header)
		}
	}
}

// The example in the repository stays installable, routing setup included.
func TestExamplePluginPacks(t *testing.T) {
	_, pkg, err := Pack("../../examples/plugins/glance")
	if err != nil {
		t.Fatal(err)
	}
	if pkg.Manifest.Panel == nil || len(pkg.Manifest.Themes) != 1 || len(pkg.Manifest.Routing) != 1 {
		t.Errorf("example manifest %+v", pkg.Manifest)
	}
	var flow struct {
		Format string `json:"format"`
	}
	if err := json.Unmarshal(pkg.Files["routing/trackers.vflow"], &flow); err != nil || flow.Format != "nuggetvpn.vflow" {
		t.Errorf("the example's routing setup is not a .vflow: %v", err)
	}
}

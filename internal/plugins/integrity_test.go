package plugins

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestChecksumPinsAllFilesAndRevokesPersistently(t *testing.T) {
	for _, name := range []string{"panel.html", "fonts/sample.woff2", "extra.txt", "plugin.json"} {
		t.Run(name, func(t *testing.T) {
			store := installed(t)
			id := "com.example.sample"
			before, _ := store.Get(id)
			if len(before.State.Checksum) != 64 || before.State.Checksum != before.Checksum {
				t.Fatal("checksum not pinned")
			}
			target := filepath.Join(store.pluginDir(id), filepath.FromSlash(name))
			original, _ := os.ReadFile(target)
			changed := append([]byte{}, original...)
			if name == "plugin.json" {
				changed = []byte(strings.Replace(string(original), "Sample", "Changed", 1))
			} else {
				changed = append(changed, 'x')
			}
			if err := os.WriteFile(target, changed, 0o644); err != nil {
				t.Fatal(err)
			}
			after, _ := store.Get(id)
			if after.State.Enabled || !after.State.ApprovalRequired || after.State.Checksum != before.State.Checksum {
				t.Fatalf("did not revoke: %+v", after)
			}
			// Neither restart, re-enable, nor restoring old bytes silently clears revocation.
			restarted := NewStore(store.dir)
			if err := restarted.SetEnabled(id, true); err == nil {
				t.Fatal("enabled changed plugin")
			}
			if name == "extra.txt" {
				_ = os.Remove(target)
			} else {
				_ = os.WriteFile(target, original, 0o644)
			}
			restored, _ := restarted.Get(id)
			if restored.State.Enabled || !restored.State.ApprovalRequired {
				t.Fatal("restoration silently approved plugin")
			}
			// Explicit approval installs exactly the reviewed snapshot.
			pkg, err := restarted.Snapshot(id)
			if err != nil {
				t.Fatal(err)
			}
			if err := restarted.Install(pkg); err != nil {
				t.Fatal(err)
			}
			approved, _ := restarted.Get(id)
			if !approved.State.Enabled || approved.State.ApprovalRequired || approved.Checksum != approved.State.Checksum {
				t.Fatal("approval failed")
			}
		})
	}
}

func TestChangedFilesCannotBeServed(t *testing.T) {
	store := installed(t)
	if err := os.WriteFile(filepath.Join(store.pluginDir("com.example.sample"), "panel.html"), []byte("changed"), 0o644); err != nil {
		t.Fatal(err)
	}
	handler := store.Handler(http.NotFoundHandler())
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest("GET", "http://wails.localhost/plugins/com.example.sample/panel.html", nil))
	if response.Code != http.StatusNotFound {
		t.Fatal("served unapproved files")
	}
	if _, err := store.ReadFile("com.example.sample", "panel.html"); err == nil {
		t.Fatal("read unapproved files")
	}
}

func TestLegacyPluginsArePinnedOnFirstRead(t *testing.T) {
	store := installed(t)
	states := store.readState()
	state := states["com.example.sample"]
	state.Checksum = ""
	states["com.example.sample"] = state
	if err := store.writeState(states); err != nil {
		t.Fatal(err)
	}
	plugin, ok := store.Get("com.example.sample")
	if !ok || !plugin.State.Enabled || len(plugin.State.Checksum) != 64 {
		t.Fatal("legacy first-use pin failed")
	}
	if store.readState()["com.example.sample"].Checksum != plugin.Checksum {
		t.Fatal("pin not persisted")
	}
}

func TestChecksumIgnoresZIPOrderButIncludesPaths(t *testing.T) {
	first, err := Read(pack(t, sampleFiles()))
	if err != nil {
		t.Fatal(err)
	}
	second, err := Read(pack(t, sampleFiles()))
	if err != nil {
		t.Fatal(err)
	}
	if first.Checksum() != second.Checksum() {
		t.Fatal("unstable checksum")
	}
	second.Files["renamed.html"] = second.Files["panel.html"]
	delete(second.Files, "panel.html")
	if first.Checksum() == second.Checksum() {
		t.Fatal("checksum omitted filenames")
	}
}

func TestSymlinksAndInvalidManifestRevoke(t *testing.T) {
	for _, kind := range []string{"symlink", "manifest"} {
		t.Run(kind, func(t *testing.T) {
			store := installed(t)
			id := "com.example.sample"
			if kind == "manifest" {
				_ = os.WriteFile(filepath.Join(store.pluginDir(id), ManifestName), []byte("bad JSON"), 0o644)
			} else {
				target := filepath.Join(t.TempDir(), "outside.txt")
				_ = os.WriteFile(target, []byte("secret"), 0o600)
				if err := os.Symlink(target, filepath.Join(store.pluginDir(id), "link.txt")); err != nil {
					t.Skip(err)
				}
			}
			plugin, ok := store.Get(id)
			if !ok || plugin.State.Enabled || !plugin.State.ApprovalRequired || plugin.Error == "" {
				t.Fatalf("unsafe plugin not revoked: %+v", plugin)
			}
		})
	}
}

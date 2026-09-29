package app

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/Rigby-Foundation/NuggetVPN/internal/storage"
)

// ---------------------------------------------------------------------------
// User files: custom fonts and theme backgrounds
// ---------------------------------------------------------------------------
//
// Files the user adds to the look of the app are copied into the data
// directory and served to the window under /user-files/<kind>/<file>, so the
// window can use them as fonts and images without being given the file
// system.

// UserFilesPrefix is the path the window loads user files from.
const UserFilesPrefix = "/user-files/"

// userFileKinds are the kinds of file, with what each accepts.
var userFileKinds = map[string]struct {
	title      string
	filter     string
	extensions []string
	maxSize    int64
}{
	"fonts":       {"Choose a font", "*.ttf;*.otf;*.woff;*.woff2", []string{".ttf", ".otf", ".woff", ".woff2"}, 40 << 20},
	"backgrounds": {"Choose an image", "*.png;*.jpg;*.jpeg;*.webp;*.gif", []string{".png", ".jpg", ".jpeg", ".webp", ".gif"}, 40 << 20},
}

// UserFile is one added file.
type UserFile struct {
	ID string `json:"id"`
	// Name is what the user knows it as: the file's name, without extension.
	Name string `json:"name"`
	// URL is where the window loads it from.
	URL  string `json:"url"`
	Kind string `json:"kind"`
}

// storedName is a user file's name on disk: a random id and its extension.
var storedName = regexp.MustCompile(`^[a-f0-9]{16}\.(ttf|otf|woff2?|png|jpe?g|webp|gif)$`)

func userFilesDir(kind string) string {
	return filepath.Join(storage.DataDir(), "user-files", kind)
}

func indexPath(kind string) string {
	return filepath.Join(userFilesDir(kind), "index.json")
}

func readIndex(kind string) []UserFile {
	data, err := os.ReadFile(indexPath(kind))
	if err != nil {
		return []UserFile{}
	}
	var files []UserFile
	if json.Unmarshal(data, &files) != nil {
		return []UserFile{}
	}
	// Only entries whose file is still there.
	kept := files[:0]
	for _, file := range files {
		if _, err := os.Stat(filepath.Join(userFilesDir(kind), path.Base(file.URL))); err == nil {
			kept = append(kept, file)
		}
	}
	return kept
}

func writeIndex(kind string, files []UserFile) error {
	data, err := json.MarshalIndent(files, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(indexPath(kind), data, 0o644)
}

// ListUserFiles lists the fonts or backgrounds added so far.
func (a *App) ListUserFiles(kind string) ([]UserFile, error) {
	if _, ok := userFileKinds[kind]; !ok {
		return nil, fmt.Errorf("unknown kind %q", kind)
	}
	return readIndex(kind), nil
}

// ImportUserFile lets the user pick a font or an image and adds it. An empty
// result means the dialog was cancelled.
func (a *App) ImportUserFile(kind string) (*UserFile, error) {
	spec, ok := userFileKinds[kind]
	if !ok {
		return nil, fmt.Errorf("unknown kind %q", kind)
	}
	if a.app == nil {
		return nil, errors.New("application is not ready")
	}
	dialog := a.app.Dialog.OpenFile().
		SetTitle(spec.title).
		CanChooseFiles(true).
		AddFilter(spec.title, spec.filter)
	if a.window != nil {
		dialog = dialog.AttachToWindow(a.window)
	}
	picked, err := dialog.PromptForSingleSelection()
	if err != nil || picked == "" {
		return nil, err
	}
	file, err := os.Open(picked)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, spec.maxSize+1))
	if err != nil {
		return nil, err
	}
	name := strings.TrimSuffix(filepath.Base(picked), filepath.Ext(picked))
	return a.addUserFile(kind, name, strings.ToLower(filepath.Ext(picked)), data)
}

// addUserFile stores data as a user file of kind, after checking it is what
// it says it is.
func (a *App) addUserFile(kind, name, extension string, data []byte) (*UserFile, error) {
	spec := userFileKinds[kind]
	if int64(len(data)) > spec.maxSize {
		return nil, fmt.Errorf("the file is larger than %d MB", spec.maxSize>>20)
	}
	allowed := false
	for _, candidate := range spec.extensions {
		allowed = allowed || candidate == extension
	}
	if !allowed || !looksLike(kind, data) {
		if kind == "fonts" {
			return nil, errors.New("that is not a font file (TTF, OTF, WOFF or WOFF2)")
		}
		return nil, errors.New("that is not an image (PNG, JPEG, WebP or GIF)")
	}

	random := make([]byte, 8)
	if _, err := rand.Read(random); err != nil {
		return nil, err
	}
	if extension == ".jpeg" {
		extension = ".jpg"
	}
	fileName := hex.EncodeToString(random) + extension
	dir := userFilesDir(kind)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	if err := os.WriteFile(filepath.Join(dir, fileName), data, 0o644); err != nil {
		return nil, err
	}
	if runes := []rune(strings.TrimSpace(name)); len(runes) > 60 {
		name = string(runes[:60])
	}
	added := UserFile{
		ID:   strings.TrimSuffix(fileName, extension),
		Name: strings.TrimSpace(name),
		URL:  UserFilesPrefix + kind + "/" + fileName,
		Kind: kind,
	}
	files := append(readIndex(kind), added)
	if err := writeIndex(kind, files); err != nil {
		return nil, err
	}
	return &added, nil
}

// RemoveUserFile deletes an added font or background.
func (a *App) RemoveUserFile(kind, id string) error {
	if _, ok := userFileKinds[kind]; !ok {
		return fmt.Errorf("unknown kind %q", kind)
	}
	files := readIndex(kind)
	kept := files[:0]
	for _, file := range files {
		if file.ID == id {
			_ = os.Remove(filepath.Join(userFilesDir(kind), path.Base(file.URL)))
			continue
		}
		kept = append(kept, file)
	}
	return writeIndex(kind, kept)
}

// looksLike checks a file's first bytes, so a renamed file of another kind is
// refused rather than handed to the webview.
func looksLike(kind string, data []byte) bool {
	has := func(prefix string) bool { return bytes.HasPrefix(data, []byte(prefix)) }
	switch kind {
	case "fonts":
		return has("\x00\x01\x00\x00") || has("true") || has("OTTO") || has("wOFF") || has("wOF2") || has("ttcf")
	case "backgrounds":
		return has("\x89PNG\r\n\x1a\n") || has("\xff\xd8\xff") || has("GIF87a") || has("GIF89a") ||
			(has("RIFF") && len(data) > 12 && string(data[8:12]) == "WEBP")
	}
	return false
}

// UserFilesHandler serves user files under UserFilesPrefix and passes every
// other request to next. Only names the app itself gave its files are
// served, from the two kinds' folders, so no other path can be reached.
func UserFilesHandler(next http.Handler) http.Handler {
	return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		rest, ok := strings.CutPrefix(request.URL.Path, UserFilesPrefix)
		if !ok {
			next.ServeHTTP(writer, request)
			return
		}
		kind, name, found := strings.Cut(rest, "/")
		if _, known := userFileKinds[kind]; !found || !known || !storedName.MatchString(name) {
			http.NotFound(writer, request)
			return
		}
		writer.Header().Set("Cache-Control", "max-age=31536000, immutable")
		writer.Header().Set("X-Content-Type-Options", "nosniff")
		http.ServeFile(writer, request, filepath.Join(userFilesDir(kind), name))
	})
}

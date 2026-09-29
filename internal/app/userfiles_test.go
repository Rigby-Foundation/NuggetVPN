package app

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestLooksLike(t *testing.T) {
	for _, testCase := range []struct {
		kind string
		data string
		want bool
	}{
		{"fonts", "wOF2rest", true},
		{"fonts", "\x00\x01\x00\x00rest", true},
		{"fonts", "OTTOrest", true},
		{"fonts", "<html>", false},
		{"backgrounds", "\x89PNG\r\n\x1a\nrest", true},
		{"backgrounds", "\xff\xd8\xffrest", true},
		{"backgrounds", "RIFF1234WEBPVP8 ", true},
		{"backgrounds", "RIFF1234WAVE", false},
		{"backgrounds", "wOF2", false},
	} {
		if got := looksLike(testCase.kind, []byte(testCase.data)); got != testCase.want {
			t.Errorf("looksLike(%s, %q) = %v", testCase.kind, testCase.data, got)
		}
	}
}

// Only names the app gave its own files are served; anything else, and
// every attempt to step out of the folder, is a 404 — and other paths go to
// the app's own assets.
func TestUserFilesHandlerRefusesOtherPaths(t *testing.T) {
	passed := false
	handler := UserFilesHandler(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { passed = true }))
	for _, target := range []string{
		"/user-files/fonts/../../settings.json",
		"/user-files/fonts/..%2f..%2fsettings.json",
		"/user-files/secrets/0123456789abcdef.ttf",
		"/user-files/fonts/index.json",
		"/user-files/backgrounds/0123456789abcdef.exe",
	} {
		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "http://wails.localhost"+target, nil))
		if recorder.Code != http.StatusNotFound {
			t.Errorf("%s answered %d", target, recorder.Code)
		}
	}
	handler.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "http://wails.localhost/index.html", nil))
	if !passed {
		t.Error("other paths should reach the app's assets")
	}
}

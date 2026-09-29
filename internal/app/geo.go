package app

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/Rigby-Foundation/NuggetVPN/internal/geodat"
	"github.com/Rigby-Foundation/NuggetVPN/internal/models"
	"github.com/Rigby-Foundation/NuggetVPN/internal/sbconfig"
	"github.com/Rigby-Foundation/NuggetVPN/internal/storage"
)

// ---------------------------------------------------------------------------
// Custom geo files
// ---------------------------------------------------------------------------

// maxGeoFileSize bounds a geo file read or download. A full geosite.dat is
// around 70 MB today; this leaves room without letting a wrong URL fill the
// disk.
const maxGeoFileSize = 256 << 20

// geoCodes caches each kind's code list for suggestions, keyed by the file's
// modification time so a replaced file is read again.
type geoCodes struct {
	mu      sync.Mutex
	entries map[string]geoCodeEntry
}

type geoCodeEntry struct {
	modified time.Time
	codes    []string
}

var geoCodeCache = geoCodes{entries: map[string]geoCodeEntry{}}

// ImportGeoFile lets the user pick a geoip.dat or geosite.dat. Which of the
// two it is, is read from the file itself.
func (a *App) ImportGeoFile() (models.AppSettings, error) {
	if a.app == nil {
		return a.GetSettings(), fmt.Errorf("application is not ready")
	}
	dialog := a.app.Dialog.OpenFile().
		SetTitle("Choose geoip.dat or geosite.dat").
		CanChooseFiles(true).
		AddFilter("V2Ray geo data", "*.dat")
	if a.window != nil {
		dialog = dialog.AttachToWindow(a.window)
	}
	picked, err := dialog.PromptForSingleSelection()
	if err != nil || picked == "" {
		return a.GetSettings(), err
	}

	file, err := os.Open(picked)
	if err != nil {
		return a.GetSettings(), err
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, maxGeoFileSize+1))
	if err != nil {
		return a.GetSettings(), err
	}
	return a.installGeoFile(data, models.GeoFile{Source: "file", Name: filepath.Base(picked)})
}

// DownloadGeoFile fetches a geoip.dat or geosite.dat from a URL — the way
// Happ and most Xray clients are pointed at theirs.
func (a *App) DownloadGeoFile(rawURL string) (models.AppSettings, error) {
	parsed, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil || (parsed.Scheme != "https" && parsed.Scheme != "http") || parsed.Host == "" {
		return a.GetSettings(), fmt.Errorf("enter an http or https address")
	}

	client := &http.Client{Timeout: 3 * time.Minute}
	request, err := http.NewRequestWithContext(a.context(), http.MethodGet, parsed.String(), nil)
	if err != nil {
		return a.GetSettings(), err
	}
	response, err := client.Do(request)
	if err != nil {
		return a.GetSettings(), fmt.Errorf("download failed: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return a.GetSettings(), fmt.Errorf("download failed: the server answered %d", response.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, maxGeoFileSize+1))
	if err != nil {
		return a.GetSettings(), fmt.Errorf("download failed: %w", err)
	}

	name := path.Base(parsed.Path)
	if name == "" || name == "/" || name == "." {
		name = parsed.Host
	}
	return a.installGeoFile(data, models.GeoFile{Source: "url", Name: name, URL: parsed.String()})
}

// installGeoFile validates a geo file, stores it as its kind, and records it.
func (a *App) installGeoFile(data []byte, info models.GeoFile) (models.AppSettings, error) {
	if len(data) > maxGeoFileSize {
		return a.GetSettings(), fmt.Errorf("the file is larger than %d MB", maxGeoFileSize>>20)
	}
	kind, err := geodat.DetectKind(data)
	if err != nil {
		if errors.Is(err, geodat.ErrNotDat) {
			return a.GetSettings(), fmt.Errorf("that is not a geoip.dat or geosite.dat file")
		}
		return a.GetSettings(), err
	}
	codes, err := geodat.Codes(data)
	if err != nil {
		return a.GetSettings(), err
	}

	// Through a temporary file, so a failed write never leaves half a file
	// where a working one was.
	target := storage.GeoFilePath(string(kind))
	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		return a.GetSettings(), err
	}
	temporary := target + ".part"
	if err := os.WriteFile(temporary, data, 0o644); err != nil {
		return a.GetSettings(), err
	}
	if err := os.Rename(temporary, target); err != nil {
		_ = os.Remove(temporary)
		return a.GetSettings(), err
	}

	info.Codes = len(codes)
	info.UpdatedAt = time.Now().Unix()
	settings := a.GetSettings()
	files := make(map[string]models.GeoFile, len(settings.GeoFiles)+1)
	for key, value := range settings.GeoFiles {
		files[key] = value
	}
	files[string(kind)] = info
	settings.GeoFiles = files
	return a.SaveSettings(settings)
}

// RemoveGeoFile goes back to the built-in rule-sets for one kind.
func (a *App) RemoveGeoFile(kind string) (models.AppSettings, error) {
	if kind != string(geodat.GeoIP) && kind != string(geodat.GeoSite) {
		return a.GetSettings(), fmt.Errorf("unknown geo kind %q", kind)
	}
	if err := os.Remove(storage.GeoFilePath(kind)); err != nil && !errors.Is(err, os.ErrNotExist) {
		return a.GetSettings(), err
	}
	settings := a.GetSettings()
	files := map[string]models.GeoFile{}
	for key, value := range settings.GeoFiles {
		if key != kind {
			files[key] = value
		}
	}
	settings.GeoFiles = files
	return a.SaveSettings(settings)
}

// GetGeoCodes lists the codes in the user's file of one kind, for
// suggestions while typing. Empty when there is no custom file.
func (a *App) GetGeoCodes(kind string) []string {
	filePath := storage.GeoFilePath(kind)
	stat, err := os.Stat(filePath)
	if err != nil {
		return []string{}
	}

	geoCodeCache.mu.Lock()
	defer geoCodeCache.mu.Unlock()
	if entry, ok := geoCodeCache.entries[kind]; ok && entry.modified.Equal(stat.ModTime()) {
		return entry.codes
	}
	data, err := os.ReadFile(filePath)
	if err != nil {
		return []string{}
	}
	codes, err := geodat.Codes(data)
	if err != nil {
		return []string{}
	}
	geoCodeCache.entries[kind] = geoCodeEntry{modified: stat.ModTime(), codes: codes}
	return codes
}

// geoRuleSets writes a source rule-set for every geo value the routing uses
// that the user's own files cover, and reports what it could not find.
//
// It runs at connect time, so the sets always match the files as they are
// now. The core reloads a local rule-set when its file changes.
func geoRuleSets(settings models.AppSettings) (local map[string]string, custom map[string]bool, warnings []string) {
	local = map[string]string{}
	custom = map[string]bool{}

	wanted := map[string][]string{}
	for _, rule := range settings.UsableRules() {
		if rule.Kind == models.SourceGeoIP || rule.Kind == models.SourceGeoSite {
			wanted[rule.Kind] = append(wanted[rule.Kind], rule.CleanValues()...)
		}
	}

	for kind, values := range wanted {
		if _, ok := settings.GeoFiles[kind]; !ok || len(values) == 0 {
			continue
		}
		data, err := os.ReadFile(storage.GeoFilePath(kind))
		if err != nil {
			// The record is there but the file is gone: back to built-in
			// sets rather than refusing to connect.
			warnings = append(warnings, fmt.Sprintf("Custom %s.dat is missing; using the built-in rule-sets.", kind))
			continue
		}
		custom[kind] = true

		write := func(value string, rule map[string]any) {
			target := filepath.Join(storage.RuleSetDir(), kind+"-"+safeFileName(value)+".json")
			body, err := json.Marshal(map[string]any{"version": 3, "rules": []any{rule}})
			if err == nil {
				err = os.WriteFile(target, body, 0o644)
			}
			if err != nil {
				warnings = append(warnings, fmt.Sprintf("Could not write the rule-set for %s:%s: %v", kind, value, err))
				return
			}
			local[sbconfig.RuleSetTag(kind, value)] = target
		}
		missing := func(value string) {
			warnings = append(warnings, fmt.Sprintf("%s:%s is not in your %s.dat; that entry is skipped.", kind, value, kind))
		}

		if kind == models.SourceGeoIP {
			found, err := geodat.LookupIPs(data, values)
			if err != nil {
				warnings = append(warnings, fmt.Sprintf("Could not read your geoip.dat: %v", err))
				continue
			}
			for _, value := range values {
				prefixes := found[strings.ToLower(value)]
				if len(prefixes) == 0 {
					missing(value)
					continue
				}
				cidrs := make([]string, len(prefixes))
				for i, prefix := range prefixes {
					cidrs[i] = prefix.String()
				}
				write(value, map[string]any{"ip_cidr": cidrs})
			}
			continue
		}

		queries := make([]geodat.Query, len(values))
		for i, value := range values {
			queries[i] = geodat.ParseQuery(value)
		}
		found, err := geodat.LookupSites(data, queries)
		if err != nil {
			warnings = append(warnings, fmt.Sprintf("Could not read your geosite.dat: %v", err))
			continue
		}
		for i, value := range values {
			sites := found[queries[i]]
			if sites.Empty() {
				missing(value)
				continue
			}
			rule := map[string]any{}
			for field, list := range map[string][]string{
				"domain":         sites.Domain,
				"domain_suffix":  sites.Suffix,
				"domain_keyword": sites.Keyword,
				"domain_regex":   sites.Regex,
			} {
				if len(list) > 0 {
					rule[field] = list
				}
			}
			write(value, rule)
		}
	}
	return local, custom, warnings
}

// safeFileName keeps a geo code usable as part of a file name everywhere.
func safeFileName(value string) string {
	return strings.NewReplacer("@", "_at_", "!", "_not_").Replace(value)
}

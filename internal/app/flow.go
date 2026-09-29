package app

import (
	"errors"
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/Rigby-Foundation/NuggetVPN/internal/models"
	"github.com/Rigby-Foundation/NuggetVPN/internal/vflow"
)

// ---------------------------------------------------------------------------
// .vflow import and export
// ---------------------------------------------------------------------------

// maxFlowSize bounds a .vflow read. A large routing setup is a few hundred
// kilobytes.
const maxFlowSize = 16 << 20

// FlowImport is the result of loading a .vflow.
type FlowImport struct {
	// Imported is false when the dialog was cancelled.
	Imported bool               `json:"imported"`
	Settings models.AppSettings `json:"settings"`
	// MissingGeo maps a geo kind to the URL the flow's author downloaded it
	// from, for each file not already in use here — offered, not fetched
	// automatically, since that is a download the user did not ask for.
	MissingGeo map[string]string `json:"missing_geo"`
}

// ExportRouting saves the routing as a .vflow file. An empty path means the
// dialog was cancelled.
func (a *App) ExportRouting() (string, error) {
	if a.app == nil {
		return "", fmt.Errorf("application is not ready")
	}
	dialog := a.app.Dialog.SaveFile().
		SetMessage("Save routing").
		SetFilename("routing"+vflow.Extension).
		CanCreateDirectories(true).
		AddFilter("NuggetVPN routing", "*"+vflow.Extension)
	if a.window != nil {
		dialog = dialog.AttachToWindow(a.window)
	}
	target, err := dialog.PromptForSingleSelection()
	if err != nil || target == "" {
		return "", err
	}
	if !strings.HasSuffix(strings.ToLower(target), vflow.Extension) {
		target += vflow.Extension
	}

	data, err := vflow.Encode(a.GetSettings())
	if err != nil {
		return "", err
	}
	return target, os.WriteFile(target, data, 0o644)
}

// ImportRouting loads a .vflow file, replacing the current routing. The UI
// keeps the previous routing to offer an undo.
func (a *App) ImportRouting() (FlowImport, error) {
	if a.app == nil {
		return FlowImport{}, fmt.Errorf("application is not ready")
	}
	dialog := a.app.Dialog.OpenFile().
		SetTitle("Open routing").
		CanChooseFiles(true).
		AddFilter("NuggetVPN routing", "*"+vflow.Extension)
	if a.window != nil {
		dialog = dialog.AttachToWindow(a.window)
	}
	picked, err := dialog.PromptForSingleSelection()
	if err != nil || picked == "" {
		return FlowImport{Settings: a.GetSettings()}, err
	}

	file, err := os.Open(picked)
	if err != nil {
		return FlowImport{}, err
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, maxFlowSize+1))
	if err != nil {
		return FlowImport{}, err
	}
	if len(data) > maxFlowSize {
		return FlowImport{}, fmt.Errorf("that file is too large to be a .vflow")
	}

	flow, err := vflow.Decode(data)
	if err != nil {
		if errors.Is(err, vflow.ErrNotFlow) {
			return FlowImport{}, fmt.Errorf("that is not a NuggetVPN routing file")
		}
		return FlowImport{}, err
	}

	current := a.GetSettings()
	saved, err := a.SaveSettings(vflow.Apply(current, flow))
	if err != nil {
		return FlowImport{}, err
	}
	return FlowImport{Imported: true, Settings: saved, MissingGeo: vflow.MissingGeo(saved, flow)}, nil
}

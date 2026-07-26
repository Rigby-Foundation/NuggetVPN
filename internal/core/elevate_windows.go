package core

import (
	"fmt"
	"strings"

	"golang.org/x/sys/windows"
)

// elevateAndRun launches the core service through the UAC prompt.
func elevateAndRun(executable string, args []string) error {
	quoted := make([]string, 0, len(args))
	for _, arg := range args {
		if strings.ContainsAny(arg, ` "`) {
			quoted = append(quoted, `"`+strings.ReplaceAll(arg, `"`, `\"`)+`"`)
			continue
		}
		quoted = append(quoted, arg)
	}

	verb, err := windows.UTF16PtrFromString("runas")
	if err != nil {
		return err
	}
	file, err := windows.UTF16PtrFromString(executable)
	if err != nil {
		return err
	}
	parameters, err := windows.UTF16PtrFromString(strings.Join(quoted, " "))
	if err != nil {
		return err
	}

	if err := windows.ShellExecute(0, verb, file, parameters, nil, windows.SW_HIDE); err != nil {
		return fmt.Errorf("administrator approval is required to create the VPN interface: %w", err)
	}
	return nil
}

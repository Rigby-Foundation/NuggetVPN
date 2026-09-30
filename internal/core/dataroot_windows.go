//go:build windows

package core

import (
	"os"

	"golang.org/x/sys/windows"
)

// prepareDataRoot creates the core data directory and locks it down: full
// control for SYSTEM and Administrators, read and run for everyone else, and
// nothing inherited from ProgramData, whose default lets any user add files:
// a config written here must not be changeable between written and read.
func prepareDataRoot() error {
	root := dataRoot()
	if err := os.MkdirAll(root, 0o755); err != nil {
		return err
	}
	if !lockDataRoot {
		return nil
	}
	descriptor, err := windows.SecurityDescriptorFromString("D:P(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)(A;OICI;0x1200a9;;;BU)")
	if err != nil {
		return err
	}
	dacl, _, err := descriptor.DACL()
	if err != nil {
		return err
	}
	return windows.SetNamedSecurityInfo(
		root,
		windows.SE_FILE_OBJECT,
		windows.DACL_SECURITY_INFORMATION|windows.PROTECTED_DACL_SECURITY_INFORMATION,
		nil, nil, dacl, nil,
	)
}

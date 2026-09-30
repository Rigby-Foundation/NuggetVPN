//go:build windows

package core

import (
	"os"

	"golang.org/x/sys/windows"
)

// prepareCoresRoot creates the cores directory and locks it down: full
// control for SYSTEM and Administrators, read and run for everyone else, and
// nothing inherited from ProgramData, whose default lets any user add files.
func prepareCoresRoot() error {
	root := coresRoot()
	if err := os.MkdirAll(root, 0o755); err != nil {
		return err
	}
	if !lockCoresRoot {
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

package plugins

import (
	"archive/zip"
	"bytes"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
)

// Pack zips a plugin's folder into a .nuggetplugin and checks it the way
// installing it would, so a mistake shows up when it is built rather than
// when someone installs it.
func Pack(dir string) ([]byte, *Package, error) {
	var names []string
	err := filepath.WalkDir(dir, func(file string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.Type().IsRegular() {
			relative, err := filepath.Rel(dir, file)
			if err != nil {
				return err
			}
			names = append(names, filepath.ToSlash(relative))
		}
		return nil
	})
	if err != nil {
		return nil, nil, err
	}
	sort.Strings(names)

	var buffer bytes.Buffer
	writer := zip.NewWriter(&buffer)
	for _, name := range names {
		content, err := os.ReadFile(filepath.Join(dir, filepath.FromSlash(name)))
		if err != nil {
			return nil, nil, err
		}
		entry, err := writer.Create(name)
		if err != nil {
			return nil, nil, err
		}
		if _, err := entry.Write(content); err != nil {
			return nil, nil, err
		}
	}
	if err := writer.Close(); err != nil {
		return nil, nil, err
	}
	pkg, err := Read(buffer.Bytes())
	if err != nil {
		return nil, nil, err
	}
	return buffer.Bytes(), pkg, nil
}

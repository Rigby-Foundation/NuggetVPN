//go:build !production

package models

// DevBuild reports a development build: `wails3 dev`, or a build without the
// production tag. Some defaults differ, such as keeping logs.
const DevBuild = true

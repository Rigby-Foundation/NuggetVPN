//go:build !darwin || ios || !cgo

package wallpaper

import "image"

func readImage(path string) (image.Image, error) { return decodeImage(path) }

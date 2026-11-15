//go:build !darwin || ios || server || production

package main

import "github.com/wailsapp/wails/v3/pkg/application"

func configureWebViewDevtools(*application.WebviewWindow) {}

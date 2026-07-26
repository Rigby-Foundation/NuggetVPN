# NuggetVPN — Wails v3 + embedded sing-box
#
# The real build logic lives in Taskfile.yml (Wails v3 is Task-driven); these
# targets are thin wrappers so `make` keeps working and the sing-box build tags
# are never forgotten. buildtags.go fails the build if they are missing.

.DEFAULT_GOAL := build

## dev: run the app with hot reload
.PHONY: dev
dev:
	wails3 task dev

## build: compile the application into bin/
.PHONY: build
build:
	wails3 task build

## package: build and package for the host platform (.app / .deb+.rpm+AppImage / .exe)
.PHONY: package
package:
	wails3 task package

## dmg: build a distributable macOS .dmg
.PHONY: dmg
dmg:
	wails3 task darwin:package:dmg

## dmg-universal: universal (arm64 + amd64) macOS .dmg
.PHONY: dmg-universal
dmg-universal:
	wails3 task darwin:package:universal:dmg

## linux-packages: build .deb, .rpm and .AppImage
.PHONY: linux-packages
linux-packages:
	wails3 task linux:package

## bindings: regenerate the TypeScript bindings in frontend/bindings
.PHONY: bindings
bindings:
	wails3 task common:generate:bindings

## build-assets: regenerate build/ platform assets from build/config.yml
.PHONY: build-assets
build-assets:
	wails3 task common:update:build-assets

## test: run the Go test suite with the production build tags
.PHONY: test
test:
	wails3 task test

## vet: static analysis with the production build tags
.PHONY: vet
vet:
	wails3 task vet

## tags: print the sing-box build tags
.PHONY: tags
tags:
	@wails3 task tags

## frontend: build the web assets only
.PHONY: frontend
frontend:
	cd frontend && bun install && bun run build

## tidy: sync go.mod / go.sum
.PHONY: tidy
tidy:
	go mod tidy

## clean: remove build output
.PHONY: clean
clean:
	rm -rf bin frontend/dist

## help: list targets
.PHONY: help
help:
	@grep -E '^## ' $(MAKEFILE_LIST) | sed 's/## //'

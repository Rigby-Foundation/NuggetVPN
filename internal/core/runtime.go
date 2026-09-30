package core

// runtime is a core other than the built-in one, running in this process in
// its place.
type coreRuntime interface {
	stats() (up, down int64)
	connections() []ConnectionInfo
	// ruleHits is as Instance.RuleHits; ok is false for a core that cannot
	// tell rules apart by position.
	ruleHits() (hits []int, ok bool)
	closeConnection(id string) error
	close() error
}

// StartRequest is a start of any core.
type StartRequest struct {
	// Core is CoreBuiltin (or empty), CoreSingBox, CoreMihomo, or CoreXray.
	Core string
	// Config is the built-in core's config; for CoreSingBox and CoreMihomo it
	// is that core's own config (JSON or YAML). With CoreXray it is the
	// built-in core's config, which reaches the servers through Xray.
	Config []byte
	// Aux is Xray's own config, for CoreXray.
	Aux []byte
}

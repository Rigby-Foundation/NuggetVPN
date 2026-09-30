package sbconfig

import (
	"context"
	"encoding/json"
	"testing"

	sbjson "github.com/sagernet/sing/common/json"

	box "github.com/Rigby-Foundation/NuggetVPN/third_party/sing-box-official"
	"github.com/Rigby-Foundation/NuggetVPN/third_party/sing-box-official/include"
	"github.com/Rigby-Foundation/NuggetVPN/third_party/sing-box-official/option"
)

// The same config, run by official sing-box instead of the built-in fork:
// it must accept and construct it too.
func TestOfficialSingBoxAcceptsTheConfig(t *testing.T) {
	result, err := Build(featureRequest(t))
	if err != nil {
		t.Fatal(err)
	}
	var raw map[string]any
	if err := json.Unmarshal(result.JSON, &raw); err != nil {
		t.Fatal(err)
	}
	// The TUN needs administrator rights.
	delete(raw, "inbounds")
	delete(raw, "experimental")
	trimmed, err := json.Marshal(raw)
	if err != nil {
		t.Fatal(err)
	}
	ctx := include.Context(context.Background())
	options, err := sbjson.UnmarshalExtendedContext[option.Options](ctx, trimmed)
	if err != nil {
		t.Fatalf("official sing-box rejected the config: %v\n%s", err, result.JSON)
	}
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	instance, err := box.New(box.Options{Context: ctx, Options: options})
	if err != nil {
		t.Fatalf("official sing-box could not construct the config: %v\n%s", err, result.JSON)
	}
	_ = instance.Close()
}

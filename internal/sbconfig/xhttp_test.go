package sbconfig

import (
	"context"
	"encoding/json"
	"net/url"
	"testing"

	box "github.com/sagernet/sing-box"
	"github.com/sagernet/sing-box/include"
	"github.com/sagernet/sing-box/option"
	sbjson "github.com/sagernet/sing/common/json"
)

// An XHTTP server with its finer settings in "extra", including a field the
// built-in core does not know (cMaxLifetimeMs) and a separate downlink.
var xhttpExtraLink = "vless://11111111-2222-3333-4444-555555555555@x.example.com:443?encryption=none&type=xhttp&path=%2Fapi%2F&host=x.example.com&mode=packet-up&security=tls&sni=x.example.com&fp=chrome&alpn=h2%2Chttp%2F1.1&extra=" +
	url.QueryEscape(`{"xmux":{"cMaxLifetimeMs":0,"cMaxReuseTimes":"36-96","maxConcurrency":"8-32","maxConnections":0,"hMaxRequestTimes":"320-640","hMaxReusableSecs":"720-1800"},"uplinkDataKey":"X-Data","uplinkChunkSize":3072,"uplinkHTTPMethod":"GET","uplinkDataPlacement":"header","downloadSettings":{"address":"down.example.com","port":443,"network":"xhttp","security":"tls","tlsSettings":{"serverName":"down.example.com","alpn":["h2"]},"xhttpSettings":{"path":"/down"}}}`) +
	"#X"

func TestXHTTPExtraConstructs(t *testing.T) {
	result := buildFor(t, xhttpExtraLink, nil)

	var raw map[string]any
	if err := json.Unmarshal(result.JSON, &raw); err != nil {
		t.Fatal(err)
	}
	delete(raw, "inbounds")
	delete(raw, "experimental")
	trimmed, err := json.Marshal(raw)
	if err != nil {
		t.Fatal(err)
	}

	ctx := include.Context(context.Background())
	options, err := sbjson.UnmarshalExtendedContext[option.Options](ctx, trimmed)
	if err != nil {
		t.Fatalf("the built-in core refused the XHTTP settings: %v", err)
	}
	var found bool
	for _, outbound := range options.Outbounds {
		vless, ok := outbound.Options.(*option.VLESSOutboundOptions)
		if !ok || vless.Transport == nil {
			continue
		}
		found = true
		xhttp := vless.Transport.XHTTPOptions
		if xhttp.UplinkHTTPMethod != "GET" || xhttp.UplinkDataPlacement != "header" || xhttp.UplinkDataKey != "X-Data" {
			t.Errorf("uplink settings lost: %+v", xhttp)
		}
		if xhttp.Xmux == nil || xhttp.Xmux.MaxConcurrency.From != 8 || xhttp.Xmux.MaxConcurrency.To != 32 {
			t.Errorf("xmux lost: %+v", xhttp.Xmux)
		}
		if xhttp.DownloadSettings == nil || xhttp.DownloadSettings.Server != "down.example.com" || xhttp.DownloadSettings.Path != "/down" {
			t.Errorf("download settings lost: %+v", xhttp.DownloadSettings)
		}
	}
	if !found {
		t.Fatal("no XHTTP outbound in the config")
	}

	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	instance, err := box.New(box.Options{Context: ctx, Options: options})
	if err != nil {
		t.Fatalf("the built-in core could not construct the XHTTP outbound: %v", err)
	}
	_ = instance.Close()
}

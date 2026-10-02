package link

import (
	"net/url"
	"testing"

	"github.com/Rigby-Foundation/NuggetVPN/internal/models"
)

// XHTTPExtra is the "extra" a provider sends for servers that take uploads
// as GET requests with the data in a header, with connection reuse tuned.
const XHTTPExtra = `{"xmux":{"cMaxLifetimeMs":0,"cMaxReuseTimes":"36-96","maxConcurrency":"8-32","maxConnections":0,"hMaxRequestTimes":"320-640","hMaxReusableSecs":"720-1800"},"uplinkDataKey":"X-Data","uplinkChunkSize":3072,"uplinkHTTPMethod":"GET","uplinkDataPlacement":"header"}`

func TestXHTTPExtraIsApplied(t *testing.T) {
	link := "vless://11111111-2222-3333-4444-555555555555@x.example.com:443?encryption=none&type=xhttp&path=%2Fapi%2F&host=x.example.com&mode=packet-up&security=tls&sni=x.example.com&fp=chrome&alpn=h2%2Chttp%2F1.1&extra=" +
		url.QueryEscape(XHTTPExtra) + "#X"
	outbound, err := ParseOutbound(link, models.DefaultSettings())
	if err != nil {
		t.Fatal(err)
	}
	transport := outbound["transport"].(map[string]any)
	for key, want := range map[string]any{
		"type":                "xhttp",
		"mode":                "packet-up",
		"uplinkHTTPMethod":    "GET",
		"uplinkDataPlacement": "header",
		"uplinkDataKey":       "X-Data",
		"uplinkChunkSize":     float64(3072),
	} {
		if transport[key] != want {
			t.Errorf("%s = %v, want %v", key, transport[key], want)
		}
	}
	mux, _ := transport["xmux"].(map[string]any)
	if mux["cMaxReuseTimes"] != "36-96" || mux["maxConcurrency"] != "8-32" {
		t.Errorf("xmux = %v", mux)
	}
	// Xray has it; the built-in core does not, and refuses unknown fields.
	if _, kept := mux["cMaxLifetimeMs"]; kept {
		t.Error("cMaxLifetimeMs kept, which the built-in core refuses")
	}
}

func TestXHTTPDownloadSettingsAreConverted(t *testing.T) {
	extra := `{"downloadSettings":{"address":"down.example.com","port":8443,"network":"xhttp","security":"reality","realitySettings":{"serverName":"www.example.com","publicKey":"MRCLmc0aZOhWpNsFPMHqYVCbHrJMuwQ5tDcWbXqIxSs","shortId":"ab","fingerprint":"firefox"},"xhttpSettings":{"path":"/down","extra":{"noGRPCHeader":true}}}}`
	link := "vless://11111111-2222-3333-4444-555555555555@up.example.com:443?encryption=none&type=xhttp&path=%2Fup&security=tls&sni=up.example.com&extra=" +
		url.QueryEscape(extra) + "#X"
	outbound, err := ParseOutbound(link, models.DefaultSettings())
	if err != nil {
		t.Fatal(err)
	}
	download, _ := outbound["transport"].(map[string]any)["downloadSettings"].(map[string]any)
	if download["server"] != "down.example.com" || download["server_port"] != 8443 || download["path"] != "/down" || download["noGRPCHeader"] != true {
		t.Fatalf("download = %v", download)
	}
	tls, _ := download["tls"].(map[string]any)
	reality, _ := tls["reality"].(map[string]any)
	if tls["server_name"] != "www.example.com" || reality["public_key"] != "MRCLmc0aZOhWpNsFPMHqYVCbHrJMuwQ5tDcWbXqIxSs" {
		t.Errorf("download tls = %v", tls)
	}
}

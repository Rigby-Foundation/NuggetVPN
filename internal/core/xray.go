package core

import (
	"bytes"
	"fmt"
	"strings"
	"sync"
	"sync/atomic"

	applog "github.com/xtls/xray-core/app/log"
	commonlog "github.com/xtls/xray-core/common/log"
	xraycore "github.com/xtls/xray-core/core"
	"github.com/xtls/xray-core/infra/conf/serial"
	_ "github.com/xtls/xray-core/main/distro/all"
)

// xraySink is where Xray's log lines go: its logger is set up from a package
// registry, not per instance.
var xraySink atomic.Pointer[LogSink]

var registerXrayLog sync.Once

type xrayLogHandler struct{}

func (xrayLogHandler) Handle(message commonlog.Message) {
	sink := xraySink.Load()
	if sink == nil || *sink == nil {
		return
	}
	level := "info"
	if general, ok := message.(*commonlog.GeneralMessage); ok {
		switch general.Severity {
		case commonlog.Severity_Error:
			level = "error"
		case commonlog.Severity_Warning:
			level = "warn"
		case commonlog.Severity_Debug:
			level = "debug"
		}
	}
	(*sink)(level, strings.TrimSpace(message.String()))
}

// startXray runs Xray from its JSON config.
func startXray(configJSON []byte, sink LogSink) (*xraycore.Instance, error) {
	registerXrayLog.Do(func() {
		_ = applog.RegisterHandlerCreator(applog.LogType_Console, func(applog.LogType, applog.HandlerCreatorOptions) (commonlog.Handler, error) {
			return xrayLogHandler{}, nil
		})
	})
	xraySink.Store(&sink)

	config, err := serial.LoadJSONConfig(bytes.NewReader(configJSON))
	if err != nil {
		return nil, fmt.Errorf("invalid Xray config: %w", err)
	}
	instance, err := xraycore.New(config)
	if err != nil {
		return nil, fmt.Errorf("create Xray: %w", err)
	}
	if err := instance.Start(); err != nil {
		_ = instance.Close()
		return nil, fmt.Errorf("start Xray: %w", err)
	}
	return instance, nil
}

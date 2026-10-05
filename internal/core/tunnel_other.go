//go:build !ios

package core

import "errors"

func StartTunnelIOS([]byte) error { return errors.New("not supported on this platform") }
func StopTunnelIOS() error        { return errors.New("not supported on this platform") }
func GetTunnelStatusIOS() int     { return 0 }
func GetTunnelStatsIOS() (int64, int64) { return 0, 0 }
func (c *Client) startStatsTickerIOS() {}

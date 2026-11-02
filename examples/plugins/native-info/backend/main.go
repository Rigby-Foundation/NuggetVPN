// A minimal API-1 backend. More complex backends should dispatch requests
// concurrently and match replies to their own app calls by id.
package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"runtime"
)

func main() {
	scanner := bufio.NewScanner(os.Stdin)
	scanner.Buffer(make([]byte, 4096), 1<<20)
	for scanner.Scan() {
		var request struct {
			ID     json.RawMessage `json:"id"`
			Method string          `json:"method"`
		}
		if err := json.Unmarshal(scanner.Bytes(), &request); err != nil {
			return
		}
		if len(request.ID) == 0 || request.Method == "" {
			continue
		}
		reply := map[string]any{"id": request.ID}
		switch request.Method {
		case "plugin.initialize":
			reply["result"] = map[string]int{"api": 1}
		case "system.info":
			reply["result"] = map[string]any{"os": runtime.GOOS, "architecture": runtime.GOARCH, "cpus": runtime.NumCPU()}
		default:
			reply["error"] = "unknown method"
		}
		data, err := json.Marshal(reply)
		if err != nil {
			return
		}
		fmt.Println(string(data))
	}
}

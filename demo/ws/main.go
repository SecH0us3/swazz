// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net/http"
	"runtime/debug"
	"strings"

	"nhooyr.io/websocket"
)

func main() {
	port := flag.Int("port", 50052, "Port to listen on")
	flag.Parse()

	http.HandleFunc("/ws", wsHandler)

	addr := fmt.Sprintf(":%d", *port)
	log.Printf("Starting vulnerable WebSocket demo API on %s/ws", addr)
	if err := http.ListenAndServe(addr, nil); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}

func wsHandler(w http.ResponseWriter, r *http.Request) {
	c, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		InsecureSkipVerify: true,
	})
	if err != nil {
		log.Printf("Failed to accept: %v", err)
		return
	}
	defer c.Close(websocket.StatusNormalClosure, "")

	for {
		typ, msg, err := c.Read(r.Context())
		if err != nil {
			break
		}

		if typ != websocket.MessageText {
			continue
		}

		var req map[string]interface{}
		if err := json.Unmarshal(msg, &req); err != nil {
			// fallback: check string
			if string(msg) == "crash" {
				c.Close(websocket.StatusInternalError, "simulated crash")
				c.Close(websocket.StatusAbnormalClosure, "") // 1006 effect
				return
			}
			continue
		}

		action, _ := req["action"].(string)

		switch action {
		case "search", "query":
			query, _ := req["query"].(string)
			if strings.ContainsAny(query, "'\";-") {
				resp := map[string]string{
					"error": "SQL syntax error near '" + query + "'",
				}
				b, _ := json.Marshal(resp)
				c.Write(r.Context(), websocket.MessageText, b)
			} else {
				c.Write(r.Context(), websocket.MessageText, []byte(`{"result": "ok"}`))
			}

		case "update", "user":
			id, _ := req["id"].(float64)
			if id <= 0 {
				// simulate panic
				func() {
					defer func() {
						if r := recover(); r != nil {
							errStr := fmt.Sprintf("panic: index out of range\n%s", debug.Stack())
							c.Write(r.Context(), websocket.MessageText, []byte(errStr))
							c.Close(websocket.StatusInternalError, "internal error")
						}
					}()
					panic("simulated panic on update")
				}()
				return
			} else {
				c.Write(r.Context(), websocket.MessageText, []byte(`{"status": "updated"}`))
			}

		case "exec_diag":
			payload, _ := req["payload"].(map[string]interface{})
			if payload != nil {
				cmd, _ := payload["cmd"].(string)
				if strings.ContainsAny(cmd, "|;&$") {
					resp := map[string]string{
						"output": "sh: command not found",
					}
					b, _ := json.Marshal(resp)
					c.Write(r.Context(), websocket.MessageText, b)
				} else {
					c.Write(r.Context(), websocket.MessageText, []byte(`{"output": "diag done"}`))
				}
			}

		case "get_config":
			resp := map[string]string{
				"api_token": "secret_token_12345",
			}
			b, _ := json.Marshal(resp)
			c.Write(r.Context(), websocket.MessageText, b)

		case "crash":
			return // drops connection, client sees EOF/1006
			
		default:
			c.Write(r.Context(), websocket.MessageText, []byte(`{"error": "unknown action"}`))
		}
	}
}


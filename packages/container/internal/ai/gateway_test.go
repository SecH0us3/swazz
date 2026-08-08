// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package ai

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

func TestGatewayClient_ChatCompletion_GeminiFormat(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("cf-aig-authorization") != "Bearer test-cf-token" {
			t.Errorf("expected cf-aig-authorization header, got %s", r.Header.Get("cf-aig-authorization"))
		}
		if r.Header.Get("x-goog-api-key") != "test-api-key" {
			t.Errorf("expected x-goog-api-key header, got %s", r.Header.Get("x-goog-api-key"))
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{
			"candidates": [
				{
					"content": {
						"parts": [
							{"text": "test response from gemini"}
						]
					}
				}
			]
		}`))
	}))
	defer server.Close()

	client := NewGatewayClient(server.URL+"/gemini", "test-cf-token", "test-api-key")
	resp, err := client.ChatCompletion(context.Background(), "System prompt", "User prompt")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if resp != "test response from gemini" {
		t.Errorf("expected 'test response from gemini', got '%s'", resp)
	}
}

func TestGatewayClient_ChatCompletion_OpenAIFormat(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer test-api-key" {
			t.Errorf("expected Authorization header, got %s", r.Header.Get("Authorization"))
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{
			"choices": [
				{
					"message": {
						"content": "test response from openai"
					}
				}
			]
		}`))
	}))
	defer server.Close()

	client := NewGatewayClient(server.URL+"/openai-proxy", "", "test-api-key")
	resp, err := client.ChatCompletion(context.Background(), "", "User prompt")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if resp != "test response from openai" {
		t.Errorf("expected 'test response from openai', got '%s'", resp)
	}
}

func TestGatewayClient_ChatCompletion_RateLimitRetry(t *testing.T) {
	var attempts int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		count := atomic.AddInt32(&attempts, 1)
		if count == 1 {
			w.WriteHeader(http.StatusTooManyRequests)
			w.Write([]byte(`{"error": "rate limited"}`))
			return
		}
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"choices": [{"message": {"content": "ok after retry"}}]}`))
	}))
	defer server.Close()

	client := NewGatewayClient(server.URL, "", "")
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	resp, err := client.ChatCompletion(ctx, "", "test")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if resp != "ok after retry" {
		t.Errorf("expected 'ok after retry', got '%s'", resp)
	}
	if atomic.LoadInt32(&attempts) != 2 {
		t.Errorf("expected 2 attempts, got %d", atomic.LoadInt32(&attempts))
	}
}

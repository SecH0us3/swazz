package analyzer

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestFindHandlerContext(t *testing.T) {
	tempDir := t.TempDir()

	// Express JS
	expressContent := `
const express = require('express');
const app = express();

app.get('/api/users', (req, res) => {
    res.json({ users: [] });
});

app.post("/api/auth/login", (req, res) => {
    res.json({ token: "123" });
});
`
	err := os.WriteFile(filepath.Join(tempDir, "app.js"), []byte(expressContent), 0644)
	if err != nil {
		t.Fatal(err)
	}

	// Gin Go
	ginContent := `
package main

import "github.com/gin-gonic/gin"

func main() {
	r := gin.Default()
	r.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "ok"})
	})
}
`
	err = os.WriteFile(filepath.Join(tempDir, "main.go"), []byte(ginContent), 0644)
	if err != nil {
		t.Fatal(err)
	}

	// Spring Boot Java
	springContent := `
package com.example.demo;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class DemoController {

    @GetMapping("/api/items")
    public String getItems() {
        return "items";
    }
}
`
	err = os.WriteFile(filepath.Join(tempDir, "DemoController.java"), []byte(springContent), 0644)
	if err != nil {
		t.Fatal(err)
	}

	indexer := NewRepoIndexer(tempDir)

	tests := []struct {
		name       string
		method     string
		route      string
		expectFile string
		expectText string
		expectErr  bool
	}{
		{
			name:       "Express GET",
			method:     "GET",
			route:      "/api/users",
			expectFile: "app.js",
			expectText: "app.get('/api/users', (req, res) => {",
			expectErr:  false,
		},
		{
			name:       "Express POST double quotes",
			method:     "POST",
			route:      "/api/auth/login",
			expectFile: "app.js",
			expectText: "app.post(\"/api/auth/login\", (req, res) => {",
			expectErr:  false,
		},
		{
			name:       "Gin GET",
			method:     "GET",
			route:      "/health",
			expectFile: "main.go",
			expectText: "r.GET(\"/health\", func(c *gin.Context) {",
			expectErr:  false,
		},
		{
			name:       "Spring Boot GetMapping",
			method:     "GET",
			route:      "/api/items",
			expectFile: "DemoController.java",
			expectText: "@GetMapping(\"/api/items\")",
			expectErr:  false,
		},
		{
			name:       "Not found",
			method:     "PUT",
			route:      "/not-found",
			expectFile: "",
			expectText: "",
			expectErr:  true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			filePath, context, err := indexer.FindHandlerContext(tt.method, tt.route)
			if tt.expectErr {
				if err == nil {
					t.Fatalf("expected error but got none")
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}

			if filepath.Base(filePath) != tt.expectFile {
				t.Errorf("expected file %s, got %s", tt.expectFile, filepath.Base(filePath))
			}

			if !strings.Contains(context, tt.expectText) {
				t.Errorf("expected context to contain %q, but it did not.\nContext: %s", tt.expectText, context)
			}
		})
	}
}

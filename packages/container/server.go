package main

import (
	"log"
	"net/http"
	"os"
	"strings"
	"swazz-engine/api"

	"github.com/gin-gonic/gin"
)

func runServer() {
	gin.SetMode(gin.ReleaseMode)

	r := gin.New()
	r.Use(gin.Recovery())
	r.Use(gin.Logger())

	// Content-Signal middleware to declare AI scraping policies
	r.Use(func(c *gin.Context) {
		c.Header("Content-Signal", "ai-train=no, search=yes")
		c.Next()
	})

	allowedOrigin := os.Getenv("ALLOWED_ORIGIN")
	if allowedOrigin == "" {
		allowedOrigin = "http://localhost:5173" // Default for local dev
	}

	// CORS middleware
	r.Use(func(c *gin.Context) {
		origin := c.Request.Header.Get("Origin")

		// If origin is empty, it might be a direct request, but for CORS we need to check it
		// For local dev, we'll be permissive if it's localhost
		isLocalhost := strings.HasPrefix(origin, "http://localhost:") || strings.HasPrefix(origin, "http://127.0.0.1:")

		if allowedOrigin == "*" || origin == allowedOrigin || isLocalhost {
			if origin != "" {
				c.Header("Access-Control-Allow-Origin", origin)
			} else if allowedOrigin == "*" {
				c.Header("Access-Control-Allow-Origin", "*")
			}
		}

		c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		c.Header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With")
		c.Header("Access-Control-Allow-Credentials", "true")

		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}
		c.Next()
	})

	// Serve static files from web/dist if they exist
	if _, err := os.Stat("web/dist"); err == nil {
		r.StaticFS("/assets", http.Dir("web/dist/assets"))
		r.StaticFile("/favicon.svg", "web/dist/favicon.svg")
		r.StaticFile("/robots.txt", "web/dist/robots.txt")

		r.NoRoute(func(c *gin.Context) {
			if !strings.HasPrefix(c.Request.URL.Path, "/api") {
				c.File("web/dist/index.html")
				return
			}
			c.JSON(http.StatusNotFound, gin.H{"error": "API route not found"})
		})
	}

	// Routes
	r.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"status":  "ok",
			"service": "swazz-engine",
			"version": Version,
		})
	})

	handler := api.NewHandler()
	apiGroup := r.Group("/api")
	{
		apiGroup.GET("/version", func(c *gin.Context) {
			c.JSON(http.StatusOK, gin.H{
				"version": Version,
			})
		})
		apiGroup.POST("/parse", handler.ParseSpec)
		apiGroup.POST("/fuzz/start", handler.StartFuzz)
		apiGroup.POST("/fuzz/stop", handler.StopFuzz)
		apiGroup.POST("/fuzz/pause", handler.PauseFuzz)
		apiGroup.POST("/fuzz/resume", handler.ResumeFuzz)
		apiGroup.GET("/fuzz/stream", handler.StreamResults)
		apiGroup.GET("/stats", handler.GetStats)
		apiGroup.POST("/proxy", handler.Proxy)
		apiGroup.GET("/report", handler.GetReport)
		apiGroup.GET("/payload-catalog", handler.GetPayloadCatalog)
		apiGroup.Any("/oob/:uuid", handler.HandleOOB)
	}

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	log.Printf("swazz-engine starting on :%s", port) // #nosec G706
	if err := r.Run("0.0.0.0:" + port); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}

//go:build embed

package main

import (
	"embed"
	"io"
	"io/fs"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

//go:embed all:web/dist
var embeddedFrontend embed.FS

func serveEmbeddedFrontend(r *gin.Engine) {
	sub, err := fs.Sub(embeddedFrontend, "web/dist")
	if err != nil {
		return
	}
	fileServer := http.FileServer(http.FS(sub))
	r.NoRoute(func(c *gin.Context) {
		path := c.Request.URL.Path
		// Serve existing static files directly
		if _, err := sub.Open(strings.TrimPrefix(path, "/")); err == nil && path != "/" {
			fileServer.ServeHTTP(c.Writer, c.Request)
			return
		}
		// SPA fallback: serve index.html for all non-file routes
		idx, err := sub.Open("index.html")
		if err != nil {
			c.Status(http.StatusNotFound)
			return
		}
		defer idx.Close()
		content, _ := io.ReadAll(idx)
		c.Data(http.StatusOK, "text/html; charset=utf-8", content)
	})
}

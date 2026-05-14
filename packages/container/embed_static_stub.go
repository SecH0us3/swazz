//go:build !embed

package main

import "github.com/gin-gonic/gin"

// serveEmbeddedFrontend is a no-op when built without the 'embed' tag.
// In production (Docker / Cloudflare Container), the frontend is served
// by the swazz-frontend Worker separately.
func serveEmbeddedFrontend(_ *gin.Engine) {}

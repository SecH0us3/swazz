package discovery

import (
	"context"
	"fmt"
	"sync"
	"time"

	"swazz-engine/internal/mcp"
)

// ProbedServer is a DiscoveredService enriched with MCP handshake results.
type ProbedServer struct {
	DiscoveredService
	ServerName    string
	ServerVersion string
	Tools         []mcp.Tool
	ProbeError    error
}

// SecretResolver retrieves an auth token from a K8s Secret by namespace and name.
type SecretResolver func(namespace, secretName string) (string, error)

// ProbeService connects to a single MCP endpoint, performs initialize + tools/list,
// and returns the enriched ProbedServer. allowPrivateIPs is always true for in-cluster.
func ProbeService(ctx context.Context, svc DiscoveredService, headers map[string]string) ProbedServer {
	probeCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()

	result := ProbedServer{DiscoveredService: svc}

	endpointURL := svc.InClusterURL()

	var client mcp.Client
	switch svc.Transport {
	case "sse":
		client = mcp.NewSSEClient(endpointURL, true, headers, nil)
	default:
		client = mcp.NewHTTPClient(endpointURL, true, headers)
	}

	if err := client.Connect(probeCtx); err != nil {
		result.ProbeError = fmt.Errorf("connect to %s: %w", endpointURL, err)
		return result
	}
	defer client.Close()

	tools, err := client.ListTools(probeCtx)
	if err != nil {
		result.ProbeError = fmt.Errorf("tools/list on %s: %w", endpointURL, err)
		return result
	}

	result.Tools = tools
	result.ServerName = svc.DisplayName
	result.ServerVersion = "unknown"

	return result
}

// ProbeAll probes multiple discovered services concurrently.
func ProbeAll(ctx context.Context, services []DiscoveredService, concurrency int, secretResolver SecretResolver) []ProbedServer {
	if concurrency <= 0 {
		concurrency = 5
	}

	results := make([]ProbedServer, len(services))
	sem := make(chan struct{}, concurrency)
	var wg sync.WaitGroup

	for i, svc := range services {
		wg.Add(1)
		go func(idx int, s DiscoveredService) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()

			var headers map[string]string
			var secretErr error
			if s.AuthSecretRef != "" && secretResolver != nil {
				token, err := secretResolver(s.Namespace, s.AuthSecretRef)
				if err != nil {
					secretErr = fmt.Errorf("resolving secret %s/%s: %w", s.Namespace, s.AuthSecretRef, err)
				} else if token != "" {
					headers = map[string]string{
						"Authorization": "Bearer " + token,
					}
				}
			}

			probed := ProbeService(ctx, s, headers)
			if secretErr != nil && probed.ProbeError == nil {
				probed.ProbeError = secretErr
			}
			results[idx] = probed
		}(i, svc)
	}

	wg.Wait()
	return results
}

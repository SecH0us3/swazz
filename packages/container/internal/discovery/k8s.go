package discovery

import (
	"context"
	"fmt"
	"net"
	"net/url"
	"strconv"
	"strings"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
)

const (
	// Standard annotations for MCP service discovery.
	AnnotationEnabled    = "mcp.network/enabled"
	AnnotationPort       = "mcp.network/port"
	AnnotationPath       = "mcp.network/path"
	AnnotationTransport  = "mcp.network/transport" // "http", "sse"
	AnnotationName       = "mcp.network/name"
	AnnotationAuthSecret = "mcp.network/auth-secret" // #nosec G101 -- annotation name, not credential
)

// DiscoveredService represents an MCP server found via K8s service discovery.
type DiscoveredService struct {
	Name          string
	Namespace     string
	Host          string // <service>.<namespace>.svc.cluster.local
	Port          int
	Endpoint      string // e.g. "/mcp", "/sse"
	Transport     string // "http" or "sse"
	DisplayName   string // human-readable name from annotation
	AuthSecretRef string // K8s secret name for auth token (optional)
}

// InClusterURL returns the full URL to the MCP endpoint.
func (d DiscoveredService) InClusterURL() string {
	u := &url.URL{
		Scheme: "http",
		Host:   net.JoinHostPort(d.Host, strconv.Itoa(d.Port)),
		Path:   d.Endpoint,
	}
	return u.String()
}

// ListOptions configures which namespaces and services to scan.
type ListOptions struct {
	NamespaceInclude []string // if non-empty, scan only these namespaces
	NamespaceExclude []string // skip these namespaces (e.g. kube-system)
	LabelSelector    string   // additional K8s label selector
}

// ListMCPServices queries the K8s API for Services annotated with mcp.network/enabled=true.
func ListMCPServices(ctx context.Context, clientset kubernetes.Interface, opts ListOptions) ([]DiscoveredService, error) {
	excludeSet := make(map[string]bool, len(opts.NamespaceExclude))
	for _, ns := range opts.NamespaceExclude {
		excludeSet[ns] = true
	}

	var namespaces []string
	if len(opts.NamespaceInclude) > 0 {
		for _, ns := range opts.NamespaceInclude {
			if !excludeSet[ns] {
				namespaces = append(namespaces, ns)
			}
		}
	} else {
		namespaces = []string{metav1.NamespaceAll}
	}

	listOpts := metav1.ListOptions{}
	if opts.LabelSelector != "" {
		listOpts.LabelSelector = opts.LabelSelector
	}

	var result []DiscoveredService
	for _, ns := range namespaces {
		svcs, err := clientset.CoreV1().Services(ns).List(ctx, listOpts)
		if err != nil {
			return nil, fmt.Errorf("listing services in namespace %q: %w", ns, err)
		}

		for _, svc := range svcs.Items {
			if excludeSet[svc.Namespace] {
				continue
			}
			if svc.Annotations[AnnotationEnabled] != "true" {
				continue
			}
			ds := serviceToDiscovered(svc)
			result = append(result, ds)
		}
	}

	return result, nil
}

func serviceToDiscovered(svc corev1.Service) DiscoveredService {
	port := 8080
	if p, ok := svc.Annotations[AnnotationPort]; ok {
		if parsed, err := strconv.Atoi(p); err == nil {
			port = parsed
		}
	} else if len(svc.Spec.Ports) > 0 {
		port = int(svc.Spec.Ports[0].Port)
	}

	endpoint := "/mcp"
	if p, ok := svc.Annotations[AnnotationPath]; ok && p != "" {
		if !strings.HasPrefix(p, "/") {
			p = "/" + p
		}
		endpoint = p
	}

	transport := "http"
	if t, ok := svc.Annotations[AnnotationTransport]; ok && (t == "sse" || t == "http") {
		transport = t
	}

	displayName := svc.Name
	if n, ok := svc.Annotations[AnnotationName]; ok && n != "" {
		displayName = n
	}

	return DiscoveredService{
		Name:          svc.Name,
		Namespace:     svc.Namespace,
		Host:          fmt.Sprintf("%s.%s.svc.cluster.local", svc.Name, svc.Namespace),
		Port:          port,
		Endpoint:      endpoint,
		Transport:     transport,
		DisplayName:   displayName,
		AuthSecretRef: svc.Annotations[AnnotationAuthSecret],
	}
}

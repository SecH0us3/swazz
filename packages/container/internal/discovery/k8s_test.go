// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package discovery

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/util/intstr"
	"k8s.io/client-go/kubernetes/fake"
)

func TestListMCPServices_FindsAnnotatedServices(t *testing.T) {
	client := fake.NewSimpleClientset(
		&corev1.Service{
			ObjectMeta: metav1.ObjectMeta{
				Name:      "payment-mcp",
				Namespace: "prod",
				Annotations: map[string]string{
					AnnotationEnabled:   "true",
					AnnotationPort:      "8080",
					AnnotationPath:      "/mcp",
					AnnotationTransport: "http",
				},
			},
			Spec: corev1.ServiceSpec{
				Ports: []corev1.ServicePort{
					{Port: 8080, TargetPort: intstr.FromInt(8080)},
				},
			},
		},
		&corev1.Service{
			ObjectMeta: metav1.ObjectMeta{
				Name:      "regular-api",
				Namespace: "prod",
			},
			Spec: corev1.ServiceSpec{
				Ports: []corev1.ServicePort{
					{Port: 80},
				},
			},
		},
	)

	services, err := ListMCPServices(context.Background(), client, ListOptions{})
	require.NoError(t, err)
	assert.Len(t, services, 1)
	assert.Equal(t, "payment-mcp", services[0].Name)
	assert.Equal(t, "prod", services[0].Namespace)
	assert.Equal(t, 8080, services[0].Port)
	assert.Equal(t, "/mcp", services[0].Endpoint)
	assert.Equal(t, "http", services[0].Transport)
}

func TestListMCPServices_RespectsNamespaceExclude(t *testing.T) {
	client := fake.NewSimpleClientset(
		&corev1.Service{
			ObjectMeta: metav1.ObjectMeta{
				Name:      "system-mcp",
				Namespace: "kube-system",
				Annotations: map[string]string{
					AnnotationEnabled: "true",
				},
			},
			Spec: corev1.ServiceSpec{
				Ports: []corev1.ServicePort{
					{Port: 8080},
				},
			},
		},
	)

	services, err := ListMCPServices(context.Background(), client, ListOptions{
		NamespaceExclude: []string{"kube-system"},
	})
	require.NoError(t, err)
	assert.Empty(t, services)
}

func TestListMCPServices_DefaultsPortAndPath(t *testing.T) {
	client := fake.NewSimpleClientset(
		&corev1.Service{
			ObjectMeta: metav1.ObjectMeta{
				Name:      "minimal-mcp",
				Namespace: "default",
				Annotations: map[string]string{
					AnnotationEnabled: "true",
				},
			},
			Spec: corev1.ServiceSpec{
				Ports: []corev1.ServicePort{
					{Port: 3000},
				},
			},
		},
	)

	services, err := ListMCPServices(context.Background(), client, ListOptions{})
	require.NoError(t, err)
	require.Len(t, services, 1)
	assert.Equal(t, 3000, services[0].Port)
	assert.Equal(t, "/mcp", services[0].Endpoint)  // default
	assert.Equal(t, "http", services[0].Transport) // default
}

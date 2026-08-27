// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package differential

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"swazz-engine/internal/swagger"
)

func TestExtractResourceIDs(t *testing.T) {
	t.Run("nested json with ids", func(t *testing.T) {
		body := []byte(`{
			"id": "card_998811",
			"user": {
				"account_id": "acc_5544",
				"uuid": "a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d"
			},
			"items": [
				{"item_id": 1001, "name": "item1"},
				{"item_id": 1002, "name": "item2"}
			]
		}`)

		ids := ExtractResourceIDs(body)
		assert.Contains(t, ids, "card_998811")
		assert.Contains(t, ids, "acc_5544")
		assert.Contains(t, ids, "a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d")
		assert.Contains(t, ids, "1001")
		assert.Contains(t, ids, "1002")
	})

	t.Run("invalid json", func(t *testing.T) {
		assert.Nil(t, ExtractResourceIDs([]byte(`not json`)))
	})
}

func TestChainHarvester_RecordAndBuildCandidates(t *testing.T) {
	harvester := NewChainHarvester()

	postEp := swagger.EndpointConfig{
		Method: "POST",
		Path:   "/api/v1/workspaces",
	}

	getEp := swagger.EndpointConfig{
		Method: "GET",
		Path:   "/api/v1/workspaces/{workspace_id}",
	}

	deleteEp := swagger.EndpointConfig{
		Method: "DELETE",
		Path:   "/api/v1/workspaces/{workspace_id}",
	}

	unrelatedEp := swagger.EndpointConfig{
		Method: "GET",
		Path:   "/api/v1/health",
	}

	postResp := []byte(`{"id": "ws_12345", "name": "Alice Workspace", "created_by": "user_a"}`)
	harvester.RecordCreation(postEp, postResp, 201, "UserA")

	resources := harvester.GetHarvestedResources()
	require.Len(t, resources, 1)
	assert.Equal(t, "ws_12345", resources[0].ID)
	assert.Equal(t, "/api/v1/workspaces", resources[0].PathPrefix)
	assert.Equal(t, "UserA", resources[0].CreatorIdentity)

	// Build cross-identity candidates for UserB and Anonymous
	candidates := harvester.BuildCrossIdentityCandidates(
		[]swagger.EndpointConfig{getEp, deleteEp, unrelatedEp},
		[]string{"UserA", "UserB"},
	)

	// For 1 harvested ID, matching 2 endpoints (GET & DELETE), probed against UserB and Anonymous (UserA excluded)
	// Total candidates = 2 endpoints * 2 probe identities = 4
	require.Len(t, candidates, 4)

	var resolvedPaths []string
	var probeIdentities []string
	for _, c := range candidates {
		resolvedPaths = append(resolvedPaths, c.ResolvedPath)
		probeIdentities = append(probeIdentities, c.ProbeIdentity)
		assert.Equal(t, "ws_12345", c.HarvestedID)
		assert.Equal(t, "UserA", c.CreatorIdentity)
		assert.NotEqual(t, "UserA", c.ProbeIdentity)
	}

	assert.Contains(t, resolvedPaths, "/api/v1/workspaces/ws_12345")
	assert.Contains(t, probeIdentities, "UserB")
	assert.Contains(t, probeIdentities, "Anonymous")
}

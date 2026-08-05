// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package main

import (
	"context"
	"encoding/json"
	"os"
	"strings"
	"swazz-engine/internal/graphql"
	"swazz-engine/internal/security"
	"swazz-engine/internal/swagger"
	"time"
)

func fetchSpec(urlStr string, headers map[string]string, allowPrivate bool) (json.RawMessage, error) {
	if !strings.HasPrefix(urlStr, "http://") && !strings.HasPrefix(urlStr, "https://") {
		return os.ReadFile(urlStr) // #nosec G304 -- path is a CLI-supplied swagger spec path, not attacker-controlled
	}

	client := security.NewSSRFProtectedClient(30*time.Second, allowPrivate)
	return swagger.FetchRemoteSpec(context.Background(), client, urlStr, headers, graphql.IntrospectionQuery)
}

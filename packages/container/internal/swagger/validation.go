// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package swagger

import (
	"fmt"
	"net/url"
)

// Validate checks settings fields for sanity.
func (s *Settings) Validate() error {
	if s.Concurrency < 0 {
		return fmt.Errorf("concurrency must be greater than or equal to 0")
	}
	if s.TimeoutMs < 0 {
		return fmt.Errorf("timeout_ms must be greater than or equal to 0")
	}
	if s.MaxNodesBudget <= 0 {
		s.MaxNodesBudget = 50000
	}
	if s.MaxDepthLimit <= 0 {
		s.MaxDepthLimit = 64
	}
	for _, profile := range s.Profiles {
		if profile != ProfileRandom && profile != ProfileBoundary && profile != ProfileMalicious {
			return fmt.Errorf("invalid profile: %q (must be RANDOM, BOUNDARY, or MALICIOUS)", profile)
		}
	}
	return nil
}

// Validate checks the full configuration for sanity.
func (c *Config) Validate() error {
	if err := c.Settings.Validate(); err != nil {
		return err
	}
	if err := ValidateBaseURL(c.BaseURL); err != nil {
		return err
	}
	return nil
}

// ValidateBaseURL ensures the base URL is valid and has http/https scheme if present.
func ValidateBaseURL(baseURL string) error {
	if baseURL != "" {
		u, err := url.Parse(baseURL)
		if err != nil {
			return fmt.Errorf("invalid base_url: %w", err)
		}
		if u.Scheme != "http" && u.Scheme != "https" {
			return fmt.Errorf("base_url must have a valid http or https scheme")
		}
	}
	return nil
}

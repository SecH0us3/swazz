// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package runner

import (
	"swazz-engine/internal/generator"
	"swazz-engine/internal/swagger"
)

const (
	defaultMaxPayloadBytes  = 10 << 20 // 10 MiB
	boundaryMaxPayloadBytes = 10 << 20 // 10 MiB
)

// getOrderedProfiles returns configured profiles with boundary testing last,
// ensuring cheap profiles run first so results arrive early.
func (r *Runner) getOrderedProfiles() []swagger.FuzzingProfile {
	var light, heavy []swagger.FuzzingProfile
	for _, p := range r.config.Settings.Profiles {
		if p == swagger.ProfileBoundary {
			heavy = append(heavy, p)
		} else {
			light = append(light, p)
		}
	}
	return append(light, heavy...)
}

// calcEffectiveIterations computes how many iterations to run for the given
// profile × endpoint combination, honouring the minimum iterations constraint.
func calcEffectiveIterations(
	profile swagger.FuzzingProfile,
	settings swagger.Settings,
	endpoint *swagger.EndpointConfig,
) int {
	minNeeded := generator.MinIterationsNeeded(profile, settings)
	n := settings.IterationsPerProfile
	if minNeeded > n {
		n = minNeeded
	}
	if hasFields(endpoint) {
		return n
	}
	// No fields: most profiles only need 1 iteration; malicious needs the
	// minimum (at least 1) to cover its header-fuzzing iterations.
	if profile == swagger.ProfileMalicious {
		if minNeeded < 1 {
			return 1
		}
		return minNeeded
	}
	return 1
}

// calcMaxPayloadSize returns the per-profile payload size ceiling in bytes.
// If settings.MaxPayloadSizeBytes is explicitly set (> 0), it is honored for all profiles.
// Otherwise, defaults to boundaryMaxPayloadBytes for BOUNDARY profile and defaultMaxPayloadBytes for others.
func calcMaxPayloadSize(profile swagger.FuzzingProfile, settings swagger.Settings) int {
	if settings.MaxPayloadSizeBytes > 0 {
		return settings.MaxPayloadSizeBytes
	}
	if profile == swagger.ProfileBoundary {
		return boundaryMaxPayloadBytes
	}
	return defaultMaxPayloadBytes
}

func endpointRequests(profile swagger.FuzzingProfile, settings swagger.Settings, ep *swagger.EndpointConfig) int {
	baseIter := calcEffectiveIterations(profile, settings, ep)
	if settings.ActiveParameterFuzzing {
		fields := collectTargetFields(ep)
		if len(fields) > 0 {
			return len(fields) * baseIter
		}
	}
	return baseIter
}

// calculateTotalPlanned pre-computes the total number of requests that will be
// sent during the run and stores it for progress reporting.
func (r *Runner) calculateTotalPlanned(profiles []swagger.FuzzingProfile) {
	settings := r.config.Settings
	endpoints := r.config.Endpoints
	var total int64

	// 1. Baseline: 1 request per endpoint.
	total += int64(len(endpoints))

	// 2. Fuzz profiles.
	for _, ep := range endpoints {
		for _, p := range profiles {
			total += int64(endpointRequests(p, settings, &ep))
		}
	}

	// 3. Rate-limit phase burst requests.
	if settings.RateLimitCheck {
		burst := settings.RateLimitBurstSize
		if burst <= 0 {
			burst = 50
		}
		if burst > 1000 {
			burst = 1000
		}
		total += int64(len(endpoints) * burst)
	}

	r.progress.totalPlanned.Store(total)

	totalEP := len(endpoints) + len(profiles)*len(endpoints)
	if settings.RateLimitCheck {
		totalEP += len(endpoints)
	}
	r.progress.totalEndpoints.Store(int32(totalEP)) // #nosec G115
}

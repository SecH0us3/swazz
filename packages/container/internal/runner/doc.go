// Package runner orchestrates fuzzing runs across endpoints × profiles × iterations.
//
// # Execution Phases
//
// A single call to [Runner.Start] runs four sequential phases:
//
//  1. Baseline — one safe request per endpoint; records size/latency medians.
//  2. Fuzzing  — N iterations × M profiles; concurrent goroutine dispatch.
//  3. BOLA     — replays harvested IDs with alternate user identities.
//  4. RateLimit — burst-probes each endpoint for rate-limit enforcement.
//
// # Struct Layout
//
// Runner is divided into embedded sub-structs that group related
// synchronisation primitives, making lock ownership obvious at a glance:
//
//   - [runnerLifecycle] — isRunning / isPaused / shouldStop atomics + cancel.
//   - [runnerProgress]  — currentEndpoint / currentProfile / counters (atomics).
//   - [runnerPause]     — pause/resume condvar, separate from the lifecycle mutex.
//
// # Concurrency Architecture
//
// The runner uses a channel-based stats aggregation pattern to eliminate
// mutex contention from the per-request hot path:
//
//   - Worker goroutines send [statsMsg] to a buffered statsChan.
//   - A single [Runner.statsAggregator] goroutine owns all mutable stats
//     data, accumulating results without any locks.
//   - Immutable stats snapshots are published via [atomic.Pointer] at
//     150 ms intervals and broadcast as SSE EventProgress events.
//   - Control-flow flags (isRunning, isPaused, shouldStop) use [atomic.Bool]
//     for zero-lock reads in the iteration loop.
//   - Pause/resume uses a dedicated pauseMu + [sync.Cond] ([runnerPause]),
//     decoupled from the stats path.
//
// The SSE event pipeline uses a lock-free [MPSCQueue] for broadcasting
// individual results to subscribers in real time.
//
// # Payload Construction
//
// All payload and header generation logic lives in [payload_builder.go]:
//
//   - [buildSafePayload] — deterministic valid payload for baselines and probes.
//   - [buildFuzzPayload] — fuzzed payload attempt for the iteration loop.
//   - [buildHeaders]     — generates header map from endpoint HeaderParams schema.
package runner

// Package runner orchestrates fuzzing runs across endpoints × profiles × iterations.
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
//     150ms intervals and broadcast as SSE EventProgress events.
//   - Control-flow flags (isRunning, isPaused, shouldStop) use [atomic.Bool]
//     for zero-lock reads in the iteration loop.
//   - Pause/resume uses a dedicated pauseMu + [sync.Cond], decoupled from
//     the stats path.
//
// The SSE event pipeline uses a lock-free [MPSCQueue] for broadcasting
// individual results to subscribers in real time.
package runner

package safenet

import (
	"log"
	"os"
	"strings"
)

const (
	dockerEnvFile = "/.dockerenv"
	cgroupFile    = "/proc/1/cgroup"
)

// containerIndicators are substrings in /proc/1/cgroup that indicate
// the process runs inside a container runtime.
var containerIndicators = []string{
	"docker",
	"containerd",
	"kubepods",
}

// IsRunningInContainer reports whether the current process appears to be
// running inside a container (Docker, containerd, or Kubernetes).
//
// Detection uses two heuristics:
//  1. Presence of /.dockerenv (created by Docker)
//  2. /proc/1/cgroup containing a known container runtime identifier
func IsRunningInContainer() bool {
	// Check 1: Docker creates this sentinel file in every container.
	if _, err := os.Stat(dockerEnvFile); err == nil {
		return true
	}

	// Check 2: cgroup entries will reference the container runtime.
	data, err := os.ReadFile(cgroupFile)
	if err != nil {
		return false
	}

	content := strings.ToLower(string(data))
	for _, indicator := range containerIndicators {
		if strings.Contains(content, indicator) {
			return true
		}
	}

	return false
}

// AssertRunningInContainer fatally terminates the process if it is NOT
// running inside a container. This MUST be called early in agent (run-agent)
// mode to enforce isolation in shared/cloud environments.
//
// In local CLI mode (swazz-engine start), this function is never called.
func AssertRunningInContainer() {
	if os.Getenv("SWAZZ_DEV") == "1" {
		log.Println("WARNING: Bypassing container check due to SWAZZ_DEV=1")
		return
	}
	if !IsRunningInContainer() {
		log.Fatal("FATAL: run-agent mode requires a container runtime (Docker, containerd, or Kubernetes).\n" +
			"       The runner is not inside a container. Use the official Docker image:\n" +
			"       docker run ghcr.io/sech0us3/swazz-runner run-agent --coordinator <url> --token <token>")
	}
}

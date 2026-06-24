package main

import (
	"fmt"
	"os"
	"sort"
	"strings"
	"swazz-engine/internal/classifier"
	"swazz-engine/internal/logger"
	"swazz-engine/internal/swagger"
	"time"
)

func printProgress(stats swagger.RunStats) {
	if logger.GetLevel() >= logger.LevelError {
		return
	}

	pct := 0
	if stats.TotalPlanned > 0 {
		pct = int(float64(stats.TotalRequests) / float64(stats.TotalPlanned) * 100)
	}

	ep := ""
	if stats.Progress.CurrentEndpoint != "" {
		iterInfo := ""
		if stats.Progress.TotalIterations > 0 {
			iterInfo = fmt.Sprintf(" \033[90m[test %d/%d]\033[0m", stats.Progress.CurrentIteration, stats.Progress.TotalIterations)
		}
		ep = fmt.Sprintf("\033[1;33m%s\033[0m (\033[1;35m%s\033[0m)%s", stats.Progress.CurrentEndpoint, stats.Progress.CurrentProfile, iterInfo)
	}

	// Calculate how many lines we will print
	linesToPrint := 3 // Header, Progress, Active
	var sortedProfiles []swagger.FuzzingProfile
	for p := range stats.StatusByProfile {
		sortedProfiles = append(sortedProfiles, p)
	}
	sort.Slice(sortedProfiles, func(i, j int) bool {
		return string(sortedProfiles[i]) < string(sortedProfiles[j])
	})
	// Add 1 line for each profile, or at least 1 for overall status if empty
	if len(sortedProfiles) == 0 {
		linesToPrint += 1
	} else {
		linesToPrint += len(sortedProfiles)
	}

	// ANSI clear up `numLinesPrinted` lines (if not first time)
	if numLinesPrinted > 0 {
		fmt.Fprintf(os.Stderr, "\033[%dA", numLinesPrinted)
	}

	fmt.Fprintf(os.Stderr, "⚡ \033[1;34mSWAZZ ENGINE\033[0m running...\033[K\r\n")
	fmt.Fprintf(os.Stderr, "🎯 \033[1mProgress:\033[0m [%d%%] %d/%d reqs | %.1f rps (concurrency: %d [+/- or Arrows to change])\033[K\r\n", pct, stats.TotalRequests, stats.TotalPlanned, stats.RequestsPerSec, stats.Concurrency)
	fmt.Fprintf(os.Stderr, "🌐 \033[1mActive:\033[0m   %s\033[K\r\n", ep)

	if len(sortedProfiles) == 0 {
		fmt.Fprintf(os.Stderr, "📊 \033[1mStatus:\033[0m   waiting...\033[K\r\n")
	} else {
		for _, p := range sortedProfiles {
			var parts []string
			var codes []int
			for code := range stats.StatusByProfile[p] {
				codes = append(codes, code)
			}
			sort.Ints(codes)

			for _, code := range codes {
				count := stats.StatusByProfile[p][code]
				var colorCode string
				if code >= 200 && code < 300 {
					colorCode = "35" // Purple
				} else if code >= 300 && code < 400 {
					colorCode = "90" // Gray
				} else if code >= 400 && code < 500 {
					colorCode = "33" // Orange/Yellow
				} else if code >= 500 {
					colorCode = "31" // Red
				} else {
					colorCode = "36" // Cyan default
				}

				parts = append(parts, fmt.Sprintf("\033[1;%sm%03d\033[0m: %-4d", colorCode, code, count))
			}
			statusStr := strings.Join(parts, "  ")
			if len(statusStr) > 200 { // Increased limit because of more ANSI characters
				statusStr = statusStr[:197] + "..."
			}
			fmt.Fprintf(os.Stderr, "📊 \033[1mStatus [%-10s]:\033[0m %s\033[K\r\n", p, statusStr)
		}
	}

	numLinesPrinted = linesToPrint
}

func printProgressClean(stats swagger.RunStats) {
	if logger.GetLevel() >= logger.LevelError {
		return
	}

	pct := 0
	if stats.TotalPlanned > 0 {
		pct = int(float64(stats.TotalRequests) / float64(stats.TotalPlanned) * 100)
	}

	ep := ""
	if stats.Progress.CurrentEndpoint != "" {
		iterInfo := ""
		if stats.Progress.TotalIterations > 0 {
			iterInfo = fmt.Sprintf(" [test %d/%d]", stats.Progress.CurrentIteration, stats.Progress.TotalIterations)
		}
		ep = fmt.Sprintf("%s (%s)%s", stats.Progress.CurrentEndpoint, stats.Progress.CurrentProfile, iterInfo)
	}

	if ep != "" {
		fmt.Fprintf(os.Stderr, "🎯 Progress: [%d%%] %d/%d reqs | %.1f rps | Active: %s\n", pct, stats.TotalRequests, stats.TotalPlanned, stats.RequestsPerSec, ep)
	} else {
		fmt.Fprintf(os.Stderr, "🎯 Progress: [%d%%] %d/%d reqs | %.1f rps\n", pct, stats.TotalRequests, stats.TotalPlanned, stats.RequestsPerSec)
	}
}

func printSummary(findings []*classifier.Finding, stats *swagger.RunStats) {
	if logger.GetLevel() >= logger.LevelError {
		return
	}

	if numLinesPrinted > 0 {
		// Clear lines downwards
		fmt.Fprintf(os.Stderr, "\033[%dA\033[0J", numLinesPrinted)
	}
	numLinesPrinted = 0

	sep := strings.Repeat("-", 60)
	fmt.Fprintln(os.Stderr, "\n"+sep)
	fmt.Fprintln(os.Stderr, "  swazz scan complete")
	fmt.Fprintln(os.Stderr, sep)
	fmt.Fprintf(os.Stderr, "  Total requests:  %d\n", stats.TotalRequests)

	duration := (time.Now().UnixMilli() - stats.StartTime) / 1000
	fmt.Fprintf(os.Stderr, "  Duration:        %ds\n", duration)
	fmt.Fprintf(os.Stderr, "  Avg RPS:         %.1f\n", stats.RequestsPerSec)

	fmt.Fprintln(os.Stderr, "\n  Status distribution:")
	var statCodes []int
	for code := range stats.StatusCounts {
		statCodes = append(statCodes, code)
	}
	sort.Ints(statCodes)
	for _, code := range statCodes {
		fmt.Fprintf(os.Stderr, "    %03d: %5d\n", code, stats.StatusCounts[code])
	}

	var errs, warns, notes int
	for _, f := range findings {
		switch f.Level {
		case classifier.SeverityError:
			errs++
		case classifier.SeverityWarning:
			warns++
		case classifier.SeverityNote:
			notes++
		}
	}

	fmt.Fprintf(os.Stderr, "\n  Findings: %d\n", len(findings))
	if len(findings) > 0 {
		if errs > 0 {
			fmt.Fprintf(os.Stderr, "    errors:   %d\n", errs)
		}
		if warns > 0 {
			fmt.Fprintf(os.Stderr, "    warnings: %d\n", warns)
		}
		if notes > 0 {
			fmt.Fprintf(os.Stderr, "    notes:    %d\n", notes)
		}

	}
	fmt.Fprintln(os.Stderr, "\n"+sep)
}

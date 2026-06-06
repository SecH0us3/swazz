package classifier

// SeverityRank returns the numeric rank of a severity level.
// Higher rank = more severe. error=3, warning=2, note=1, none/ignore/unknown=0.
func SeverityRank(level Severity) int {
	switch level {
	case SeverityError:
		return 3
	case SeverityWarning:
		return 2
	case SeverityNote:
		return 1
	default:
		return 0
	}
}

// FindingsExceedThreshold returns true if any finding in the slice
// has a severity level >= the given threshold.
// A threshold of "none" or empty string always returns false.
func FindingsExceedThreshold(findings []*Finding, threshold string) bool {
	if threshold == "" || threshold == "none" {
		return false
	}

	thresholdRank := SeverityRank(Severity(threshold))
	if thresholdRank == 0 {
		// Unknown threshold string — nothing can exceed it.
		return false
	}

	for _, f := range findings {
		if f == nil {
			continue
		}
		if SeverityRank(f.Level) >= thresholdRank {
			return true
		}
	}
	return false
}

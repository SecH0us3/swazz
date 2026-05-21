// Package payloads — category registry for dynamic UI catalog.
// Each profile exposes a list of named categories with their payload slices.
// The generator uses the enabled category IDs to filter which payloads to apply.
package payloads

// ─── Category IDs ──────────────────────────────────────────────────────────

// Boundary category IDs
const (
	CatBoundaryStrings  = "boundary_strings"
	CatBoundaryIntegers = "boundary_integers"
	CatBoundaryNumbers  = "boundary_numbers"
	CatBoundaryDates    = "boundary_dates"
	CatBoundaryBooleans = "boundary_booleans"
	CatBoundaryArrays   = "boundary_arrays"
	CatBoundaryUUIDs    = "boundary_uuids"
)

// Malicious category IDs
const (
	CatMaliciousSQLi          = "malicious_sqli"
	CatMaliciousXSS           = "malicious_xss"
	CatMaliciousPathTraversal = "malicious_path_traversal"
	CatMaliciousEncoding      = "malicious_encoding"
	CatMaliciousNumbers       = "malicious_numbers"
	CatMaliciousDates         = "malicious_dates"
	CatMaliciousBooleans      = "malicious_booleans"
	CatMaliciousTypeConfusion = "malicious_type_confusion"
)

// Random category IDs (single bucket for all random generators)
const (
	CatRandomValues = "random_values"
)

// ─── Exported sub-slices (same package — direct reference to private vars) ─

// These are the typed []any views used in BoundaryCategories / MaliciousCategories
// so the generator can filter by active category IDs.

var (
	MaliciousSQLi          = toAny(maliciousSQLi)
	MaliciousXSS           = toAny(maliciousXSS)
	MaliciousPathTraversal = toAny(maliciousPathTraversal)
	MaliciousEncoding      = toAny(maliciousEncoding)
)

func toAny[T any](in []T) []any {
	out := make([]any, len(in))
	for i, v := range in {
		out[i] = v
	}
	return out
}

// ─── Catalog entry helpers ─────────────────────────────────────────────────

// Category describes a payload category with its slice for count reporting.
type Category struct {
	ID          string
	Label       string
	Description string
	Items       []any
}

// BoundaryCategories lists all boundary categories in display order.
var BoundaryCategories = []Category{
	{ID: CatBoundaryStrings, Label: "Strings", Description: "Empty, whitespace, long strings, Unicode, megabyte payloads", Items: BoundaryStrings},
	{ID: CatBoundaryIntegers, Label: "Integers", Description: "Min/max int8–int64, overflow, JS safe integer limits", Items: BoundaryIntegers},
	{ID: CatBoundaryNumbers, Label: "Floats", Description: "NaN, ±Infinity, denormalized, max/min float64", Items: BoundaryNumbers},
	{ID: CatBoundaryDates, Label: "Dates", Description: "Epoch, Y2K38, far future, invalid leap-year dates", Items: BoundaryDates},
	{ID: CatBoundaryBooleans, Label: "Booleans", Description: "True/false, nil, string coercions (yes/no, 1/0)", Items: BoundaryBooleans},
	{ID: CatBoundaryArrays, Label: "Array Sizes", Description: "0, 1, 100, 10 000, 100 000 element arrays", Items: toAny(BoundaryArraySizes)},
	{ID: CatBoundaryUUIDs, Label: "UUIDs", Description: "Nil UUID, max UUID, invalid format, empty string", Items: BoundaryUUIDs},
}

// MaliciousCategories lists all malicious categories in display order.
var MaliciousCategories = []Category{
	{ID: CatMaliciousSQLi, Label: "SQL Injection", Description: "Classic SQLi, SLEEP, UNION, xp_cmdshell payloads", Items: MaliciousSQLi},
	{ID: CatMaliciousXSS, Label: "XSS", Description: "Script tags, event handlers, template injection, JS URIs", Items: MaliciousXSS},
	{ID: CatMaliciousPathTraversal, Label: "Path Traversal", Description: "Directory traversal, /etc/passwd, URL-encoded variants", Items: MaliciousPathTraversal},
	{ID: CatMaliciousEncoding, Label: "Encoding & Null Bytes", Description: "Null bytes, CRLF injection, zero-width chars, BOM, RTL override", Items: MaliciousEncoding},
	{ID: CatMaliciousNumbers, Label: "Number Abuse", Description: "NaN, ±Infinity, 1e500, hex/octal/binary strings, huge integers", Items: MaliciousNumbers},
	{ID: CatMaliciousDates, Label: "Date Abuse", Description: "Invalid dates, far-future, negative years, non-date strings", Items: MaliciousDates},
	{ID: CatMaliciousBooleans, Label: "Boolean Abuse", Description: "String coercions, null, empty, truthy/falsy edge cases", Items: MaliciousBooleans},
	{ID: CatMaliciousTypeConfusion, Label: "Type Confusion", Description: "Wrong types: nil, arrays, objects injected where scalars expected", Items: MaliciousTypeConfusion},
}

// RandomCategories lists all random categories.
var RandomCategories = []Category{
	{ID: CatRandomValues, Label: "Random Values", Description: "Format-aware random strings, numbers, UUIDs, emails, dates", Items: nil},
}

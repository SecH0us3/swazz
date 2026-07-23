package generator

import (
	"fmt"
	"math/rand/v2"
	"strings"
	"sync"

	"github.com/google/uuid"

	"swazz-engine/internal/generator/payloads"
	"swazz-engine/internal/oob"
	"swazz-engine/internal/sstistore"
	"swazz-engine/internal/swagger"
)

var maliciousStringCategories = []struct {
	category string
	slice    []any
}{
	{payloads.CatMaliciousEncoding, payloads.MaliciousEncoding},
	{payloads.CatMaliciousSQLi, payloads.MaliciousSQLi},
	{payloads.CatMaliciousXSS, payloads.MaliciousXSS},
	{payloads.CatMaliciousPathTraversal, payloads.MaliciousPathTraversal},
	{payloads.CatOOBInteraction, payloads.MaliciousOOB},
	{payloads.CatMaliciousCmdi, payloads.MaliciousCmdi},
	{payloads.CatMaliciousSSTI, payloads.MaliciousSSTI},
	{payloads.CatMaliciousXXE, payloads.MaliciousXXE},
}

// Generator produces fuzz payloads based on JSON Schema and a fuzzing profile.
type Generator struct {
	dictionaries map[string][]any
	profile      swagger.FuzzingProfile
	// activeCategories stores set of enabled category IDs for the current profile.
	// If nil, all categories are enabled.
	activeCategories map[string]bool

	// Sequential counters: BOUNDARY
	bStrIdx, bIntIdx, bNumIdx, bDateIdx, bArrIdx, bBoolIdx, bUUIDIdx int

	// Sequential counters: MALICIOUS
	mStrIdx, mNumIdx, mDateIdx, mBoolIdx, mTypeIdx, mUUIDIdx, oobIdx int

	// Sequential counter: security header rotation
	mu             sync.Mutex
	mSecHeaderIdxs map[string]int

	// cachedMaliciousStrings avoids allocations under high concurrency
	cachedMaliciousStrings []any
	// hasActiveMaliciousStrings tracks if any malicious string categories are enabled
	hasActiveMaliciousStrings bool

	oobServerURL string
	Endpoint     string
	RunID        string
	settings     swagger.Settings
}

// New creates a new Generator.
func New(dictionaries map[string][]any, profile swagger.FuzzingProfile, settings swagger.Settings) *Generator {
	norm := make(map[string][]any, len(dictionaries))
	for k, v := range dictionaries {
		norm[strings.ToLower(k)] = v
	}

	var active map[string]bool
	if settings.PayloadCategories != nil {
		if ids, ok := settings.PayloadCategories[profile]; ok && len(ids) > 0 {
			active = make(map[string]bool, len(ids))
			for _, id := range ids {
				active[id] = true
			}
		}
	}

	g := &Generator{
		dictionaries:     norm,
		profile:          profile,
		activeCategories: active,
		settings:         settings,
		oobServerURL:     settings.OOBServerURL,
		mSecHeaderIdxs:   make(map[string]int),
	}
	g.cachedMaliciousStrings, g.hasActiveMaliciousStrings = g.getActiveMaliciousStrings()
	return g
}

func (g *Generator) isCategoryEnabled(id string) bool {
	if g.activeCategories == nil {
		return true
	}
	return g.activeCategories[id]
}

func seqPick[T any](mu sync.Locker, arr []T, counter *int) T {
	mu.Lock()
	defer mu.Unlock()
	if len(arr) == 0 {
		var zero T
		return zero
	}
	val := arr[*counter%len(arr)]
	*counter++
	return val
}

func maxInt(nums ...int) int {
	m := 0
	for _, n := range nums {
		if n > m {
			m = n
		}
	}
	return m
}

// MinIterationsNeeded returns the minimum iterations required to cover all active payloads in a profile.
func MinIterationsNeeded(profile swagger.FuzzingProfile, settings swagger.Settings) int {
	var active map[string]bool
	if settings.PayloadCategories != nil {
		if ids, ok := settings.PayloadCategories[profile]; ok && len(ids) > 0 {
			active = make(map[string]bool, len(ids))
			for _, id := range ids {
				active[id] = true
			}
		}
	}

	is := func(id string) bool {
		if active == nil {
			return true
		}
		return active[id]
	}

	switch profile {
	case swagger.ProfileBoundary:
		max := 0
		if is(payloads.CatBoundaryStrings) && len(payloads.BoundaryStrings) > max {
			max = len(payloads.BoundaryStrings)
		}
		if is(payloads.CatBoundaryIntegers) && len(payloads.BoundaryIntegers) > max {
			max = len(payloads.BoundaryIntegers)
		}
		if is(payloads.CatBoundaryNumbers) && len(payloads.BoundaryNumbers) > max {
			max = len(payloads.BoundaryNumbers)
		}
		if is(payloads.CatBoundaryDates) && len(payloads.BoundaryDates) > max {
			max = len(payloads.BoundaryDates)
		}
		if is(payloads.CatBoundaryBooleans) && len(payloads.BoundaryBooleans) > max {
			max = len(payloads.BoundaryBooleans)
		}
		if is(payloads.CatBoundaryArrays) && len(payloads.BoundaryArraySizes) > max {
			max = len(payloads.BoundaryArraySizes)
		}
		if is(payloads.CatBoundaryUUIDs) && len(payloads.BoundaryUUIDs) > max {
			max = len(payloads.BoundaryUUIDs)
		}
		return max

	case swagger.ProfileMalicious:
		bodyCount := 0
		var maliciousBody []any
		if is(payloads.CatMaliciousEncoding) {
			maliciousBody = append(maliciousBody, payloads.MaliciousEncoding...)
		}
		if is(payloads.CatMaliciousSQLi) {
			maliciousBody = append(maliciousBody, payloads.MaliciousSQLi...)
		}
		if is(payloads.CatMaliciousXSS) {
			maliciousBody = append(maliciousBody, payloads.MaliciousXSS...)
		}
		if is(payloads.CatMaliciousPathTraversal) {
			maliciousBody = append(maliciousBody, payloads.MaliciousPathTraversal...)
		}
		if is(payloads.CatOOBInteraction) {
			maliciousBody = append(maliciousBody, payloads.MaliciousOOB...)
		}
		if is(payloads.CatMaliciousCmdi) {
			maliciousBody = append(maliciousBody, payloads.MaliciousCmdi...)
		}
		if is(payloads.CatMaliciousSSTI) {
			maliciousBody = append(maliciousBody, payloads.MaliciousSSTI...)
		}
		if is(payloads.CatMaliciousXXE) {
			maliciousBody = append(maliciousBody, payloads.MaliciousXXE...)
		}
		bodyCount = len(maliciousBody)
		if is(payloads.CatMaliciousNumbers) && len(payloads.MaliciousNumbers) > bodyCount {
			bodyCount = len(payloads.MaliciousNumbers)
		}
		if is(payloads.CatMaliciousDates) && len(payloads.MaliciousDates) > bodyCount {
			bodyCount = len(payloads.MaliciousDates)
		}
		if is(payloads.CatMaliciousBooleans) && len(payloads.MaliciousBooleans) > bodyCount {
			bodyCount = len(payloads.MaliciousBooleans)
		}
		if is(payloads.CatMaliciousTypeConfusion) && len(payloads.MaliciousTypeConfusion) > bodyCount {
			bodyCount = len(payloads.MaliciousTypeConfusion)
		}

		secHeaderCount := 0
		for _, def := range payloads.SecurityHeaderPayloads {
			if !is(def.Category) {
				continue
			}
			for _, values := range def.Headers {
				if len(values) > secHeaderCount {
					secHeaderCount = len(values)
				}
			}
		}

		return bodyCount + secHeaderCount
	default:
		return 0
	}
}

// Generate produces a value for a single property.
// Priority: enum → dictionary → format-aware → profile-based.
func (g *Generator) Generate(propertyName string, schema *swagger.SchemaProperty) any {
	// 1. Enum — respect explicit values, allow bypass in security profiles
	if len(schema.Enum) > 0 {
		shouldBypass := (g.profile == swagger.ProfileMalicious) && rand.Float64() < 0.3 // #nosec G404 -- non-security randomness for fuzzer
		if !shouldBypass {
			return payloads.Pick(schema.Enum)
		}
	}

	// 2. User dictionary
	normalizedName := strings.ToLower(propertyName)
	if vals, ok := g.dictionaries[normalizedName]; ok && len(vals) > 0 {
		return payloads.Pick(vals)
	}

	// 3. Profile-based generation
	return g.generateByProfile(schema.Type, schema.Format, propertyName)
}

// BuildObject recursively builds a full object from JSON Schema.
func (g *Generator) BuildObject(schema *swagger.SchemaProperty) map[string]any {
	if schema.Type != "object" || schema.Properties == nil {
		return map[string]any{}
	}

	if g.profile == swagger.ProfileRandom && rand.Float64() < 0.1 { // #nosec G404
		return map[string]any{}
	}

	payload := make(map[string]any, len(schema.Properties))

	for key, propSchema := range schema.Properties {
		isRequired := false
		for _, r := range schema.Required {
			if r == key {
				isRequired = true
				break
			}
		}

		// 30% chance to omit optional fields in MALICIOUS profile
		if !isRequired &&
			(g.profile == swagger.ProfileMalicious) &&
			rand.Float64() < 0.3 { // #nosec G404 -- non-security randomness for fuzzer
			continue
		}

		// 5% chance to omit REQUIRED fields in MALICIOUS profile
		if isRequired && g.profile == swagger.ProfileMalicious && rand.Float64() < 0.05 { // #nosec G404 -- non-security randomness for fuzzer
			continue
		}

		if propSchema.Type == "object" && propSchema.Properties != nil {
			payload[key] = g.BuildObject(propSchema)
		} else if propSchema.Type == "array" && propSchema.Items != nil {
			count := g.getArraySize(propSchema.Items)
			arr := make([]any, count)
			for i := range arr {
				if propSchema.Items.Type == "object" {
					arr[i] = g.BuildObject(propSchema.Items)
				} else {
					arr[i] = g.Generate(key, propSchema.Items)
				}
			}
			payload[key] = arr
		} else {
			payload[key] = g.Generate(key, propSchema)
		}
	}

	return payload
}

func (g *Generator) getArraySize(itemSchema *swagger.SchemaProperty) int {
	if g.profile == swagger.ProfileBoundary && g.isCategoryEnabled(payloads.CatBoundaryArrays) {
		size := seqPick(&g.mu, payloads.BoundaryArraySizes, &g.bArrIdx).(int)
		// Cap complex object arrays to prevent OOM
		if itemSchema != nil && itemSchema.Type == "object" {
			if size > 50 {
				return 50
			}
		}
		return size
	}
	return payloads.IntRange(1, 5)
}

func (g *Generator) generateByProfile(typ, format, propName string) any {
	// MALICIOUS: Type confusion check
	if g.profile == swagger.ProfileMalicious && g.isCategoryEnabled(payloads.CatMaliciousTypeConfusion) {
		if rand.Float64() < 0.05 { // #nosec G404 -- non-security randomness for fuzzer
			return seqPick(&g.mu, payloads.MaliciousTypeConfusion, &g.mTypeIdx)
		}
	}

	formatLower := strings.ToLower(format)

	// Handle format-specific date-time/uuid before generic string
	if typ == "string" {
		if formatLower == "date-time" {
			return g.generateDate()
		}
		if formatLower == "uuid" {
			return g.generateUUID()
		}
	}

	switch typ {
	case "string":
		return g.generateString(formatLower, propName)
	case "integer", "number":
		return g.generateNumber(typ)
	case "boolean":
		return g.generateBoolean()
	default:
		return g.fallbackRandom(propName)
	}
}

func (g *Generator) generateString(format, propName string) any {
	if g.profile == swagger.ProfileRandom {
		return g.fallbackRandom(propName)
	}

	if format == "uuid" {
		return g.generateUUID()
	}

	switch g.profile {
	case swagger.ProfileBoundary:
		if g.isCategoryEnabled(payloads.CatBoundaryStrings) {
			return seqPick(&g.mu, payloads.BoundaryStrings, &g.bStrIdx)
		}
	case swagger.ProfileMalicious:
		if g.hasActiveMaliciousStrings {
			val := seqPick(&g.mu, g.cachedMaliciousStrings, &g.mStrIdx)
			if strVal, ok := val.(string); ok {
				if strings.Contains(strVal, "{{OOB_URL}}") {
					u := uuid.New().String()
					url := g.oobURL(u)

					endpoint := g.Endpoint
					if endpoint == "" {
						endpoint = "Generated by Fuzzer"
					}
					// Register with global store
					oob.GlobalStore.RegisterUUID(u, &oob.OOBContext{
						SessionID: g.RunID,
						Endpoint:  endpoint,
						Payload:   strVal,
					})

					strVal = strings.ReplaceAll(strVal, "{{OOB_URL}}", url)
				}
				if strings.Contains(strVal, "7*7") || strings.Contains(strVal, "7+'7'") {
					strVal = g.randomizeAndRegisterSSTI(strVal)
				}
				if g.settings.SemanticMutationEnabled() && format != "" {
					return g.GenerateSemanticValue(format, strVal)
				}
				return strVal
			}
			return val
		}
	}

	res := g.fallbackRandom(propName)
	if strRes, ok := res.(string); ok && g.settings.SemanticMutationEnabled() && format != "" {
		return g.GenerateSemanticValue(format, strRes)
	}
	return res
}

func (g *Generator) getActiveMaliciousStrings() ([]any, bool) {
	var all []any
	hasAny := false
	for _, item := range maliciousStringCategories {
		if g.isCategoryEnabled(item.category) {
			all = append(all, item.slice...)
			hasAny = true
		}
	}
	if len(all) == 0 {
		return []any{payloads.Word()}, false
	}
	return all, hasAny
}

func (g *Generator) generateNumber(typ string) any {
	switch g.profile {
	case swagger.ProfileBoundary:
		if typ == "integer" {
			if g.isCategoryEnabled(payloads.CatBoundaryIntegers) {
				return seqPick(&g.mu, payloads.BoundaryIntegers, &g.bIntIdx)
			}
		} else {
			if g.isCategoryEnabled(payloads.CatBoundaryNumbers) {
				// Merged integers + numbers for float types
				merged := append([]any{}, payloads.BoundaryIntegers...)
				merged = append(merged, payloads.BoundaryNumbers...)
				return seqPick(&g.mu, merged, &g.bNumIdx)
			}
		}
	case swagger.ProfileMalicious:
		if g.isCategoryEnabled(payloads.CatMaliciousNumbers) {
			return seqPick(&g.mu, payloads.MaliciousNumbers, &g.mNumIdx)
		}
	}

	// Default/Fallback
	if typ == "integer" {
		return payloads.IntRange(1, 1000)
	}
	return payloads.FloatRange(0, 1000)
}

func (g *Generator) generateBoolean() any {
	switch g.profile {
	case swagger.ProfileBoundary:
		if g.isCategoryEnabled(payloads.CatBoundaryBooleans) {
			return seqPick(&g.mu, payloads.BoundaryBooleans, &g.bBoolIdx)
		}
	case swagger.ProfileMalicious:
		if g.isCategoryEnabled(payloads.CatMaliciousBooleans) {
			return seqPick(&g.mu, payloads.MaliciousBooleans, &g.mBoolIdx)
		}
	}
	return rand.Float64() < 0.5 // #nosec G404 -- non-security randomness for fuzzer
}

func (g *Generator) generateDate() any {
	switch g.profile {
	case swagger.ProfileBoundary:
		if g.isCategoryEnabled(payloads.CatBoundaryDates) {
			return seqPick(&g.mu, payloads.BoundaryDates, &g.bDateIdx)
		}
	case swagger.ProfileMalicious:
		if g.isCategoryEnabled(payloads.CatMaliciousDates) {
			return seqPick(&g.mu, payloads.MaliciousDates, &g.mDateIdx)
		}
	}
	return payloads.RandomDate().Format("2006-01-02T15:04:05.000Z")
}

func (g *Generator) generateUUID() any {
	switch g.profile {
	case swagger.ProfileMalicious:
		// Use boundary UUIDs occasionally for "malicious" uuid testing
		if rand.Float64() < 0.1 { // #nosec G404 -- non-security randomness for fuzzer
			return seqPick(&g.mu, payloads.BoundaryUUIDs, &g.mUUIDIdx)
		}
	case swagger.ProfileBoundary:
		if g.isCategoryEnabled(payloads.CatBoundaryUUIDs) {
			// Occasionally test boundary UUIDs
			if rand.Float64() < 0.2 { // #nosec G404 -- non-security randomness for fuzzer
				return seqPick(&g.mu, payloads.BoundaryUUIDs, &g.bUUIDIdx)
			}
		}
	}
	return payloads.UUID()
}

func (g *Generator) fallbackRandom(propName string) any {
	if propName != "" {
		lower := strings.ToLower(propName)
		if strings.Contains(lower, "email") {
			return payloads.Email()
		}
		if strings.Contains(lower, "id") || strings.Contains(lower, "uuid") {
			return payloads.UUID()
		}
		if strings.Contains(lower, "slug") || strings.Contains(lower, "name") {
			return payloads.Word()
		}
		if strings.Contains(lower, "num") || strings.Contains(lower, "count") || strings.Contains(lower, "page") {
			return payloads.IntRange(1, 100)
		}
	}
	return payloads.RandomString(payloads.IntRange(3, 10))
}

// GenerateSecurityHeaders returns a map of header name → fuzz value for
// security-critical HTTP headers not defined in the API spec.
// Only active during MALICIOUS profile. Returns nil for other profiles.
func (g *Generator) GenerateSecurityHeaders() map[string]string {
	if g.profile != swagger.ProfileMalicious {
		return nil
	}

	g.mu.Lock()
	defer g.mu.Unlock()

	if g.mSecHeaderIdxs == nil {
		g.mSecHeaderIdxs = make(map[string]int)
	}

	headers := make(map[string]string)
	for _, def := range payloads.SecurityHeaderPayloads {
		if !g.isCategoryEnabled(def.Category) {
			continue
		}
		for headerName, values := range def.Headers {
			if len(values) == 0 {
				continue
			}
			idx := g.mSecHeaderIdxs[headerName]
			val := values[idx%len(values)]

			if strings.Contains(val, "{{OOB_URL}}") {
				u := uuid.New().String()
				url := g.oobURL(u)

				endpoint := "Header: " + headerName
				if g.Endpoint != "" {
					endpoint = fmt.Sprintf("%s (Header: %s)", g.Endpoint, headerName)
				}
				oob.GlobalStore.RegisterUUID(u, &oob.OOBContext{
					SessionID: g.RunID,
					Endpoint:  endpoint,
					Payload:   val,
				})
				val = strings.ReplaceAll(val, "{{OOB_URL}}", url)
			}

			headers[headerName] = val
			g.mSecHeaderIdxs[headerName] = idx + 1
		}
	}

	if len(headers) == 0 {
		return nil
	}
	return headers
}

// BodyIterations returns the number of iterations needed for body fuzzing.
func (g *Generator) BodyIterations() int {
	if g.profile != swagger.ProfileMalicious {
		return 0
	}
	is := g.isCategoryEnabled
	bodyCount := 0
	var maliciousBody []any
	if is(payloads.CatMaliciousEncoding) {
		maliciousBody = append(maliciousBody, payloads.MaliciousEncoding...)
	}
	if is(payloads.CatMaliciousSQLi) {
		maliciousBody = append(maliciousBody, payloads.MaliciousSQLi...)
	}
	if is(payloads.CatMaliciousXSS) {
		maliciousBody = append(maliciousBody, payloads.MaliciousXSS...)
	}
	if is(payloads.CatMaliciousPathTraversal) {
		maliciousBody = append(maliciousBody, payloads.MaliciousPathTraversal...)
	}
	if is(payloads.CatMaliciousCmdi) {
		maliciousBody = append(maliciousBody, payloads.MaliciousCmdi...)
	}
	if is(payloads.CatMaliciousSSTI) {
		maliciousBody = append(maliciousBody, payloads.MaliciousSSTI...)
	}
	if is(payloads.CatMaliciousXXE) {
		maliciousBody = append(maliciousBody, payloads.MaliciousXXE...)
	}
	if is(payloads.CatOOBInteraction) {
		maliciousBody = append(maliciousBody, payloads.MaliciousOOB...)
	}
	bodyCount = len(maliciousBody)
	if is(payloads.CatMaliciousNumbers) && len(payloads.MaliciousNumbers) > bodyCount {
		bodyCount = len(payloads.MaliciousNumbers)
	}
	if is(payloads.CatMaliciousDates) && len(payloads.MaliciousDates) > bodyCount {
		bodyCount = len(payloads.MaliciousDates)
	}
	if is(payloads.CatMaliciousBooleans) && len(payloads.MaliciousBooleans) > bodyCount {
		bodyCount = len(payloads.MaliciousBooleans)
	}
	if is(payloads.CatMaliciousTypeConfusion) && len(payloads.MaliciousTypeConfusion) > bodyCount {
		bodyCount = len(payloads.MaliciousTypeConfusion)
	}
	return bodyCount
}

// SecurityHeaderIterations returns the number of iterations needed for security header fuzzing.
func (g *Generator) SecurityHeaderIterations() int {
	if g.profile != swagger.ProfileMalicious {
		return 0
	}
	secHeaderCount := 0
	is := g.isCategoryEnabled
	for _, def := range payloads.SecurityHeaderPayloads {
		if !is(def.Category) {
			continue
		}
		for _, values := range def.Headers {
			if len(values) > secHeaderCount {
				secHeaderCount = len(values)
			}
		}
	}
	return secHeaderCount
}

func (g *Generator) oobURL(uuidStr string) string {
	baseURL := g.oobServerURL
	if baseURL == "" {
		baseURL = "http://localhost:8080/api/oob"
	} else {
		if !strings.HasPrefix(baseURL, "http://") && !strings.HasPrefix(baseURL, "https://") {
			baseURL = "http://" + baseURL
		}
		if !strings.Contains(baseURL, "/api/oob") {
			baseURL = strings.TrimRight(baseURL, "/") + "/api/oob"
		}
	}
	if g.RunID != "" {
		return fmt.Sprintf("%s/%s/%s", strings.TrimRight(baseURL, "/"), g.RunID, uuidStr)
	}
	return fmt.Sprintf("%s/%s", strings.TrimRight(baseURL, "/"), uuidStr)
}

var sstiPrimes = []int{11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53, 59, 61, 67, 71, 73, 79, 83, 89, 97}

func (g *Generator) randomizeAndRegisterSSTI(s string) string {
	p1 := sstiPrimes[rand.IntN(len(sstiPrimes))] // #nosec G404 -- fuzzer payload generation, crypto/rand not needed
	p2 := sstiPrimes[rand.IntN(len(sstiPrimes))] // #nosec G404 -- fuzzer payload generation, crypto/rand not needed
	for p1 == p2 {
		p2 = sstiPrimes[rand.IntN(len(sstiPrimes))] // #nosec G404 -- fuzzer payload generation, crypto/rand not needed
	}

	var rawExpr string
	var expected string

	if strings.Contains(s, "7*7") {
		if rand.Float64() < 0.5 { // #nosec G404 -- fuzzer payload generation, crypto/rand not needed
			rawExpr = fmt.Sprintf("%d*%d", p1, p2)
			expected = fmt.Sprintf("%d", p1*p2)
		} else {
			rawExpr = fmt.Sprintf("%d+%d", p1, p2)
			expected = fmt.Sprintf("%d", p1+p2)
		}
		newS := strings.ReplaceAll(s, "7*7", rawExpr)
		sstistore.GlobalStore.Register(newS, sstistore.SSTIContext{
			RawExpr:  rawExpr,
			Expected: expected,
		})
		return newS
	} else if strings.Contains(s, "7+'7'") {
		rawExpr = fmt.Sprintf("%d+'%d'", p1, p2)
		expected = fmt.Sprintf("%d%d", p1, p2)
		newS := strings.ReplaceAll(s, "7+'7'", rawExpr)
		sstistore.GlobalStore.Register(newS, sstistore.SSTIContext{
			RawExpr:  rawExpr,
			Expected: expected,
		})
		return newS
	}
	return s
}

// GenerateSemanticValue returns a semantic format-wrapped payload for a given vector.
func (g *Generator) GenerateSemanticValue(format string, vector string) string {
	var variants []string
	switch strings.ToLower(format) {
	case "email":
		variants = WrapEmail(vector)
	case "date", "date-time":
		variants = WrapDateTime(vector)
	case "uri", "url":
		variants = WrapURL(vector)
	case "uuid":
		variants = WrapUUID(vector)
	case "phone", "tel":
		variants = WrapPhone(vector)
	default:
		return vector
	}

	if len(variants) == 0 {
		return vector
	}
	return variants[rand.IntN(len(variants))] // #nosec G404 -- fuzzer payload rotation
}



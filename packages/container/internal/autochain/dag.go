// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package autochain

import (
	"encoding/json"
	"net/url"
	"sort"
	"strings"
	"unicode"

	"swazz-engine/internal/swagger"
)

// ParamLocation identifies where a consumer parameter lives on a request.
type ParamLocation string

const (
	LocPath   ParamLocation = "path"
	LocQuery  ParamLocation = "query"
	LocHeader ParamLocation = "header"
	LocBody   ParamLocation = "body"
)

// EdgeSource records why a dependency edge was inferred.
type EdgeSource string

const (
	SourceManual    EdgeSource = "manual"
	SourceLink      EdgeSource = "openapi_link"
	SourceHeuristic EdgeSource = "heuristic"
)

// ParamBinding binds one consumer request parameter to a canonical Pool key.
type ParamBinding struct {
	PoolKey      string
	Location     ParamLocation
	ParamPath    []string
	TargetSchema *swagger.SchemaProperty
	Source       EdgeSource
	PrimaryProd  int // Index into Plan.Ordered of primary POST producer (-1 if none)
}

// ProducerRule describes what values an endpoint produces into the Pool on 2xx.
type ProducerRule struct {
	PoolKey      string
	ResponseExpr string // JSON dot path (e.g. "data.token"), "$header.Location", or "" for heuristic ID/Location scan
}

// Plan is the immutable static DAG schedule computed at run initialisation.
type Plan struct {
	Ordered    []swagger.EndpointConfig
	Waves      [][]int
	DeleteWave int
	Bindings   [][]ParamBinding
	Producers  [][]ProducerRule
	EdgeCount  int
}

var genericFieldDenylist = map[string]bool{
	"status": true, "state": true, "type": true, "kind": true, "mode": true,
	"name": true, "title": true, "label": true, "description": true,
	"message": true, "error": true, "code": true, "page": true, "per_page": true,
	"limit": true, "offset": true, "cursor": true, "sort": true, "order": true,
	"count": true, "total": true, "size": true, "created_at": true,
	"updated_at": true, "deleted_at": true, "timestamp": true,
	"enabled": true, "active": true, "version": true, "format": true,
	"lang": true, "locale": true,
}

// IdentityPlan builds a single-wave pass-through Plan when auto-chaining is disabled.
func IdentityPlan(endpoints []swagger.EndpointConfig) *Plan {
	ordered := make([]swagger.EndpointConfig, len(endpoints))
	copy(ordered, endpoints)
	var waves [][]int
	if len(ordered) > 0 {
		w := make([]int, len(ordered))
		for i := range ordered {
			w[i] = i
		}
		waves = [][]int{w}
	}
	return &Plan{
		Ordered:    ordered,
		Waves:      waves,
		DeleteWave: -1,
		Bindings:   make([][]ParamBinding, len(ordered)),
		Producers:  make([][]ProducerRule, len(ordered)),
	}
}

func isHTTPEndpoint(ep swagger.EndpointConfig, baseURL string) bool {
	if swagger.IsMCPServerEndpoint(ep.Method, ep.Path) || swagger.IsWebMCPEndpoint(ep.Path) {
		return false
	}
	m := strings.ToUpper(ep.Method)
	if m == "GRPC" || m == "WS" {
		return false
	}
	lowerBase := strings.ToLower(baseURL)
	for _, prefix := range []string{"grpc://", "grpcs://", "ws://", "wss://"} {
		if strings.HasPrefix(lowerBase, prefix) {
			return false
		}
	}
	return true
}

type resourceInfo struct {
	key         string // e.g. "res:orders:id"
	singular    string // e.g. "order"
	postProds   []int
	getProds    []int
	prefixParts []string // static chain e.g. ["orders"] or ["orgs", "projects"]
}

type rawBinding struct {
	poolKey      string
	loc          ParamLocation
	paramPath    []string
	schema       *swagger.SchemaProperty
	source       EdgeSource
	origProdIdxs []int
	primaryOrig  int
}

// BuildPlan computes the static producer->consumer DAG, breaks cycles deterministically,
// isolates HTTP DELETE endpoints into a final child-first teardown wave, and remaps indices.
func BuildPlan(endpoints []swagger.EndpointConfig, rules []swagger.ChainingRule, baseURL string) *Plan {
	n := len(endpoints)
	if n == 0 {
		return &Plan{DeleteWave: -1}
	}

	httpMask := make([]bool, n)
	deleteMask := make([]bool, n)
	for i, ep := range endpoints {
		httpMask[i] = isHTTPEndpoint(ep, baseURL)
		if httpMask[i] && strings.EqualFold(ep.Method, "DELETE") {
			deleteMask[i] = true
		}
	}

	producers := make([][]ProducerRule, n)
	rawBinds := make([][]rawBinding, n)
	boundSet := make([]map[string]bool, n)
	for i := range n {
		boundSet[i] = make(map[string]bool)
	}

	edges := make([]map[int]bool, n) // producer origIdx -> set of consumer origIdx
	for i := range n {
		edges[i] = make(map[int]bool)
	}
	addEdge := func(prod, cons int) {
		if prod == cons || prod < 0 || cons < 0 || deleteMask[prod] {
			return
		}
		edges[prod][cons] = true
	}
	addProducer := func(idx int, key, expr string) {
		for _, p := range producers[idx] {
			if p.PoolKey == key && p.ResponseExpr == expr {
				return
			}
		}
		producers[idx] = append(producers[idx], ProducerRule{PoolKey: key, ResponseExpr: expr})
	}
	addBind := func(cons int, rb rawBinding) {
		slotKey := string(rb.loc) + ":" + strings.Join(rb.paramPath, ".")
		if boundSet[cons][slotKey] {
			return
		}
		boundSet[cons][slotKey] = true
		rawBinds[cons] = append(rawBinds[cons], rb)
		for _, p := range rb.origProdIdxs {
			addEdge(p, cons)
		}
	}

	// Tier 1: Manual ChainingRules & ExtractVariables/ParamsMapping
	for _, cr := range rules {
		if cr.VariableName == "" || cr.SourceEndpoint == "" {
			continue
		}
		token := "{{" + cr.VariableName + "}}"
		var srcIdxs []int
		for i, ep := range endpoints {
			if ep.Path == cr.SourceEndpoint || (ep.Method+" "+ep.Path) == cr.SourceEndpoint {
				srcIdxs = append(srcIdxs, i)
			}
		}
		for i, ep := range endpoints {
			if endpointMentionsToken(ep, token) {
				for _, s := range srcIdxs {
					addEdge(s, i)
				}
			}
		}
	}
	varProducers := make(map[string][]int)
	for i, ep := range endpoints {
		for _, varName := range ep.ExtractVariables {
			varProducers[varName] = append(varProducers[varName], i)
		}
	}
	for i, ep := range endpoints {
		for paramName, varName := range ep.ParamsMapping {
			if srcs := varProducers[varName]; len(srcs) > 0 {
				slotKey := string(LocPath) + ":" + paramName
				boundSet[i][slotKey] = true
				for _, s := range srcs {
					addEdge(s, i)
				}
			}
		}
	}

	// Tier 2: OpenAPI 3 Links
	opIDIdx := make(map[string]int)
	pathMethodIdx := make(map[string]int)
	for i, ep := range endpoints {
		if ep.OperationID != "" {
			opIDIdx[ep.OperationID] = i
		}
		pathMethodIdx[strings.ToUpper(ep.Method)+" "+ep.Path] = i
	}
	for prodIdx, ep := range endpoints {
		if !httpMask[prodIdx] {
			continue
		}
		for _, link := range ep.Links {
			consIdx, ok := resolveLinkTarget(link, opIDIdx, pathMethodIdx)
			if !ok {
				continue
			}
			// Sort parameter keys so ProducerRule and ParamBinding slices are deterministic across runs.
			paramKeys := make([]string, 0, len(link.Parameters))
			for rawParam := range link.Parameters {
				paramKeys = append(paramKeys, rawParam)
			}
			sort.Strings(paramKeys)
			for _, rawParam := range paramKeys {
				runtimeExpr := link.Parameters[rawParam]
				loc, pName := parseLinkParamTarget(rawParam, endpoints[consIdx])
				poolKey := "link:" + ep.Method + ":" + ep.Path + ":" + pName
				respExpr := parseOpenAPIRuntimeExpr(runtimeExpr)
				addProducer(prodIdx, poolKey, respExpr)
				prim := -1
				if strings.EqualFold(ep.Method, "POST") {
					prim = prodIdx
				}
				addBind(consIdx, rawBinding{
					poolKey:      poolKey,
					loc:          loc,
					paramPath:    []string{pName},
					schema:       lookupParamSchema(endpoints[consIdx], loc, []string{pName}),
					source:       SourceLink,
					origProdIdxs: []int{prodIdx},
					primaryOrig:  prim,
				})
			}
		}
	}

	// Tier 3: REST Resource Path Hierarchy & ResponseSchema Field Matching
	resources := make(map[string]*resourceInfo)
	scalarFieldProds := make(map[string][]int) // canonical field name -> POST/PUT producer indices
	scalarPrimary := make(map[string]int)

	for i, ep := range endpoints {
		if !httpMask[i] || deleteMask[i] {
			continue
		}
		chain, endsWithParam := resourceChain(ep.Path)
		m := strings.ToUpper(ep.Method)
		if len(chain) > 0 && !endsWithParam && (m == "POST" || m == "GET") {
			rKey := "res:" + strings.Join(chain, "/") + ":id"
			ri, exists := resources[rKey]
			if !exists {
				ri = &resourceInfo{
					key:         rKey,
					singular:    singularize(chain[len(chain)-1]),
					prefixParts: chain,
				}
				resources[rKey] = ri
			}
			if m == "POST" {
				ri.postProds = append(ri.postProds, i)
			} else {
				ri.getProds = append(ri.getProds, i)
			}
			addProducer(i, rKey, "")
		}

		// Record non-denylisted scalar fields from ResponseSchema on creating/updating endpoints
		if (m == "POST" || m == "PUT") && ep.ResponseSchema != nil {
			lastResource := ""
			if len(chain) > 0 {
				lastResource = singularize(chain[len(chain)-1])
			}
			collectResponseScalars(ep.ResponseSchema, lastResource, func(canonName, jsonPath string) {
				fKey := "field:" + canonName
				addProducer(i, fKey, jsonPath)
				scalarFieldProds[canonName] = append(scalarFieldProds[canonName], i)
				if _, has := scalarPrimary[canonName]; !has && m == "POST" {
					scalarPrimary[canonName] = i
				}
			})
		}
	}

	// Index resources by singular name (prefer shallowest resource path when ambiguous)
	bySingular := make(map[string]*resourceInfo)
	resKeys := make([]string, 0, len(resources))
	for k := range resources {
		resKeys = append(resKeys, k)
	}
	sort.Strings(resKeys)
	for _, k := range resKeys {
		ri := resources[k]
		if cur, exists := bySingular[ri.singular]; !exists || len(ri.prefixParts) < len(cur.prefixParts) {
			bySingular[ri.singular] = ri
		}
	}

	// Bind consumer path/query/body parameters
	for consIdx, ep := range endpoints {
		if !httpMask[consIdx] {
			continue
		}
		// 1. Path segments: match resource prefix right before each {param}
		bindPathSegments(consIdx, ep, resources, bySingular, scalarFieldProds, scalarPrimary, addBind)

		// 2. Query parameters
		qNames := sortedSchemaKeys(ep.QueryParams)
		for _, qName := range qNames {
			bindFieldCandidate(consIdx, LocQuery, []string{qName}, ep.QueryParams[qName], bySingular, scalarFieldProds, scalarPrimary, addBind)
		}

		// 3. Body properties (up to depth 4)
		if !isNoBodyHTTP(ep.Method) && len(ep.Schema.Properties) > 0 {
			walkBodySchema(ep.Schema.Properties, nil, 0, func(path []string, prop *swagger.SchemaProperty) {
				bindFieldCandidate(consIdx, LocBody, path, prop, bySingular, scalarFieldProds, scalarPrimary, addBind)
			})
		}
	}

	// Partition non-DELETE vs DELETE and run Kahn's wave scheduling
	var activeNodes, deleteNodes []int
	for i := range n {
		if deleteMask[i] {
			deleteNodes = append(deleteNodes, i)
		} else {
			activeNodes = append(activeNodes, i)
		}
	}

	inDegree := make(map[int]int, len(activeNodes))
	adj := make(map[int][]int, len(activeNodes))
	totalEdges := 0
	for _, u := range activeNodes {
		inDegree[u] = 0
	}
	for _, u := range activeNodes {
		for v := range edges[u] {
			totalEdges++
			if deleteMask[v] {
				continue
			}
			adj[u] = append(adj[u], v)
			inDegree[v]++
		}
		sort.Ints(adj[u])
	}

	nodeCompare := func(a, b int) bool {
		// Non-HTTP endpoints stay early in original order
		if httpMask[a] != httpMask[b] {
			return !httpMask[a]
		}
		if !httpMask[a] {
			return a < b
		}
		ra, rb := methodRank(endpoints[a].Method), methodRank(endpoints[b].Method)
		if ra != rb {
			return ra < rb
		}
		da, db := pathDepth(endpoints[a].Path), pathDepth(endpoints[b].Path)
		if da != db {
			return da < db
		}
		if endpoints[a].Path != endpoints[b].Path {
			return endpoints[a].Path < endpoints[b].Path
		}
		return a < b
	}

	scheduled := make(map[int]bool, len(activeNodes))
	var origWaves [][]int

	for len(scheduled) < len(activeNodes) {
		var ready []int
		for _, u := range activeNodes {
			if !scheduled[u] && inDegree[u] <= 0 {
				ready = append(ready, u)
			}
		}
		if len(ready) == 0 {
			// Cycle detected: deterministically pick best candidate to break cycle
			best := -1
			for _, u := range activeNodes {
				if scheduled[u] {
					continue
				}
				if best == -1 || len(endpoints[u].PathParams) < len(endpoints[best].PathParams) ||
					(len(endpoints[u].PathParams) == len(endpoints[best].PathParams) && nodeCompare(u, best)) {
					best = u
				}
			}
			ready = []int{best}
		} else {
			sort.Slice(ready, func(i, j int) bool { return nodeCompare(ready[i], ready[j]) })
		}

		origWaves = append(origWaves, ready)
		for _, u := range ready {
			scheduled[u] = true
			for _, v := range adj[u] {
				inDegree[v]--
			}
		}
	}

	deleteWaveIdx := -1
	if len(deleteNodes) > 0 {
		sort.Slice(deleteNodes, func(i, j int) bool {
			da, db := pathDepth(endpoints[deleteNodes[i]].Path), pathDepth(endpoints[deleteNodes[j]].Path)
			if da != db {
				return da > db // Child resources delete BEFORE parent resources
			}
			if endpoints[deleteNodes[i]].Path != endpoints[deleteNodes[j]].Path {
				return endpoints[deleteNodes[i]].Path < endpoints[deleteNodes[j]].Path
			}
			return deleteNodes[i] < deleteNodes[j]
		})
		deleteWaveIdx = len(origWaves)
		origWaves = append(origWaves, deleteNodes)
	}

	// Flatten waves into Ordered and remap all indices
	ordered := make([]swagger.EndpointConfig, 0, n)
	origToNew := make([]int, n)
	waves := make([][]int, len(origWaves))
	for wIdx, w := range origWaves {
		newWave := make([]int, len(w))
		for j, origIdx := range w {
			newIdx := len(ordered)
			origToNew[origIdx] = newIdx
			newWave[j] = newIdx
			ordered = append(ordered, endpoints[origIdx])
		}
		waves[wIdx] = newWave
	}

	finalProducers := make([][]ProducerRule, n)
	finalBindings := make([][]ParamBinding, n)
	for origIdx := range n {
		newIdx := origToNew[origIdx]
		finalProducers[newIdx] = producers[origIdx]
		if len(rawBinds[origIdx]) > 0 {
			bs := make([]ParamBinding, len(rawBinds[origIdx]))
			for k, rb := range rawBinds[origIdx] {
				primNew := -1
				if rb.primaryOrig >= 0 {
					primNew = origToNew[rb.primaryOrig]
				}
				bs[k] = ParamBinding{
					PoolKey:      rb.poolKey,
					Location:     rb.loc,
					ParamPath:    rb.paramPath,
					TargetSchema: rb.schema,
					Source:       rb.source,
					PrimaryProd:  primNew,
				}
			}
			finalBindings[newIdx] = bs
		}
	}

	return &Plan{
		Ordered:    ordered,
		Waves:      waves,
		DeleteWave: deleteWaveIdx,
		Bindings:   finalBindings,
		Producers:  finalProducers,
		EdgeCount:  totalEdges,
	}
}

func bindPathSegments(
	consIdx int,
	ep swagger.EndpointConfig,
	resources map[string]*resourceInfo,
	bySingular map[string]*resourceInfo,
	scalarProds map[string][]int,
	scalarPrimary map[string]int,
	addBind func(int, rawBinding),
) {
	segs := strings.Split(strings.Trim(ep.Path, "/"), "/")
	var staticChain []string
	for _, seg := range segs {
		if seg == "" {
			continue
		}
		if strings.HasPrefix(seg, "{") && strings.HasSuffix(seg, "}") {
			pName := seg[1 : len(seg)-1]
			schema := lookupParamSchema(ep, LocPath, []string{pName})
			if len(staticChain) > 0 {
				rKey := "res:" + strings.Join(staticChain, "/") + ":id"
				if ri, ok := resources[rKey]; ok && isIDOrResourceParam(pName, ri.singular) {
					prods, prim := combineProds(ri.postProds, ri.getProds)
					addBind(consIdx, rawBinding{
						poolKey:      ri.key,
						loc:          LocPath,
						paramPath:    []string{pName},
						schema:       schema,
						source:       SourceHeuristic,
						origProdIdxs: prods,
						primaryOrig:  prim,
					})
					continue
				}
			}
			bindFieldCandidate(consIdx, LocPath, []string{pName}, schema, bySingular, scalarProds, scalarPrimary, addBind)
			continue
		}
		if !isVersionOrRootPrefix(seg) {
			staticChain = append(staticChain, strings.ToLower(seg))
		}
	}
}

func bindFieldCandidate(
	consIdx int,
	loc ParamLocation,
	paramPath []string,
	schema *swagger.SchemaProperty,
	bySingular map[string]*resourceInfo,
	scalarProds map[string][]int,
	scalarPrimary map[string]int,
	addBind func(int, rawBinding),
) {
	leaf := paramPath[len(paramPath)-1]
	canon := canonicalSnake(leaf)
	if canon == "" || genericFieldDenylist[canon] {
		return
	}
	// Check "<resource>_id" or "<resource>_uuid" foreign key
	for _, suffix := range []string{"_id", "_uuid"} {
		if strings.HasSuffix(canon, suffix) {
			resSing := singularize(strings.TrimSuffix(canon, suffix))
			if ri, ok := bySingular[resSing]; ok {
				prods, prim := combineProds(ri.postProds, ri.getProds)
				addBind(consIdx, rawBinding{
					poolKey:      ri.key,
					loc:          loc,
					paramPath:    paramPath,
					schema:       schema,
					source:       SourceHeuristic,
					origProdIdxs: prods,
					primaryOrig:  prim,
				})
				return
			}
		}
	}
	// Check exact non-denylisted ResponseSchema scalar match (e.g. invite_code, upload_token, org_slug)
	if prods := scalarProds[canon]; len(prods) > 0 {
		prim, ok := scalarPrimary[canon]
		if !ok {
			prim = -1
		}
		addBind(consIdx, rawBinding{
			poolKey:      "field:" + canon,
			loc:          loc,
			paramPath:    paramPath,
			schema:       schema,
			source:       SourceHeuristic,
			origProdIdxs: prods,
			primaryOrig:  prim,
		})
	}
}

func combineProds(posts, gets []int) ([]int, int) {
	out := make([]int, 0, len(posts)+len(gets))
	out = append(out, posts...)
	out = append(out, gets...)
	prim := -1
	if len(posts) > 0 {
		prim = posts[0]
	}
	return out, prim
}

func collectResponseScalars(s *swagger.SchemaProperty, singularRes string, emit func(canonName, jsonPath string)) {
	var walk func(prop *swagger.SchemaProperty, prefix []string, depth int)
	walk = func(prop *swagger.SchemaProperty, prefix []string, depth int) {
		if prop == nil || depth > 3 {
			return
		}
		if len(prop.Properties) > 0 {
			keys := sortedSchemaKeys(prop.Properties)
			for _, k := range keys {
				walk(prop.Properties[k], append(prefix, k), depth+1)
			}
			return
		}
		if len(prefix) == 0 || (prop.Type != "string" && prop.Type != "integer" && prop.Type != "number") {
			return
		}
		leaf := canonicalSnake(prefix[len(prefix)-1])
		if leaf == "" || leaf == "id" || leaf == "uuid" || genericFieldDenylist[leaf] {
			return
		}
		jsonPath := strings.Join(prefix, ".")
		emit(leaf, jsonPath)
		if singularRes != "" && !strings.HasPrefix(leaf, singularRes+"_") {
			emit(singularRes+"_"+leaf, jsonPath)
		}
	}
	walk(s, nil, 0)
}

func walkBodySchema(props map[string]*swagger.SchemaProperty, prefix []string, depth int, fn func([]string, *swagger.SchemaProperty)) {
	if depth > 4 {
		return
	}
	for _, k := range sortedSchemaKeys(props) {
		p := props[k]
		if p == nil {
			continue
		}
		nextPath := append(append([]string(nil), prefix...), k)
		if p.Type == "object" && len(p.Properties) > 0 {
			walkBodySchema(p.Properties, nextPath, depth+1, fn)
		} else {
			fn(nextPath, p)
		}
	}
}

func sortedSchemaKeys(m map[string]*swagger.SchemaProperty) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

func resourceChain(rawPath string) (chain []string, endsWithParam bool) {
	segs := strings.Split(strings.Trim(rawPath, "/"), "/")
	for i, seg := range segs {
		if seg == "" {
			continue
		}
		if strings.HasPrefix(seg, "{") && strings.HasSuffix(seg, "}") {
			if i == len(segs)-1 {
				endsWithParam = true
			}
			continue
		}
		if !isVersionOrRootPrefix(seg) {
			chain = append(chain, strings.ToLower(seg))
		}
	}
	return chain, endsWithParam
}

func isVersionOrRootPrefix(seg string) bool {
	s := strings.ToLower(seg)
	if s == "api" || s == "rest" {
		return true
	}
	if len(s) >= 2 && s[0] == 'v' {
		for i := 1; i < len(s); i++ {
			if s[i] < '0' || s[i] > '9' {
				return false
			}
		}
		return true
	}
	return false
}

func singularize(word string) string {
	w := strings.ToLower(word)
	switch {
	case strings.HasSuffix(w, "ies") && len(w) > 3:
		return w[:len(w)-3] + "y"
	case strings.HasSuffix(w, "ses") || strings.HasSuffix(w, "xes") || strings.HasSuffix(w, "zes"):
		return w[:len(w)-2]
	case strings.HasSuffix(w, "s") && !strings.HasSuffix(w, "ss") && len(w) > 1:
		return w[:len(w)-1]
	default:
		return w
	}
}

func canonicalSnake(s string) string {
	var b strings.Builder
	runes := []rune(s)
	for i, r := range runes {
		if r == '-' || r == '.' || r == ' ' {
			b.WriteByte('_')
			continue
		}
		if unicode.IsUpper(r) {
			if i > 0 && runes[i-1] != '_' && runes[i-1] != '-' &&
				(unicode.IsLower(runes[i-1]) || (i+1 < len(runes) && unicode.IsLower(runes[i+1]))) {
				b.WriteByte('_')
			}
			b.WriteRune(unicode.ToLower(r))
			continue
		}
		b.WriteRune(unicode.ToLower(r))
	}
	return strings.Trim(b.String(), "_")
}

func isIDOrResourceParam(paramName, singular string) bool {
	c := canonicalSnake(paramName)
	return c == "id" || c == "uuid" || c == singular+"_id" || c == singular+"_uuid" || strings.HasSuffix(c, "_id")
}

func endpointMentionsToken(ep swagger.EndpointConfig, token string) bool {
	if strings.Contains(ep.Path, token) {
		return true
	}
	if ep.Example != nil {
		if b, err := json.Marshal(ep.Example); err == nil && strings.Contains(string(b), token) {
			return true
		}
	}
	return false
}

func resolveLinkTarget(link swagger.ResponseLink, opIDIdx, pathMethodIdx map[string]int) (int, bool) {
	if link.OperationID != "" {
		idx, ok := opIDIdx[link.OperationID]
		return idx, ok
	}
	if link.OperationRef != "" {
		u, err := url.Parse(link.OperationRef)
		if err == nil && strings.HasPrefix(u.Fragment, "/paths/") {
			rest := strings.TrimPrefix(u.Fragment, "/paths/")
			slash := strings.LastIndexByte(rest, '/')
			if slash > 0 {
				rawPath := strings.ReplaceAll(strings.ReplaceAll(rest[:slash], "~1", "/"), "~0", "~")
				method := strings.ToUpper(rest[slash+1:])
				idx, ok := pathMethodIdx[method+" "+rawPath]
				return idx, ok
			}
		}
	}
	return 0, false
}

func parseLinkParamTarget(raw string, cons swagger.EndpointConfig) (ParamLocation, string) {
	for _, p := range []struct {
		prefix string
		loc    ParamLocation
	}{
		{"path.", LocPath},
		{"query.", LocQuery},
		{"header.", LocHeader},
	} {
		if strings.HasPrefix(raw, p.prefix) {
			return p.loc, strings.TrimPrefix(raw, p.prefix)
		}
	}
	if cons.PathParams != nil && cons.PathParams[raw] != nil {
		return LocPath, raw
	}
	if cons.QueryParams != nil && cons.QueryParams[raw] != nil {
		return LocQuery, raw
	}
	if cons.HeaderParams != nil && cons.HeaderParams[raw] != nil {
		return LocHeader, raw
	}
	return LocBody, raw
}

func parseOpenAPIRuntimeExpr(expr string) string {
	if strings.HasPrefix(expr, "$response.body#/") {
		ptr := strings.TrimPrefix(expr, "$response.body#/")
		return strings.ReplaceAll(ptr, "/", ".")
	}
	if strings.HasPrefix(expr, "$response.header.") {
		return "$header." + strings.TrimPrefix(expr, "$response.header.")
	}
	return ""
}

func lookupParamSchema(ep swagger.EndpointConfig, loc ParamLocation, path []string) *swagger.SchemaProperty {
	if len(path) == 0 {
		return nil
	}
	switch loc {
	case LocPath:
		return ep.PathParams[path[0]]
	case LocQuery:
		return ep.QueryParams[path[0]]
	case LocHeader:
		return ep.HeaderParams[path[0]]
	case LocBody:
		curr := ep.Schema.Properties
		for i, k := range path {
			p := curr[k]
			if p == nil {
				return nil
			}
			if i == len(path)-1 {
				return p
			}
			curr = p.Properties
		}
	}
	return nil
}

func methodRank(m string) int {
	switch strings.ToUpper(m) {
	case "POST":
		return 0
	case "PUT":
		return 1
	case "GET":
		return 2
	case "PATCH":
		return 3
	default:
		return 4
	}
}

func pathDepth(p string) int {
	trimmed := strings.Trim(p, "/")
	if trimmed == "" {
		return 0
	}
	return strings.Count(trimmed, "/") + 1
}

func isNoBodyHTTP(method string) bool {
	m := strings.ToUpper(method)
	return m == "GET" || m == "HEAD" || m == "OPTIONS"
}

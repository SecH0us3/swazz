package bola

import (
	"context"
	"strings"
	"sync"

	"swazz-engine/internal/swagger"
)

func isNoBodyMethod(method string) bool {
	m := strings.ToUpper(method)
	return m == "GET" || m == "HEAD" || m == "OPTIONS" || m == "TRACE"
}

type RunnerContext interface {
	Config() *swagger.Config
	LogDebug(format string, args ...any)
	LogInfo(format string, args ...any)
	LogWarn(format string, args ...any)
	LogError(format string, args ...any)
	
	BroadcastProgress()
	BroadcastResult(res *swagger.FuzzResult)
	
	UpdateProgressProfile(profile string)
	UpdateProgressEndpoint(epKey string)
	AddTotalEndpoints(n int32)
	AddCompletedEndpoints(n int32)
	AddTotalPlanned(n int64)
	
	SendStat(res *swagger.FuzzResult, currentIteration, totalIterations int)
	
	RLockConfig()
	RUnlockConfig()
	LockConfig()
	UnlockConfig()
	
	LockResults()
	UnlockResults()
	
	ExecuteAuthSequence(ctx context.Context, seq []swagger.AuthStep, headers map[string]string, cookies map[string]string) (map[string]string, map[string]string, error)
	ExecuteRequest(ctx context.Context, baseURL, resolvedPath, epPath, method string,
		globalHeaders map[string]string, globalCookies map[string]string,
		body any, profile swagger.FuzzingProfile, queryParams map[string]any,
		headers map[string]string, contentType string) *swagger.FuzzResult
		
	SetLimiterTarget(concurrency int)
	LimiterAcquire(ctx context.Context) error
	LimiterRelease()
	
}

type Detector struct {
	ctx          RunnerContext
	harvestedIDs sync.Map // path prefix → []string
	idSources    sync.Map // ID string → source string
}

func NewDetector(ctx RunnerContext) *Detector {
	return &Detector{
		ctx: ctx,
	}
}

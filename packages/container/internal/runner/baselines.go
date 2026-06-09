package runner

import (
	"fmt"
	"sort"
	"strings"
	"sync"
)

type EndpointSizeBaseline struct {
	mu         sync.Mutex
	sizes      []int64
	medianSize int64
	calculated bool
}

func (b *EndpointSizeBaseline) addSize(size int64) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.sizes = append(b.sizes, size)
	b.calculated = false
}

func (b *EndpointSizeBaseline) getMedian() int64 {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.calculated {
		return b.medianSize
	}
	n := len(b.sizes)
	if n == 0 {
		b.medianSize = 0
		b.calculated = true
		return 0
	}

	temp := make([]int64, n)
	copy(temp, b.sizes)
	sort.Slice(temp, func(i, j int) bool { return temp[i] < temp[j] })

	if n%2 == 1 {
		b.medianSize = temp[n/2]
	} else {
		b.medianSize = (temp[n/2-1] + temp[n/2]) / 2
	}
	b.calculated = true
	return b.medianSize
}

func (r *Runner) recordSizeBaseline(method, path string, size int64) {
	key := fmt.Sprintf("%s %s", strings.ToUpper(method), path)
	val, ok := r.sizeBaselines.Load(key)
	if !ok {
		val, _ = r.sizeBaselines.LoadOrStore(key, &EndpointSizeBaseline{})
	}
	baseline := val.(*EndpointSizeBaseline)
	baseline.addSize(size)
}

func (r *Runner) getSizeBaselineMedian(method, path string) int64 {
	key := fmt.Sprintf("%s %s", strings.ToUpper(method), path)
	val, ok := r.sizeBaselines.Load(key)
	if !ok {
		return 0
	}
	return val.(*EndpointSizeBaseline).getMedian()
}

type EndpointTimeBaseline struct {
	mu         sync.Mutex
	times      []int64
	medianTime int64
	calculated bool
}

func (b *EndpointTimeBaseline) addTime(t int64) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.times = append(b.times, t)
	b.calculated = false
}

func (b *EndpointTimeBaseline) getMedian() int64 {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.calculated {
		return b.medianTime
	}
	n := len(b.times)
	if n == 0 {
		b.medianTime = 0
		b.calculated = true
		return 0
	}

	temp := make([]int64, n)
	copy(temp, b.times)
	sort.Slice(temp, func(i, j int) bool { return temp[i] < temp[j] })

	if n%2 == 1 {
		b.medianTime = temp[n/2]
	} else {
		b.medianTime = (temp[n/2-1] + temp[n/2]) / 2
	}
	b.calculated = true
	return b.medianTime
}

func (r *Runner) recordTimeBaseline(method, path string, t int64) {
	key := fmt.Sprintf("%s %s", strings.ToUpper(method), path)
	val, _ := r.timeBaselines.LoadOrStore(key, &EndpointTimeBaseline{})
	baseline := val.(*EndpointTimeBaseline)
	baseline.addTime(t)
}

func (r *Runner) getTimeBaselineMedian(method, path string) int64 {
	key := fmt.Sprintf("%s %s", strings.ToUpper(method), path)
	val, ok := r.timeBaselines.Load(key)
	if !ok {
		return 0
	}
	return val.(*EndpointTimeBaseline).getMedian()
}

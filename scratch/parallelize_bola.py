import sys

with open("/Users/alex/src/swazz/packages/container/internal/runner/bola.go", "r") as f:
    code = f.read()

# 1. Parallelize candidate construction
old_candidate_loop = """	// For endpoints that don't have a successful candidate, try to construct one
	safeGen := generator.New(r.config.Dictionaries, swagger.ProfileRandom, r.config.Settings)
	for _, ep := range r.config.Endpoints {"""

new_candidate_loop = """	// For endpoints that don't have a successful candidate, try to construct one
	safeGen := generator.New(r.config.Dictionaries, swagger.ProfileRandom, r.config.Settings)
	
	var candMu sync.Mutex
	var candWg sync.WaitGroup
	candSem := make(chan struct{}, r.config.Settings.Concurrency)
	if r.config.Settings.Concurrency == 0 {
		candSem = make(chan struct{}, 5)
	}

	for _, ep := range r.config.Endpoints {
		key := strings.ToUpper(ep.Method) + " " + ep.Path
		if hasSuccessCandidate[key] {
			continue
		}
		
		candWg.Add(1)
		candSem <- struct{}{}
		
		go func(ep swagger.EndpointConfig) {"""

code = code.replace(old_candidate_loop, new_candidate_loop, 1)

old_cand_end = """		if successRes != nil {
			successRes.Identity = "User A" // explicitly mark as User A
			candidates = append(candidates, successRes)

			// Broadcast event so it shows up in Request Logs under User A
			r.Broadcast(Event{
				Type: EventResult,
				Data: successRes,
			})
		}
	}"""

new_cand_end = """		if successRes != nil {
			successRes.Identity = "User A" // explicitly mark as User A
			candMu.Lock()
			candidates = append(candidates, successRes)
			candMu.Unlock()

			// Broadcast event so it shows up in Request Logs under User A
			r.Broadcast(Event{
				Type: EventResult,
				Data: successRes,
			})
		}
		
		<-candSem
		candWg.Done()
	}(ep)
	}
	candWg.Wait()"""

code = code.replace(old_cand_end, new_cand_end, 1)

# 2. Parallelize User B replay loop
old_replay_start = """	var bolaResults []*swagger.FuzzResult

	// 3. Replay requests
	for _, cand := range candidates {"""

new_replay_start = """	var bolaResults []*swagger.FuzzResult
	var bolaMu sync.Mutex
	var bolaWg sync.WaitGroup
	bolaSem := make(chan struct{}, r.config.Settings.Concurrency)
	if r.config.Settings.Concurrency == 0 {
		bolaSem = make(chan struct{}, 5)
	}

	// 3. Replay requests
	for _, cand := range candidates {
		bolaWg.Add(1)
		bolaSem <- struct{}{}
		
		go func(cand *swagger.FuzzResult) {"""

code = code.replace(old_replay_start, new_replay_start, 1)


old_replay_append_1 = """								bolaResults = append(bolaResults, resCopy)"""
new_replay_append_1 = """								bolaMu.Lock()
								bolaResults = append(bolaResults, resCopy)
								bolaMu.Unlock()"""
code = code.replace(old_replay_append_1, new_replay_append_1)


old_replay_append_2 = """							bolaResults = append(bolaResults, resCopy)"""
new_replay_append_2 = """							bolaMu.Lock()
							bolaResults = append(bolaResults, resCopy)
							bolaMu.Unlock()"""
code = code.replace(old_replay_append_2, new_replay_append_2)


old_replay_end = """			}
		}
	}

	return bolaResults"""

new_replay_end = """			}
		}
		
		<-bolaSem
		bolaWg.Done()
	}(cand)
	}
	bolaWg.Wait()

	return bolaResults"""

# We must be careful replacing the end of the loop since there are many '}'
# We will just find the last return bolaResults
old_replay_end_chunk = """					}
				}
			}
		}
	}

	return bolaResults
}"""

new_replay_end_chunk = """					}
				}
			}
		}
		
		<-bolaSem
		bolaWg.Done()
	}(cand)
	}
	bolaWg.Wait()

	return bolaResults
}"""
code = code.replace(old_replay_end_chunk, new_replay_end_chunk, 1)

with open("/Users/alex/src/swazz/packages/container/internal/runner/bola.go", "w") as f:
    f.write(code)
print("Parallelized bolaPhase!")

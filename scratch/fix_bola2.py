with open("/Users/alex/src/swazz/packages/container/internal/runner/bola.go", "r") as f:
    lines = f.readlines()

for i, line in enumerate(lines):
    if "if hasSuccessCandidate[key] {" in line:
        # replace the next line's continue
        lines[i+1] = lines[i+1].replace("continue", "return")
    if "ep, found := r.findEndpointConfig(cand.Endpoint, cand.Method)" in line:
        lines[i+2] = lines[i+2].replace("continue", "return")

code = "".join(lines)

old_end = """		}
	}

	fmt.Printf("Access Control phase complete. Found %d findings.\\n", len(bolaResults))
	return bolaResults
}"""

new_end = """		}
		
		<-bolaSem
		bolaWg.Done()
	}(cand)
	}
	bolaWg.Wait()

	fmt.Printf("Access Control phase complete. Found %d findings.\\n", len(bolaResults))
	return bolaResults
}"""

code = code.replace(old_end, new_end)

with open("/Users/alex/src/swazz/packages/container/internal/runner/bola.go", "w") as f:
    f.write(code)
print("Fixed EOF and continues.")

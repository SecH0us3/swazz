with open("/Users/alex/src/swazz/packages/container/internal/runner/bola.go", "r") as f:
    code = f.read()

bad_chunk = """					if targetID != "" {
						finding := swagger.AnalysisFinding{
							RuleID:   "swazz/bola-idor","""

good_chunk = """					if targetID != "" || paramName != "" {
						finding := swagger.AnalysisFinding{
							RuleID:   "swazz/bola-idor","""

new_code = code.replace(bad_chunk, good_chunk)
with open("/Users/alex/src/swazz/packages/container/internal/runner/bola.go", "w") as f:
    f.write(new_code)
print("Fixed!")

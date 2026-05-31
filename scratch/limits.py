with open("/Users/alex/src/swazz/packages/container/internal/runner/bola.go", "r") as f:
    code = f.read()

code = code.replace("if limit > 5 {\n\t\t\tlimit = 5 // try up to 5 harvested IDs\n\t\t}", "if limit > 25 {\n\t\t\tlimit = 25 // brute force up to 25 harvested IDs\n\t\t}")
code = code.replace("if limit > 3 {\n\t\t\t\t\tlimit = 3\n\t\t\t\t}", "if limit > 25 {\n\t\t\t\t\tlimit = 25\n\t\t\t\t}")

with open("/Users/alex/src/swazz/packages/container/internal/runner/bola.go", "w") as f:
    f.write(code)
print("Updated limits.")

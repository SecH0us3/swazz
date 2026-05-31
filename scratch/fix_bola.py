with open("/Users/alex/src/swazz/packages/container/internal/runner/bola.go", "r") as f:
    code = f.read()

code = code.replace("var resolvedPath string\n\t\tvar harvested []string", "var harvested []string")
with open("/Users/alex/src/swazz/packages/container/internal/runner/bola.go", "w") as f:
    f.write(code)
print("Fixed declared and not used.")

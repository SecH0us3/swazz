import os
import glob

base_dir = '/Users/alex/.gemini/antigravity-cli/brain/eb2d07d9-64fa-43d9-865b-b02d060c48f4/.system_generated/worktrees/subagent-Task-1-Implementer-self-38f82246/packages/container'

os.makedirs(f'{base_dir}/internal/config', exist_ok=True)
os.makedirs(f'{base_dir}/internal/agent', exist_ok=True)

# 1. Read cli.go
with open(f'{base_dir}/cli.go', 'r') as f:
    cli_lines = f.readlines()

config_content = cli_lines[40:118] + cli_lines[498:882]
remaining_cli = cli_lines[:40] + cli_lines[118:498] + cli_lines[882:]

# Get imports for config.go
imports = """
import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"strings"
	"sync"
	"time"

	"swazz-engine/internal/graphql"
	"swazz-engine/internal/grpc"
	"swazz-engine/internal/har"
	"swazz-engine/internal/logger"
	"swazz-engine/internal/mcp"
	"swazz-engine/internal/postman"
	"swazz-engine/internal/proto"
	"swazz-engine/internal/safenet"
	"swazz-engine/internal/swagger"
	"swazz-engine/internal/ws"
)
"""

with open(f'{base_dir}/internal/config/config.go', 'w') as f:
    f.write("package config\n")
    f.write(imports)
    f.writelines(config_content)

# Update cli.go
cli_code = "".join(remaining_cli)
cli_code = cli_code.replace("CliConfig", "config.CliConfig")
cli_code = cli_code.replace("BuildRunnerConfig", "config.BuildRunnerConfig")
cli_code = cli_code.replace("writeJSON", "config.WriteJSON")
# Add import
import_idx = cli_code.find('import (\n') + 9
cli_code = cli_code[:import_idx] + '\t"swazz-engine/internal/config"\n' + cli_code[import_idx:]

with open(f'{base_dir}/cli.go', 'w') as f:
    f.write(cli_code)

# 2. Move spec and utils to config
for file_name in ["utils.go", "utils_test.go", "spec.go", "spec_test.go"]:
    src = f'{base_dir}/{file_name}'
    dst = f'{base_dir}/internal/config/{file_name}'
    if os.path.exists(src):
        with open(src, 'r') as fp:
            content = fp.read()
        content = content.replace("package main", "package config")
        if file_name == "utils.go":
            content = content.replace("func writeJSON", "func WriteJSON")
        with open(dst, 'w') as fp:
            fp.write(content)
        os.remove(src)

# 3. Move agent files
agent_files = [
    "agent.go", "agent_client.go", "agent_crypto.go", "agent_crypto_test.go",
    "agent_dispatcher.go", "agent_spec_filter.go", "agent_spec_filter_test.go",
    "agent_test.go", "agent_triage.go"
]

for file_name in agent_files:
    src = f'{base_dir}/{file_name}'
    dst = f'{base_dir}/internal/agent/{file_name}'
    if os.path.exists(src):
        with open(src, 'r') as fp:
            content = fp.read()
        content = content.replace("package main", "package agent")
        content = content.replace("func startAgent", "func StartAgent")
        content = content.replace("CliConfig", "config.CliConfig")
        content = content.replace("BuildRunnerConfig", "config.BuildRunnerConfig")
        
        # Insert "swazz-engine/internal/config" if it uses config
        if "config.CliConfig" in content or "config.BuildRunnerConfig" in content:
            if 'import (' in content:
                import_idx = content.find('import (\n') + 9
                content = content[:import_idx] + '\t"swazz-engine/internal/config"\n' + content[import_idx:]
            else:
                content = content.replace('package agent\n', 'package agent\n\nimport "swazz-engine/internal/config"\n')

        with open(dst, 'w') as fp:
            fp.write(content)
        os.remove(src)

# 4. Update main.go
with open(f'{base_dir}/main.go', 'r') as f:
    main_code = f.read()

main_code = main_code.replace("startAgent(args)", "agent.StartAgent(args)")
import_idx = main_code.find('import (\n') + 9
main_code = main_code[:import_idx] + '\t"swazz-engine/internal/agent"\n' + main_code[import_idx:]

with open(f'{base_dir}/main.go', 'w') as f:
    f.write(main_code)

print("Refactoring done.")

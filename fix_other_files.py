import os

base_dir = '/Users/alex/.gemini/antigravity-cli/brain/eb2d07d9-64fa-43d9-865b-b02d060c48f4/.system_generated/worktrees/subagent-Task-1-Implementer-self-38f82246/packages/container'

def add_import(file_path, imp):
    with open(file_path, 'r') as f:
        content = f.read()
    if imp not in content:
        idx = content.find('import (\n') + 9
        content = content[:idx] + f'\t"{imp}"\n' + content[idx:]
        with open(file_path, 'w') as f:
            f.write(content)

def replace_in_file(file_path, old, new):
    with open(file_path, 'r') as f:
        content = f.read()
    content = content.replace(old, new)
    with open(file_path, 'w') as f:
        f.write(content)

# Update wizard.go
replace_in_file(f'{base_dir}/wizard.go', 'CliConfig', 'config.CliConfig')
add_import(f'{base_dir}/wizard.go', 'swazz-engine/internal/config')

# Update spider.go
replace_in_file(f'{base_dir}/spider.go', 'CliConfig', 'config.CliConfig')
replace_in_file(f'{base_dir}/spider.go', 'BuildRunnerConfig', 'config.BuildRunnerConfig')
add_import(f'{base_dir}/spider.go', 'swazz-engine/internal/config')

# Export incrementGlobalScanTelemetry in agent_triage.go
replace_in_file(f'{base_dir}/internal/agent/agent_triage.go', 'func incrementGlobalScanTelemetry', 'func IncrementGlobalScanTelemetry')

# Update cli.go to use agent.IncrementGlobalScanTelemetry
replace_in_file(f'{base_dir}/cli.go', 'incrementGlobalScanTelemetry(', 'agent.IncrementGlobalScanTelemetry(')
add_import(f'{base_dir}/cli.go', 'swazz-engine/internal/agent')


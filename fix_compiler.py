import os

base_dir = 'packages/container'

# 1. Fix wizard.go
with open(f'{base_dir}/wizard.go', 'r') as f:
    wizard_code = f.read()

wizard_code = wizard_code.replace('"swazz-engine/internal/config"', 'swzconfig "swazz-engine/internal/config"')
wizard_code = wizard_code.replace('config.CliConfig', 'swzconfig.CliConfig')

with open(f'{base_dir}/wizard.go', 'w') as f:
    f.write(wizard_code)

# 2. Fix spider.go (just in case there are missing things, wait, spider.go had no other errors)

# 3. Fix cli.go unused imports
with open(f'{base_dir}/cli.go', 'r') as f:
    cli_lines = f.readlines()

to_remove = ['"net/url"', '"swazz-engine/internal/graphql"', '"swazz-engine/internal/grpc"', '"swazz-engine/internal/har"', '"swazz-engine/internal/mcp"', '"swazz-engine/internal/postman"', '"swazz-engine/internal/proto"', '"swazz-engine/internal/ws"']
new_lines = []
for line in cli_lines:
    if any(imp in line for imp in to_remove):
        continue
    new_lines.append(line)

with open(f'{base_dir}/cli.go', 'w') as f:
    f.writelines(new_lines)


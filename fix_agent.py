import os

agent_go_path = 'packages/container/internal/agent/agent.go'
with open(agent_go_path, 'r') as f:
    content = f.read()

content = content.replace("printHelp()", 'fmt.Println("Usage: swazz-engine run-agent [options]")')
content = content.replace("agentVer := Version", 'agentVer := "dev"')

with open(agent_go_path, 'w') as f:
    f.write(content)


import os

base_dir = 'packages/container'

def replace_in_file(file_path, old, new):
    with open(file_path, 'r') as f:
        content = f.read()
    content = content.replace(old, new)
    with open(file_path, 'w') as f:
        f.write(content)

def add_import(file_path, imp):
    with open(file_path, 'r') as f:
        content = f.read()
    if imp not in content:
        idx = content.find('import (\n') + 9
        content = content[:idx] + f'\t"{imp}"\n' + content[idx:]
        with open(file_path, 'w') as f:
            f.write(content)

for t_file in ['spider_test.go', 'wizard_test.go']:
    path = f'{base_dir}/{t_file}'
    if os.path.exists(path):
        replace_in_file(path, 'CliConfig', 'config.CliConfig')
        replace_in_file(path, 'Testconfig.CliConfig', 'TestCliConfig')
        add_import(path, 'swazz-engine/internal/config')


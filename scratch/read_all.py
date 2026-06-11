import os
import sys

def should_ignore(path):
    parts = path.split(os.sep)
    ignore_dirs = {'node_modules', 'dist', 'build', '.git', 'tmp', '.next', '.bin', 'coverage'}
    if any(p in ignore_dirs for p in parts):
        return True
    return False

def is_source_file(filename):
    valid_exts = {'.go', '.ts', '.tsx', '.sql', '.json', '.yaml', '.yml', '.md'}
    _, ext = os.path.splitext(filename)
    return ext in valid_exts

def main():
    root_dir = 'packages'
    for root, dirs, files in os.walk(root_dir):
        if should_ignore(root):
            continue
        for file in files:
            filepath = os.path.join(root, file)
            if should_ignore(filepath):
                continue
            if not is_source_file(file):
                continue
            
            try:
                with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
                    content = f.read()
                print(f"=== FILE: {filepath} ===")
                print(content)
                print(f"=== END FILE: {filepath} ===\n")
            except Exception as e:
                print(f"=== ERROR READING: {filepath}: {e} ===", file=sys.stderr)

if __name__ == '__main__':
    main()

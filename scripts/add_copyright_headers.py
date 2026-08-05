#!/usr/bin/env python3
# Copyright (c) 2026 Swazz Authors
# This file is part of Swazz
# Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
# See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import os
import sys

HEADER = """// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

"""

SKIP_DIRS = {
    "node_modules", ".git", ".antigravitycli", "dist", "build", ".wrangler", "tmp", "scratch", ".Jules", ".worktrees"
}

def process_file(filepath):
    try:
        with open(filepath, "r", encoding="utf-8") as f:
            content = f.read()
    except Exception as e:
        print(f"Skipping {filepath}: {e}")
        return False

    if "Business Source License 1.1 (BSL 1.1)" in content or "Copyright (c) 2026 Swazz Authors" in content:
        return False

    # Prepend header
    new_content = HEADER + content
    with open(filepath, "w", encoding="utf-8") as f:
        f.write(new_content)
    print(f"Added BSL 1.1 header to: {filepath}")
    return True

def main():
    repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    count = 0
    for root, dirs, files in os.walk(repo_root):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for file in files:
            if file.endswith(".go") or file.endswith(".ts") or file.endswith(".tsx"):
                if file.endswith(".d.ts"):
                    continue
                filepath = os.path.join(root, file)
                if process_file(filepath):
                    count += 1
    print(f"Finished. Total files updated: {count}")

if __name__ == "__main__":
    main()

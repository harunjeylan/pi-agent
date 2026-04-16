#!/usr/bin/env python3
"""Detect files in target path for graphify."""

import json
import sys
from pathlib import Path

# Add graphify to path
try:
    from graphify.detect import detect
except ImportError:
    print("graphify not installed", file=sys.stderr)
    sys.exit(1)

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: detect.py <target_path>", file=sys.stderr)
        sys.exit(1)

    target_path = Path(sys.argv[1])
    result = detect(target_path)
    print(json.dumps(result))

#!/usr/bin/env python3
"""claude-ide: the local server behind the editor page. Stdlib only, Python 3.9+.

    python3 server.py --port 8030 [--root /path/to/project ...]

The code lives in the `ide` package beside this file; see ide/__init__.py for the layers.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from ide.app import main  # noqa: E402

if __name__ == "__main__":
    main()

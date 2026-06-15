"""Make the project root importable so tests can `from engine... import ...`
regardless of how pytest is invoked."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

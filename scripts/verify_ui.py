"""Headless smoke test of web/app.py routes via streamlit.testing.AppTest.

Runs the screener and the four canonical deep-dives (AAPL, JPM, V, FDXF)
against the live database and fails loudly on any uncaught exception or
missing data-honesty annotation. Run before committing UI changes:

    .venv\\Scripts\\python.exe scripts\\verify_ui.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from streamlit.testing.v1 import AppTest

APP = str(Path(__file__).resolve().parent.parent / "web" / "app.py")


def run_route(page: str, ticker: str | None) -> None:
    at = AppTest.from_file(APP, default_timeout=180)
    at.session_state["page"] = page
    at.session_state["selected_ticker"] = ticker
    at.run()
    label = f"{page}:{ticker or '-'}"
    if at.exception:
        print(f"[FAIL] {label}")
        for e in at.exception:
            print("   ", e.message)
            print(e.stack_trace)
        sys.exit(1)
    # collect rendered text for spot checks
    texts = " | ".join(
        str(getattr(el, "value", getattr(el, "body", "")))
        for el in list(at.markdown) + list(at.caption) + list(at.info) + list(at.error)
    )
    print(f"[OK]   {label}  (markdown blocks: {len(at.markdown)})")
    return texts


print("--- screener ---")
t = run_route("screener", None)

print("--- AAPL ---")
t = run_route("deepdive", "AAPL")
assert "Factor scores" in t, "AAPL Factor scores section missing"
assert "Composite" in t, "AAPL Composite label missing"

print("--- JPM ---")
t = run_route("deepdive", "JPM")
assert "ROA proxy" in t, "JPM ROA proxy caption missing"

print("--- V ---")
t = run_route("deepdive", "V")
assert "no value factor" in t, "V no-value-factor card missing"

print("--- FDXF ---")
t = run_route("deepdive", "FDXF")
assert "No fundamental data available" in t, "FDXF graceful-null message missing"

print("\nAll routes verified.")

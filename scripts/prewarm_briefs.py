"""Pre-warm Decision Briefs for the "hot set" — every ticker any user watches or
holds — so those deep-dive pages open with an instant, already-cached brief.

Runs after the nightly scoring pass. Each brief is generated at most once per
scoring snapshot (get_or_generate_brief reuses a still-valid cached brief and
only regenerates on a material change), so a nightly pass is cheap:
Groq-first = free and fast, Anthropic only as fallback. This never touches the
full universe — only the bounded hot set — consistent with the on-demand cost
posture.

Usage:
    python scripts/prewarm_briefs.py                 # all watchlist + held tickers
    python scripts/prewarm_briefs.py --tickers HG    # targeted
    python scripts/prewarm_briefs.py --limit 50      # cap the count (CI budget)
    python scripts/prewarm_briefs.py --sleep 0.5     # throttle between calls
"""
from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from engine import brief as brief_engine  # noqa: E402
from engine import queries  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tickers", nargs="+", default=None,
                        help="Explicit tickers instead of the auto hot set.")
    parser.add_argument("--limit", type=int, default=None,
                        help="Cap how many tickers to process (CI time budget).")
    parser.add_argument("--sleep", type=float, default=0.0,
                        help="Seconds to sleep between generations (throttle).")
    args = parser.parse_args()

    if not brief_engine.LLM_KEY_AVAILABLE:
        print("No LLM key (GROQ_API_KEY or ANTHROPIC_API_KEY) — nothing to warm.")
        return 0

    tickers = args.tickers or queries.prewarm_brief_tickers()
    if args.limit is not None:
        tickers = tickers[: args.limit]

    total = len(tickers)
    print(f"Pre-warming briefs for {total} hot-set ticker(s)...")

    warmed = cached = skipped = failed = 0
    for i, ticker in enumerate(tickers, 1):
        try:
            ctx = brief_engine.build_context(ticker)
            if ctx is None:
                skipped += 1  # unknown/inactive or no factor scores yet
                continue
            sid = ctx["header"]["security_id"]
            # Was a still-valid brief already cached? If so, get_or_generate_brief
            # reuses it (no LLM call); otherwise it generates one now.
            existing = queries.latest_brief(
                sid, brief_engine.PROMPT_VERSION, brief_engine.SCHEMA_VERSION,
            )
            reused = existing is not None and brief_engine._brief_still_valid(existing, ctx, sid)
            if brief_engine.get_or_generate_brief(ticker) is None:
                skipped += 1
            elif reused:
                cached += 1
            else:
                warmed += 1
        except Exception as exc:  # noqa: BLE001 — one bad ticker never aborts the batch
            failed += 1
            print(f"  [{i}/{total}] {ticker}: FAILED — {exc}")
        if args.sleep > 0 and i < total:
            time.sleep(args.sleep)

    print(
        f"Done. generated={warmed} cached(reused)={cached} "
        f"skipped(no scores)={skipped} failed={failed}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

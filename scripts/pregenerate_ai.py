"""Nightly AI pre-generation — briefs (+ optionally filing summaries) served warm.

Pre-generates the Decision Brief (cached per scoring snapshot) and, unless
--briefs-only, the 10-K filing summary (cached per accession — effectively
one-time per filing) for the names a user is most likely to open: the watchlist
plus the top N screener names by composite. Everything else still generates on
first page open, exactly as before.

Cost control (all generators run on Haiku, and check the cache first — re-running
is free):
- Briefs: ~$0.006 each on Haiku, cached per scoring snapshot (once/day at most).
- Summaries / deep filing analysis: cached by accession, so they only cost when a
  target name files a new 10-K. --briefs-only skips them entirely.

Usage:
    python scripts/pregenerate_ai.py                       # watchlist + top 15
    python scripts/pregenerate_ai.py --top-n 30            # widen the slice
    python scripts/pregenerate_ai.py --top-n 0 --briefs-only  # watchlist briefs only

The nightly wires the last form (watchlist briefs only) AFTER scoring, gated on
the ANTHROPIC_API_KEY secret, continue-on-error — a model outage never breaks the
pipeline, and the bounded watchlist scope keeps spend at pennies/month.
"""
from __future__ import annotations

import argparse
import os
import sys
from datetime import UTC, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from engine import brief, filing_qa, queries, summarize  # noqa: E402
from engine.db import get_connection  # noqa: E402
from engine.jobs import finish_job, start_job  # noqa: E402

JOB_NAME = "ai_pregeneration"
JOB_VERSION = "v1"
DEFAULT_TOP_N = 15


def target_tickers(top_n: int) -> list[str]:
    """Watchlist names + top-N screener names by composite, deduped."""
    targets = set(queries.watchlist_tickers())
    rows, _score_date = queries.screener_rows()  # already sorted by composite
    targets.update(r["ticker"] for r in rows[:top_n])
    return sorted(targets)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--top-n", type=int, default=DEFAULT_TOP_N,
                        help=f"screener names to include (default {DEFAULT_TOP_N})")
    parser.add_argument("--briefs-only", action="store_true",
                        help="warm Decision Briefs only; skip 10-K summaries and "
                             "deep filing analysis (the nightly watchlist warm)")
    args = parser.parse_args()

    if not os.getenv("ANTHROPIC_API_KEY"):
        print("ANTHROPIC_API_KEY is not set - nothing to do.")
        return 1

    tickers = target_tickers(args.top_n)
    print(f"Pre-generating AI content for {len(tickers)} names: {', '.join(tickers)}")

    conn = get_connection()
    job_id = start_job(
        conn, JOB_NAME, job_version=JOB_VERSION,
        params={"top_n": args.top_n, "tickers": tickers},
        data_date=datetime.now(UTC).date(),
    )
    conn.close()

    # Deep filing analysis is Opus over a large filing — far costlier than the
    # Sonnet brief/summary — so warm it ONLY for the (small) watchlist, not the
    # whole top-N. Cached by accession, so this is once per annual filing.
    watchlist = set(queries.watchlist_tickers())

    warnings: list[str] = []
    briefs_done = summaries_done = filing_qa_done = 0
    for i, t in enumerate(tickers, start=1):
        # Summary first: the brief reads the cached 10-K summary as context,
        # so warming it first makes the brief strictly better-grounded.
        if not args.briefs_only:
            try:
                if summarize.get_or_generate_summary(t) is not None:
                    summaries_done += 1
            except Exception as exc:  # noqa: BLE001 - isolate per ticker
                warnings.append(f"{t}: summary failed - {exc!r}")
        try:
            if brief.get_or_generate_brief(t) is not None:
                briefs_done += 1
        except Exception as exc:  # noqa: BLE001
            warnings.append(f"{t}: brief failed - {exc!r}")
        if t in watchlist and not args.briefs_only:
            try:
                if filing_qa.get_or_generate_filing_qa(t) is not None:
                    filing_qa_done += 1
            except Exception as exc:  # noqa: BLE001
                warnings.append(f"{t}: filing_qa failed - {exc!r}")
        print(f"  [{i}/{len(tickers)}] {t} done", flush=True)

    conn = get_connection()
    finish_job(
        conn, job_id,
        status="success",  # per-ticker issues are warnings, not job failure
        rows_affected=briefs_done + summaries_done + filing_qa_done,
        warnings=warnings or None,
    )
    conn.close()

    print(f"\nWarm: {briefs_done} briefs, {summaries_done} summaries, "
          f"{filing_qa_done} deep filing analyses ({len(warnings)} warnings)")
    for w in warnings:
        print(f"  WARN {w}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

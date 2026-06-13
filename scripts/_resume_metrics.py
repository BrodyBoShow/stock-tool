"""Resilient metrics + scoring driver.

Runs metrics.run() over the full active universe in small batches, each in a
short-lived subprocess with a hard timeout. A Supabase pooler drop can hang the
psycopg client in a socket read with no timeout (see nightly.yml note); batching
into killable subprocesses means one such hang costs a single batch (killed on
timeout, then retried) instead of freezing the whole run forever.

After all batches complete, runs scoring.run() once to stamp today's ranks.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

PY = str(ROOT / ".venv" / "Scripts" / "python.exe")
BATCH = 250
TIMEOUT = 300          # seconds per batch before we treat it as a pooler hang
MAX_RETRIES = 4

BATCH_CODE = """
import sys
sys.path.insert(0, r'{root}')
from engine import metrics
tickers = {tickers!r}
me = metrics.run(tickers=tickers)
print('OK', me['companies_done'], me['metric_rows'], me.get('non_usd_companies', 0))
"""


def active_tickers() -> list[str]:
    from engine.db import get_connection

    conn = get_connection()
    cur = conn.cursor()
    cur.execute("SELECT ticker FROM securities WHERE is_active = true ORDER BY ticker")
    rows = [r[0] for r in cur.fetchall()]
    conn.close()
    return rows


def run_batch(tickers: list[str]) -> bool:
    code = BATCH_CODE.format(root=str(ROOT), tickers=tickers)
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            proc = subprocess.run(
                [PY, "-c", code],
                capture_output=True,
                text=True,
                timeout=TIMEOUT,
            )
            out = (proc.stdout or "").strip().splitlines()
            ok_line = next((ln for ln in out if ln.startswith("OK")), None)
            if proc.returncode == 0 and ok_line:
                print(f"    {ok_line}", flush=True)
                return True
            print(
                f"    attempt {attempt} failed rc={proc.returncode} "
                f"err={(proc.stderr or '')[-200:].strip()}",
                flush=True,
            )
        except subprocess.TimeoutExpired:
            print(f"    attempt {attempt} TIMEOUT ({TIMEOUT}s) — pooler hang, retrying", flush=True)
    return False


def main() -> int:
    tickers = active_tickers()
    batches = [tickers[i : i + BATCH] for i in range(0, len(tickers), BATCH)]
    print(f"Universe {len(tickers)} tickers in {len(batches)} batches of {BATCH}", flush=True)

    failed_batches = 0
    for idx, batch in enumerate(batches, 1):
        print(f"[{idx}/{len(batches)}] {batch[0]}..{batch[-1]}", flush=True)
        if not run_batch(batch):
            failed_batches += 1
            print(f"    !! batch {idx} gave up after {MAX_RETRIES} attempts", flush=True)

    print(f"\nMetrics pass complete. failed_batches={failed_batches}", flush=True)

    print("Scoring...", flush=True)
    from engine import scoring

    sc = scoring.run()
    print(
        f"SCORING DONE: score_date={sc['score_date']} rows={sc['rows_written']} "
        f"composite={sc['scored_with_composite']}",
        flush=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

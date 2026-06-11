"""Supervise a resumable backfill: restart it whenever it stalls or dies.

Usage:
    python scripts/supervise_backfill.py --label prices [--stall 600] -- \
        <python> -u -X utf8 scripts/backfill_prices_bulk.py [args...]

Why this exists: on Windows, libpq ignores fine-grained TCP keepalives and
tcp_user_timeout is Linux-only, so when the Supabase pooler (or a network blip)
drops a connection MID-WRITE, the client blocks inside a socket read for up to
the ~2h OS keepalive default — no exception, no timeout, just silence. In-code
reconnect guards can't run while blocked. Both overnight backfills froze this
way twice on 2026-06-11 (each time both at the same instant => network-level).

The supervisor sidesteps the whole class of hangs: the backfills are resumable
by design (commit per item + skip already-loaded), so kill-and-restart is
always safe. It watches the child's stdout; if the child prints nothing for
--stall seconds it is presumed hung and is killed and relaunched. Lines that
announce a sleep ("cooldown 1800s") extend the allowance so legitimate
rate-limit waits aren't treated as stalls. Child exit 0 ends supervision;
nonzero exits are restarted up to --max-restarts.
"""
from __future__ import annotations

import argparse
import re
import subprocess
import sys
import threading
import time

COOLDOWN_RE = re.compile(r"cooldown\s+(\d+)s")


def main() -> int:
    ap = argparse.ArgumentParser(description="Restart a resumable backfill on stall/death.")
    ap.add_argument("--label", required=True, help="Name used in supervisor log lines.")
    ap.add_argument("--stall", type=int, default=600,
                    help="Seconds of stdout silence (beyond announced sleeps) = hung.")
    ap.add_argument("--max-restarts", type=int, default=60)
    ap.add_argument("cmd", nargs=argparse.REMAINDER,
                    help="-- followed by the child command line.")
    args = ap.parse_args()
    cmd = args.cmd[1:] if args.cmd and args.cmd[0] == "--" else args.cmd
    if not cmd:
        print("supervisor: no child command given", flush=True)
        return 2

    restarts = 0
    while True:
        print(f"[supervisor:{args.label}] launching (attempt {restarts + 1}): "
              f"{' '.join(cmd)}", flush=True)
        proc = subprocess.Popen(
            cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, encoding="utf-8", errors="replace", bufsize=1,
        )
        state = {"last": time.monotonic(), "grace": 0.0}

        def pump(p=proc, s=state) -> None:
            for line in p.stdout:  # type: ignore[union-attr]
                sys.stdout.write(line)
                sys.stdout.flush()
                s["last"] = time.monotonic()
                m = COOLDOWN_RE.search(line)
                # A printed cooldown precedes a sleep of that length: extend
                # the silence allowance; any later output resets it.
                s["grace"] = float(m.group(1)) if m else 0.0

        t = threading.Thread(target=pump, daemon=True)
        t.start()

        killed_for_stall = False
        while True:
            rc = proc.poll()
            if rc is not None:
                break
            silent = time.monotonic() - state["last"]
            if silent > args.stall + state["grace"]:
                print(f"[supervisor:{args.label}] STALL: {silent:.0f}s of silence "
                      f"(allowed {args.stall + state['grace']:.0f}s) — killing child",
                      flush=True)
                proc.kill()
                killed_for_stall = True
                break
            time.sleep(10)

        proc.wait()
        t.join(timeout=5)
        rc = proc.returncode
        if rc == 0 and not killed_for_stall:
            print(f"[supervisor:{args.label}] child finished cleanly — done.", flush=True)
            return 0
        restarts += 1
        if restarts >= args.max_restarts:
            print(f"[supervisor:{args.label}] giving up after {restarts} restarts "
                  f"(last rc={rc})", flush=True)
            return 1
        why = "stalled" if killed_for_stall else f"exited rc={rc}"
        print(f"[supervisor:{args.label}] child {why} — restarting in 15s "
              f"({restarts}/{args.max_restarts})", flush=True)
        time.sleep(15)


if __name__ == "__main__":
    raise SystemExit(main())

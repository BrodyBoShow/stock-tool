"""Nightly brokerage auto-sync.

Pulls each connected link's latest activity + current positions into the SAME
``portfolio_transactions`` ledger the app already reads, so a user's portfolio
tracks their broker without a manual "Sync" click. Idempotent (the partial-unique
(linked_account_id, external_id) index de-dupes) and READ-ONLY at the broker —
this never places a trade.

Continue-on-error: an expired/again-failing link is logged and skipped, and the
script still exits 0 so a single bad link can't fail the nightly workflow. Needs
DATABASE_URL + PORTFOLIO_TOKEN_KEY (to decrypt stored OAuth tokens) +
SNAPTRADE_OAUTH_CLIENT_ID (to refresh them) in the environment; without them the
nightly step is gated off and this never runs.
"""
from __future__ import annotations

import sys

from engine.portfolio_sync import sync_all_accounts


def main() -> int:
    results = sync_all_accounts()
    if not results:
        print("[sync] no connected brokerage links (or table absent) — nothing to do")
        return 0
    ok = 0
    for r in results:
        if r.get("ok"):
            ok += 1
            tag = " [pending re-auth]" if r.get("pending") else ""
            print(f"[sync] link {r['link_id']} ({r.get('display_name') or '?'}): "
                  f"+{r.get('inserted', 0)} rows, {r.get('reconciled', 0)} reconciled{tag}")
        else:
            print(f"[sync] link {r['link_id']}: ERROR {r.get('error')}", file=sys.stderr)
    print(f"[sync] done: {ok}/{len(results)} links synced")
    # A single bad link stays best-effort (exit 0). But if EVERY link failed, exit
    # nonzero so the step shows red in the Actions UI (sync is silently broken) —
    # the workflow's continue-on-error still keeps the critical pipeline green.
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())

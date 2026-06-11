"""Phase 3 — Price ingestion.

Defines a swappable PriceProvider interface and a YFinanceProvider, then
backfills ~5y of daily OHLCV into prices_daily and splits/dividends into
corporate_actions. Incremental on re-run (only fetches from each ticker's
latest stored date forward). All writes are idempotent. Logged to job_runs.

Raw vs adjusted: we fetch with auto_adjust=False, storing Yahoo's Close ->
prices_daily.close and Adj Close -> prices_daily.adj_close as-is. Aligning
the split basis with fundamentals happens later in Phase 5.
"""

from __future__ import annotations

import math
import time
from abc import ABC, abstractmethod
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

import pandas as pd
import yfinance as yf
from dotenv import load_dotenv

from engine.db import get_connection
from engine.jobs import finish_job, start_job

_PROJECT_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(_PROJECT_ROOT / ".env")

JOB_NAME = "price_ingestion"
JOB_VERSION = "v1"

BACKFILL_YEARS = 5
THROTTLE_SECONDS = 0.3          # polite gap between tickers
RETRY_BACKOFF = (3, 10, 30)     # seconds between attempts; len+1 total attempts

# Normalized column set returned by every provider.
PRICE_COLUMNS = ["date", "open", "high", "low", "close", "adj_close", "volume", "dividend", "split"]


def _f(x) -> float | None:
    """Coerce to float, mapping NaN/None to None."""
    if x is None:
        return None
    try:
        xf = float(x)
    except (TypeError, ValueError):
        return None
    return None if math.isnan(xf) else xf


class PriceProvider(ABC):
    """Swappable daily-price source. Returns a normalized DataFrame."""

    @abstractmethod
    def fetch(self, ticker: str, start: date, end: date) -> pd.DataFrame:
        """Return a DataFrame with PRICE_COLUMNS for [start, end).

        Columns: date (datetime.date), open/high/low/close/adj_close (float),
        volume (int), dividend (cash per share), split (ratio; 4.0 = 4-for-1).
        Empty DataFrame if no data.
        """
        raise NotImplementedError


class YFinanceProvider(PriceProvider):
    """yfinance-backed provider. Uses auto_adjust=False to keep raw + adjusted."""

    name = "yfinance"

    def fetch(self, ticker: str, start: date, end: date) -> pd.DataFrame:
        last_exc: Exception | None = None
        for attempt in range(len(RETRY_BACKOFF) + 1):
            try:
                hist = yf.Ticker(ticker).history(
                    start=start.isoformat(),
                    end=end.isoformat(),
                    interval="1d",
                    auto_adjust=False,
                    actions=True,
                    raise_errors=False,
                )
                if hist is not None and not hist.empty:
                    return self._normalize(hist)
                # Empty can mean rate-limit OR a genuinely dateless window;
                # retry a couple times, then accept emptiness.
            except Exception as exc:  # noqa: BLE001
                last_exc = exc
            if attempt < len(RETRY_BACKOFF):
                time.sleep(RETRY_BACKOFF[attempt])
        if last_exc is not None:
            raise last_exc
        return pd.DataFrame(columns=PRICE_COLUMNS)

    @staticmethod
    def _normalize(hist: pd.DataFrame) -> pd.DataFrame:
        df = hist.rename(
            columns={
                "Open": "open",
                "High": "high",
                "Low": "low",
                "Close": "close",
                "Adj Close": "adj_close",
                "Volume": "volume",
                "Dividends": "dividend",
                "Stock Splits": "split",
            }
        ).reset_index()
        # The index column is 'Date' (or sometimes 'Datetime').
        date_col = "Date" if "Date" in df.columns else df.columns[0]
        df["date"] = pd.to_datetime(df[date_col]).dt.date
        for col in PRICE_COLUMNS:
            if col not in df.columns:
                df[col] = None
        return df[PRICE_COLUMNS]


def _load_universe(cur) -> list[tuple[int, str]]:
    cur.execute("SELECT security_id, ticker FROM securities WHERE is_active ORDER BY ticker")
    return cur.fetchall()


def _load_all_securities(cur) -> list[tuple[int, str]]:
    """All securities regardless of is_active — for the one-time bulk backfill.

    The expanded-universe names are staged is_active=false until they have full
    data and 'graduate'. The backfill must still fetch their prices, so it loads
    the whole securities table rather than the live is_active scope.
    """
    cur.execute("SELECT security_id, ticker FROM securities ORDER BY ticker")
    return cur.fetchall()


def _latest_dates(cur) -> dict[int, date]:
    cur.execute("SELECT security_id, max(date) FROM prices_daily GROUP BY security_id")
    return {sid: d for sid, d in cur.fetchall()}


def _upsert_prices(cur, security_id: int, df: pd.DataFrame) -> int:
    rows = []
    for r in df.itertuples(index=False):
        close = _f(r.close)
        if close is None:
            continue  # skip bars with no usable close
        vol = _f(r.volume)
        rows.append(
            (
                security_id,
                r.date,
                _f(r.open),
                _f(r.high),
                _f(r.low),
                close,
                _f(r.adj_close),
                int(vol) if vol is not None else None,
            )
        )
    if not rows:
        return 0
    cur.executemany(
        """
        INSERT INTO prices_daily (security_id, date, open, high, low, close, adj_close, volume)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (security_id, date) DO UPDATE
          SET open = EXCLUDED.open, high = EXCLUDED.high, low = EXCLUDED.low,
              close = EXCLUDED.close, adj_close = EXCLUDED.adj_close, volume = EXCLUDED.volume
        """,
        rows,
    )
    return len(rows)


def _upsert_actions(cur, security_id: int, df: pd.DataFrame) -> tuple[int, int]:
    splits, divs = [], []
    for r in df.itertuples(index=False):
        sp = _f(r.split)
        dv = _f(r.dividend)
        if sp and sp > 0:
            splits.append((security_id, r.date, "split", sp, None, "yfinance"))
        if dv and dv > 0:
            divs.append((security_id, r.date, "dividend", None, dv, "yfinance"))
    sql = """
        INSERT INTO corporate_actions (security_id, ex_date, action_type, ratio, amount, source)
        VALUES (%s, %s, %s, %s, %s, %s)
        ON CONFLICT (security_id, ex_date, action_type) DO UPDATE
          SET ratio = EXCLUDED.ratio, amount = EXCLUDED.amount, source = EXCLUDED.source
    """
    if splits:
        cur.executemany(sql, splits)
    if divs:
        cur.executemany(sql, divs)
    return len(splits), len(divs)


def _is_rate_limit(exc: BaseException) -> bool:
    """True if an exception looks like a yfinance/Yahoo rate-limit signal."""
    name = type(exc).__name__.lower()
    msg = str(exc).lower()
    return "ratelimit" in name or "too many requests" in msg or "rate limited" in msg


def _reopen(conn):
    """Close a (possibly stale) connection best-effort and return a fresh one.

    On Windows, libpq's keepalives_idle/interval are ignored, so a Supabase
    pooler that silently drops an idle connection leaves a half-open socket the
    next write blocks on for up to the OS keepalive default (~2h). For a
    multi-hour backfill we therefore never trust a long-lived or recently-idle
    connection — we reopen it (cheap relative to the work) instead of hanging.
    """
    try:
        if conn is not None and not conn.closed:
            conn.close()
    except Exception:  # noqa: BLE001
        pass
    return get_connection()


def run_bulk_backfill(
    provider: PriceProvider | None = None,
    *,
    only_missing: bool = True,
    active_only: bool = False,
    log_every: int = 25,
    cooldowns: tuple[int, ...] = (60, 120, 300, 600, 900),
    max_consecutive_rate_limits: int = 5,
    long_ban_sleep: int = 1800,
    max_long_waits: int = 24,
    reconnect_every: int = 250,
    stale_after_seconds: float = 25.0,
) -> dict:
    """One-time historical backfill tuned for the large expanded universe.

    The standard per-ticker ``run()`` treats a rate-limited fetch the same as a
    genuinely empty one — it backs off only briefly, marks the ticker empty, and
    moves on, so under Yahoo's throttle it churns the whole universe loading
    nothing. This runner instead *recognizes* a rate-limit (YFRateLimitError /
    "Too Many Requests"), sleeps through a long escalating cooldown, and retries
    the SAME ticker rather than skipping it.

    - ``only_missing``: skip securities that already have any price rows (the
      original S&P 500 names) so we spend requests only on the new universe.
    - Commits per ticker, so it is fully resumable: stop and restart freely and
      it picks up where the DB left off.
    - Prints a progress line every ``log_every`` tickers so the background run
      can be monitored from the DB or stdout.
    """
    provider = provider or YFinanceProvider()
    today = datetime.now(UTC).date()
    end = today + timedelta(days=1)
    backfill_start = today - timedelta(days=365 * BACKFILL_YEARS)

    warnings: list[str] = []
    loaded = empty = failed = 0
    total_rows = total_splits = total_dividends = 0
    long_waits = 0  # global "sustained ban" sleeps consumed (across all tickers)

    conn = get_connection()
    job_id = start_job(
        conn, JOB_NAME, job_version=JOB_VERSION, data_date=today,
    )
    try:
        with conn.cursor() as cur:
            universe = _load_universe(cur) if active_only else _load_all_securities(cur)
            latest = _latest_dates(cur)
        if only_missing:
            universe = [(sid, t) for sid, t in universe if sid not in latest]
        scope = len(universe)
        print(f"[bulk] backfilling {scope} tickers (only_missing={only_missing}, "
              f"active_only={active_only})", flush=True)

        last_db = time.monotonic()  # when the conn was last known-good
        for i, (security_id, ticker) in enumerate(universe, start=1):
            # Periodic reconnect bounds connection age so the pooler can't recycle
            # it out from under us mid-write.
            if i % reconnect_every == 0:
                conn = _reopen(conn)
                last_db = time.monotonic()
            start = latest.get(security_id) or backfill_start
            if start >= end:
                continue

            # Rate-limit-aware fetch: NEVER skip a ticker because of a throttle.
            # Short escalating cooldowns first; if those are exhausted we're in a
            # sustained ban, so take a long global cooldown and keep retrying the
            # SAME ticker. Only a non-rate-limit error or a true empty moves on.
            # A bounded number of long waits guards against an indefinite ban.
            df = None
            rl_hits = 0
            give_up = False
            while True:
                try:
                    df = provider.fetch(ticker, start, end)
                    break
                except Exception as exc:  # noqa: BLE001
                    if not _is_rate_limit(exc):
                        failed += 1
                        warnings.append(f"{ticker}: fetch failed - {exc!r}")
                        break
                    if rl_hits < max_consecutive_rate_limits:
                        nap = cooldowns[min(rl_hits, len(cooldowns) - 1)]
                        print(
                            f"[bulk] rate-limited at #{i} {ticker}; "
                            f"cooldown {nap}s (hit {rl_hits + 1})",
                            flush=True,
                        )
                        time.sleep(nap)
                        rl_hits += 1
                        continue
                    # Sustained ban: long global cooldown, then keep trying.
                    if long_waits >= max_long_waits:
                        failed += 1
                        warnings.append(f"{ticker}: gave up after {long_waits} long bans")
                        give_up = True
                        break
                    long_waits += 1
                    print(
                        f"[bulk] SUSTAINED BAN at #{i} {ticker}; long cooldown "
                        f"{long_ban_sleep}s ({long_waits}/{max_long_waits})",
                        flush=True,
                    )
                    time.sleep(long_ban_sleep)
                    rl_hits = 0  # reset short-cooldown ladder and retry same ticker
                    continue
            if give_up:
                # Ban outlasted our patience budget — stop the run cleanly so it
                # can be resumed later (only_missing picks up where we left off).
                warnings.append("run aborted: sustained ban exceeded patience budget")
                break

            if df is None:
                time.sleep(THROTTLE_SECONDS)
                continue
            if df.empty:
                empty += 1
                time.sleep(THROTTLE_SECONDS)
                continue

            # If the connection has been idle past the staleness window (e.g. we
            # just slept through a rate-limit cooldown), reopen it before writing
            # so we never block on a pooler-dropped half-open socket.
            if conn.closed or (time.monotonic() - last_db) > stale_after_seconds:
                conn = _reopen(conn)
                last_db = time.monotonic()

            wrote = False
            for db_attempt in range(2):  # one reconnect-and-retry on write failure
                try:
                    with conn.cursor() as cur:
                        n = _upsert_prices(cur, security_id, df)
                        s, d = _upsert_actions(cur, security_id, df)
                    conn.commit()
                    wrote = True
                    last_db = time.monotonic()
                    break
                except Exception as exc:  # noqa: BLE001
                    try:
                        conn.rollback()
                    except Exception:  # noqa: BLE001
                        pass
                    if db_attempt == 0:
                        conn = _reopen(conn)  # stale/broken socket — retry fresh
                        last_db = time.monotonic()
                        continue
                    failed += 1
                    warnings.append(f"{ticker}: db write failed - {exc!r}")
            if not wrote:
                time.sleep(THROTTLE_SECONDS)
                continue

            loaded += 1
            total_rows += n
            total_splits += s
            total_dividends += d
            if i % log_every == 0:
                print(
                    f"[bulk] {i}/{scope} processed | loaded={loaded} "
                    f"empty={empty} failed={failed} rows={total_rows}",
                    flush=True,
                )
            time.sleep(THROTTLE_SECONDS)

        if conn.closed or (time.monotonic() - last_db) > stale_after_seconds:
            conn = _reopen(conn)
        finish_job(
            conn, job_id, status="success",
            rows_affected=total_rows, warnings=warnings or None,
        )
    except Exception as exc:  # noqa: BLE001
        try:
            conn = _reopen(conn)  # ensure a live connection to record the failure
            finish_job(conn, job_id, status="failed", error=str(exc), warnings=warnings or None)
        except Exception:  # noqa: BLE001
            pass
        raise
    finally:
        try:
            if conn is not None and not conn.closed:
                conn.close()
        except Exception:  # noqa: BLE001
            pass

    print(
        f"[bulk] DONE: loaded={loaded} empty={empty} failed={failed} "
        f"rows={total_rows} splits={total_splits} divs={total_dividends}",
        flush=True,
    )
    return {
        "tickers_total": scope,
        "tickers_loaded": loaded,
        "tickers_empty": empty,
        "tickers_failed": failed,
        "price_rows_upserted": total_rows,
        "splits_captured": total_splits,
        "dividends_captured": total_dividends,
        "warnings": warnings,
        "job_id": job_id,
    }


def run(provider: PriceProvider | None = None, limit: int | None = None) -> dict:
    """Ingest prices + corporate actions for the universe. Returns a summary."""
    provider = provider or YFinanceProvider()
    today = datetime.now(UTC).date()
    end = today + timedelta(days=1)  # yfinance end is exclusive
    backfill_start = today - timedelta(days=365 * BACKFILL_YEARS)

    warnings: list[str] = []
    tickers_loaded = 0
    tickers_failed = 0
    tickers_empty = 0
    total_rows = 0
    total_splits = 0
    total_dividends = 0

    conn = get_connection()
    job_id = start_job(conn, JOB_NAME, job_version=JOB_VERSION, data_date=today)

    try:
        with conn.cursor() as cur:
            universe = _load_universe(cur)
            latest = _latest_dates(cur)

        if limit is not None:
            universe = universe[:limit]

        for security_id, ticker in universe:
            start = latest.get(security_id)
            # Incremental: refetch from last stored date (re-upsert it) forward.
            start = start if start is not None else backfill_start
            if start >= end:
                continue
            try:
                df = provider.fetch(ticker, start, end)
            except Exception as exc:  # noqa: BLE001
                tickers_failed += 1
                warnings.append(f"{ticker}: fetch failed - {exc!r}")
                time.sleep(THROTTLE_SECONDS)
                continue

            if df is None or df.empty:
                tickers_empty += 1
                warnings.append(f"{ticker}: no data returned for {start}..{today}")
                time.sleep(THROTTLE_SECONDS)
                continue

            try:
                with conn.cursor() as cur:
                    n = _upsert_prices(cur, security_id, df)
                    s, d = _upsert_actions(cur, security_id, df)
                conn.commit()
            except Exception as exc:  # noqa: BLE001
                conn.rollback()
                tickers_failed += 1
                warnings.append(f"{ticker}: db write failed - {exc!r}")
                time.sleep(THROTTLE_SECONDS)
                continue

            tickers_loaded += 1
            total_rows += n
            total_splits += s
            total_dividends += d
            time.sleep(THROTTLE_SECONDS)

        finish_job(
            conn,
            job_id,
            status="success",
            rows_affected=total_rows,
            warnings=warnings or None,
        )
    except Exception as exc:  # noqa: BLE001
        conn.rollback()
        finish_job(conn, job_id, status="failed", error=str(exc), warnings=warnings or None)
        conn.close()
        raise
    finally:
        if not conn.closed:
            conn.close()

    return {
        "tickers_total": len(universe),
        "tickers_loaded": tickers_loaded,
        "tickers_empty": tickers_empty,
        "tickers_failed": tickers_failed,
        "price_rows_upserted": total_rows,
        "splits_captured": total_splits,
        "dividends_captured": total_dividends,
        "warnings": warnings,
        "job_id": job_id,
    }

"""Stock Research Cockpit — Streamlit front end (read-only).

Routing: st.session_state.page ∈ {"screener", "deepdive"}
         st.session_state.selected_ticker: str | None

All DB reads are wrapped in @st.cache_data(ttl=600) so the Supabase free tier
is not hammered on every widget interaction.

Visual design adapted from the "Inviting Stock Picker" reference (light,
card-based fintech dashboard) — with the recommendation-flavored copy
("Top Picks", "AI-powered") deliberately replaced by ranking-honest language.
"""
from __future__ import annotations

import json
import sys
from datetime import date
from html import escape
from pathlib import Path

import pandas as pd
import plotly.graph_objects as go
import streamlit as st

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from engine.db import get_connection  # noqa: E402

# ── page config ───────────────────────────────────────────────────────────────
st.set_page_config(
    page_title="Stock Research Cockpit",
    page_icon="📈",
    layout="wide",
    initial_sidebar_state="expanded",
)

# ── design tokens / CSS ───────────────────────────────────────────────────────
FACTOR_COLORS = {
    "growth": "#3b82f6",    # blue
    "value": "#10b981",     # emerald
    "quality": "#a855f7",   # purple
    "momentum": "#f59e0b",  # amber
}

FEATURED_GRADIENTS = [
    ("#10b981", "#059669"),  # emerald
    ("#3b82f6", "#2563eb"),  # blue
    ("#a855f7", "#9333ea"),  # purple
]

APP_CSS = """
.stApp { background: linear-gradient(135deg, #eff6ff 0%, #ffffff 45%, #eef2ff 100%); }
header[data-testid="stHeader"] { background: transparent; }
.block-container { padding-top: 2.4rem; max-width: 1380px; }

section[data-testid="stSidebar"] { background: #ffffff; border-right: 1px solid #e5e7eb; }

div[data-testid="stVerticalBlockBorderWrapper"] {
  background: #ffffff;
  border: 1px solid #e5e7eb !important;
  border-radius: 14px;
  box-shadow: 0 1px 3px rgba(15,23,42,.06);
}

/* page header */
.ck-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; }
.ck-title { font-size: 2.05rem; font-weight: 800; margin: 0; line-height: 1.25;
  background: linear-gradient(90deg, #2563eb, #4f46e5);
  -webkit-background-clip: text; background-clip: text; color: transparent; }
.ck-sub { color: #4b5563; margin: .4rem 0 0 0; font-size: .95rem; }
.ck-disclaimer { color: #9ca3af; margin: .25rem 0 0 0; font-size: .8rem; }
.ck-right { text-align: right; white-space: nowrap; }
.live-row { display: flex; align-items: center; justify-content: flex-end; gap: 7px;
  color: #4b5563; font-size: .8rem; }
.live-dot { width: 8px; height: 8px; border-radius: 50%; background: #22c55e;
  animation: ckpulse 2s ease-in-out infinite; }
.live-dot.stale { background: #f59e0b; animation: none; }
@keyframes ckpulse { 0%,100% {opacity: 1;} 50% {opacity: .35;} }
.ck-date-label { color: #6b7280; font-size: .78rem; margin-top: 8px; }
.ck-date { font-weight: 700; color: #111827; font-size: 1.1rem; }

/* stat tiles */
.stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px;
  margin: 20px 0 4px 0; }
.stat-card { background: #fff; border: 1px solid #e5e7eb; border-radius: 14px; padding: 18px;
  display: flex; justify-content: space-between; align-items: flex-start;
  box-shadow: 0 1px 2px rgba(15,23,42,.05); }
.stat-label { color: #6b7280; font-size: .82rem; margin: 0; }
.stat-value { font-size: 1.9rem; font-weight: 800; color: #111827; margin: .25rem 0 0 0;
  line-height: 1.2; }
.stat-sub { color: #9ca3af; font-size: .75rem; margin: .3rem 0 0 0; }
.stat-icon { width: 46px; height: 46px; border-radius: 12px; display: flex; align-items: center;
  justify-content: center; font-size: 1.25rem; border: 1px solid; flex: none; }
.stat-icon.blue    { background: #eff6ff; border-color: #bfdbfe; }
.stat-icon.emerald { background: #ecfdf5; border-color: #a7f3d0; }
.stat-icon.purple  { background: #faf5ff; border-color: #e9d5ff; }
.stat-icon.amber   { background: #fffbeb; border-color: #fde68a; }

/* featured cards */
.feat-card { background: #fff; border: 1px solid #e5e7eb; border-radius: 14px; overflow: hidden;
  box-shadow: 0 4px 14px rgba(15,23,42,.08); }
.feat-top { padding: 16px 16px 0 16px; color: #fff; }
.feat-top-row { display: flex; justify-content: space-between; align-items: flex-start; }
.feat-company { font-size: .8rem; opacity: .92; }
.feat-ticker { font-size: 1.5rem; font-weight: 800; margin-top: 2px; }
.feat-badge { background: rgba(255,255,255,.22); border-radius: 9px; padding: 4px 10px;
  font-size: .72rem; font-weight: 600; white-space: nowrap; }
.feat-spark { margin: 10px -2px -4px -2px; }
.feat-bottom { padding: 14px 16px; display: flex; justify-content: space-between;
  align-items: flex-end; }
.feat-label { color: #6b7280; font-size: .78rem; }
.feat-score { font-size: 1.7rem; font-weight: 800; color: #111827; line-height: 1.15; }
.feat-price { font-size: 1.25rem; font-weight: 700; color: #111827; }
.feat-chg-up { color: #16a34a; font-size: .8rem; font-weight: 600; }
.feat-chg-dn { color: #dc2626; font-size: .8rem; font-weight: 600; }
.feat-chg-na { color: #9ca3af; font-size: .8rem; }

/* deep-dive header card */
.dd-header { background: #fff; border: 1px solid #e5e7eb; border-radius: 14px; padding: 20px 22px;
  display: flex; justify-content: space-between; align-items: center; gap: 18px;
  box-shadow: 0 1px 3px rgba(15,23,42,.06); flex-wrap: wrap; }
.dd-id { display: flex; gap: 14px; align-items: center; }
.dd-avatar { width: 54px; height: 54px; border-radius: 13px;
  background: linear-gradient(135deg, #3b82f6, #4f46e5); color: #fff; font-weight: 800;
  font-size: 1.15rem; display: flex; align-items: center; justify-content: center; flex: none; }
.dd-ticker { font-size: 1.45rem; font-weight: 800; color: #111827; }
.pill { display: inline-block; background: #f3f4f6; color: #374151; padding: 3px 10px;
  border-radius: 999px; font-size: .72rem; font-weight: 600; margin-left: 8px;
  vertical-align: middle; }
.dd-name { color: #374151; font-size: .95rem; margin-top: 1px; }
.dd-meta { color: #9ca3af; font-size: .78rem; margin-top: 2px; }
.dd-stats { display: flex; gap: 34px; }
.hstat-label { color: #6b7280; font-size: .75rem; }
.hstat-value { font-size: 1.35rem; font-weight: 800; color: #111827; }
.hstat-sub { color: #9ca3af; font-size: .72rem; }

/* factor cards */
.factor-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 14px; }
.factor-card { background: #fff; border: 1px solid #e5e7eb; border-radius: 14px; padding: 16px;
  box-shadow: 0 1px 2px rgba(15,23,42,.05); }
.factor-name { font-size: .78rem; font-weight: 700; color: #6b7280;
  text-transform: uppercase; letter-spacing: .04em; }
.factor-value { font-size: 1.8rem; font-weight: 800; color: #111827; margin: 4px 0 8px 0; }
.factor-value.na { color: #9ca3af; }
.factor-bar { height: 7px; background: #f3f4f6; border-radius: 999px; overflow: hidden; }
.factor-fill { height: 100%; border-radius: 999px; }
.factor-sub { color: #9ca3af; font-size: .72rem; margin-top: 7px; }
.factor-card.fc-comp { background: linear-gradient(135deg, #0f172a, #1e293b);
  border-color: #0f172a; }
.fc-comp .factor-name { color: #94a3b8; }
.fc-comp .factor-value { color: #fff; }
.fc-comp .factor-value.na { color: #64748b; }
.fc-comp .factor-bar { background: rgba(255,255,255,.15); }
.fc-comp .factor-sub { color: #94a3b8; }

@media (max-width: 1100px) {
  .stats-grid { grid-template-columns: repeat(2, 1fr); }
  .factor-grid { grid-template-columns: repeat(2, 1fr); }
  .dd-stats { gap: 20px; }
}
"""

# ── factor / metric metadata ──────────────────────────────────────────────────
FACTOR_DEFS: dict[str, list[tuple[str, str]]] = {
    "growth":   [("revenue_cagr", "higher"), ("eps_growth", "higher")],
    "value":    [("pe", "lower"), ("ps", "lower"),
                 ("ev_ebitda", "lower"), ("fcf_yield", "higher")],
    "quality":  [("gross_margin", "higher"), ("operating_margin", "higher"),
                 ("roic", "higher"), ("debt_to_equity", "lower"),
                 ("net_debt_ebitda", "lower")],
    "momentum": [("r3m", "higher"), ("r6m", "higher"), ("r12m", "higher")],
}

INPUT_LABELS: dict[str, str] = {
    "revenue_cagr": "Revenue CAGR (3y)",
    "eps_growth": "EPS Growth (YoY)",
    "pe": "P / E",
    "ps": "P / S",
    "ev_ebitda": "EV / EBITDA",
    "fcf_yield": "FCF Yield",
    "gross_margin": "Gross Margin",
    "operating_margin": "Op. Margin",
    "roic": "ROIC",
    "debt_to_equity": "Debt / Equity",
    "net_debt_ebitda": "Net Debt / EBITDA",
    "r3m": "3-Month Return",
    "r6m": "6-Month Return",
    "r12m": "12-Month Return",
}

METRIC_DISPLAY_ORDER = [
    "ttm_revenue", "fcf", "ttm_eps",
    "gross_margin", "operating_margin", "roic",
    "debt_to_equity", "net_debt_ebitda", "current_ratio",
    "revenue_cagr", "eps_growth", "share_count_trend",
]

METRIC_LABELS: dict[str, str] = {
    "ttm_revenue": "Revenue (TTM)",
    "fcf": "Free Cash Flow",
    "ttm_eps": "EPS (TTM)",
    "gross_margin": "Gross Margin",
    "operating_margin": "Op. Margin",
    "roic": "ROIC",
    "debt_to_equity": "Debt / Equity",
    "net_debt_ebitda": "Net Debt / EBITDA",
    "current_ratio": "Current Ratio",
    "revenue_cagr": "Revenue CAGR",
    "eps_growth": "EPS Growth",
    "share_count_trend": "Share Count Trend",
}

# Metrics that don't apply to banks / insurance / REITs
FINANCIAL_NULL_METRICS = {"gross_margin", "operating_margin", "current_ratio", "net_debt_ebitda"}
FINANCIAL_SECTORS = {"Financials", "Real Estate"}

# ── number formatters ─────────────────────────────────────────────────────────

def _f(v) -> float | None:
    """Coerce Decimal/None/NaN to float."""
    if v is None:
        return None
    try:
        f = float(v)
        return None if f != f else f  # NaN check
    except (TypeError, ValueError):
        return None


def fmt_pct(v, decimals: int = 1) -> str:
    f = _f(v)
    if f is None:
        return "—"
    return f"{f * 100:.{decimals}f}%"


def fmt_x(v, decimals: int = 1) -> str:
    f = _f(v)
    if f is None:
        return "—"
    return f"{f:.{decimals}f}×"


def fmt_price(v) -> str:
    f = _f(v)
    if f is None:
        return "—"
    return f"${f:,.2f}"


def fmt_money(v) -> str:
    f = _f(v)
    if f is None:
        return "—"
    if abs(f) >= 1e12:
        return f"${f / 1e12:.2f}T"
    if abs(f) >= 1e9:
        return f"${f / 1e9:.1f}B"
    if abs(f) >= 1e6:
        return f"${f / 1e6:.1f}M"
    return f"${f:,.0f}"


def fmt_pctl(v) -> str:
    f = _f(v)
    return "—" if f is None else f"{f:.1f}"


def fmt_input(key: str, v, roic_is_proxy: bool = False) -> str:
    """Format a factor-input value with appropriate units."""
    f = _f(v)
    if f is None:
        return "—"
    if key in ("gross_margin", "operating_margin", "fcf_yield",
               "revenue_cagr", "eps_growth"):
        return fmt_pct(f)
    if key == "roic":
        base = fmt_pct(f)
        return f"{base}*" if roic_is_proxy else base
    if key in ("pe", "ps", "ev_ebitda", "debt_to_equity", "net_debt_ebitda"):
        return fmt_x(f)
    if key in ("r3m", "r6m", "r12m"):
        sign = "+" if f >= 0 else ""
        return f"{sign}{f * 100:.1f}%"
    return f"{f:.4f}"


def fmt_metric(metric: str, v, roic_is_proxy: bool = False) -> str:
    """Format a fundamental_metrics value with appropriate units."""
    f = _f(v)
    if f is None:
        return "—"
    if metric in ("ttm_revenue", "fcf"):
        return fmt_money(f)
    if metric == "ttm_eps":
        return f"${f:.2f}"
    if metric in ("gross_margin", "operating_margin",
                  "revenue_cagr", "eps_growth", "share_count_trend"):
        return fmt_pct(f)
    if metric == "roic":
        base = fmt_pct(f)
        return f"{base}*" if roic_is_proxy else base
    if metric in ("debt_to_equity", "net_debt_ebitda", "current_ratio"):
        return fmt_x(f, decimals=2)
    return f"{f:.4f}"


# ── DB queries — all cached ───────────────────────────────────────────────────

# Pipeline data refreshes once nightly, so a long TTL is safe and spares the
# Supabase free tier; the cache is cleared on demand by the sidebar refresh button.
DATA_TTL = 6 * 3600  # 6 hours


@st.cache_data(ttl=DATA_TTL)
def load_screener_data() -> tuple[pd.DataFrame, object]:
    """All active securities at the latest score_date, joined with last price."""
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT max(score_date) FROM factor_scores")
            score_date = cur.fetchone()[0]
            cur.execute(
                """
                SELECT s.ticker, s.name, s.sector, s.exchange,
                       fs.composite,
                       fs.growth_pctl, fs.value_pctl, fs.quality_pctl, fs.momentum_pctl,
                       lp.close AS last_price
                FROM securities s
                JOIN factor_scores fs
                    ON fs.security_id = s.security_id AND fs.score_date = %s
                LEFT JOIN LATERAL (
                    SELECT close FROM prices_daily p
                    WHERE p.security_id = s.security_id
                    ORDER BY p.date DESC LIMIT 1
                ) lp ON true
                WHERE s.is_active
                ORDER BY fs.composite DESC NULLS LAST
                """,
                (score_date,),
            )
            rows = cur.fetchall()
            cols = [d[0] for d in cur.description]
    finally:
        conn.close()

    df = pd.DataFrame(rows, columns=cols)
    for col in ("composite", "growth_pctl", "value_pctl",
                "quality_pctl", "momentum_pctl", "last_price"):
        df[col] = pd.to_numeric(df[col], errors="coerce")
    df["rank"] = df["composite"].rank(ascending=False, method="min").astype("Int64")
    return df, score_date


@st.cache_data(ttl=DATA_TTL, max_entries=128)
def load_company_header(ticker: str) -> dict | None:
    """Security info + latest factor_scores row + last price for one ticker."""
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT s.security_id, s.ticker, s.name, s.sector,
                       s.exchange, s.industry,
                       fs.score_date, fs.composite,
                       fs.growth_pctl, fs.value_pctl,
                       fs.quality_pctl, fs.momentum_pctl,
                       fs.details,
                       lp.close AS last_price, lp.date AS price_date
                FROM securities s
                LEFT JOIN factor_scores fs
                    ON fs.security_id = s.security_id
                    AND fs.score_date = (SELECT max(score_date) FROM factor_scores)
                LEFT JOIN LATERAL (
                    SELECT close, date FROM prices_daily p
                    WHERE p.security_id = s.security_id
                    ORDER BY p.date DESC LIMIT 1
                ) lp ON true
                WHERE s.ticker = %s AND s.is_active
                """,
                (ticker,),
            )
            row = cur.fetchone()
            if row is None:
                return None
            cols = [d[0] for d in cur.description]
    finally:
        conn.close()

    d = dict(zip(cols, row, strict=True))
    if d.get("details") is not None and isinstance(d["details"], str):
        d["details"] = json.loads(d["details"])
    for key in ("composite", "growth_pctl", "value_pctl",
                "quality_pctl", "momentum_pctl", "last_price"):
        d[key] = _f(d.get(key))
    return d


@st.cache_data(ttl=DATA_TTL, max_entries=128)
def load_price_history(ticker: str) -> pd.DataFrame:
    """adj_close + close price history for one ticker."""
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT p.date, p.adj_close, p.close
                FROM prices_daily p
                JOIN securities s ON s.security_id = p.security_id
                WHERE s.ticker = %s AND s.is_active
                ORDER BY p.date
                """,
                (ticker,),
            )
            rows = cur.fetchall()
    finally:
        conn.close()

    if not rows:
        return pd.DataFrame(columns=["date", "adj_close", "close"])
    df = pd.DataFrame(rows, columns=["date", "adj_close", "close"])
    df["date"] = pd.to_datetime(df["date"])
    df["adj_close"] = pd.to_numeric(df["adj_close"], errors="coerce")
    df["close"] = pd.to_numeric(df["close"], errors="coerce")
    return df


@st.cache_data(ttl=DATA_TTL, max_entries=128)
def load_fundamental_metrics(ticker: str) -> pd.DataFrame:
    """fundamental_metrics pivoted: index=as_of_date DESC, columns=metric."""
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT fm.as_of_date, fm.metric, fm.value
                FROM fundamental_metrics fm
                JOIN securities s ON s.security_id = fm.security_id
                WHERE s.ticker = %s AND s.is_active AND fm.metric_version = 'v1'
                ORDER BY fm.as_of_date DESC
                """,
                (ticker,),
            )
            rows = cur.fetchall()
    finally:
        conn.close()

    if not rows:
        return pd.DataFrame()
    df = pd.DataFrame(rows, columns=["as_of_date", "metric", "value"])
    df["value"] = pd.to_numeric(df["value"], errors="coerce")
    pivoted = df.pivot_table(
        index="as_of_date", columns="metric", values="value", aggfunc="first"
    )
    pivoted.index = pd.to_datetime(pivoted.index)
    pivoted.sort_index(ascending=False, inplace=True)
    return pivoted


@st.cache_data(ttl=DATA_TTL, max_entries=32)
def load_sparklines(tickers: tuple[str, ...], n: int = 30) -> dict[str, list[float]]:
    """Last `n` adj_close points per ticker in ONE query (oldest→newest).

    Used by the featured cards: cheap bounded fetch instead of pulling each
    ticker's full multi-year history just to draw a 30-point sparkline.
    """
    if not tickers:
        return {}
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT ticker, adj_close FROM (
                    SELECT s.ticker, p.adj_close, p.date,
                           row_number() OVER (PARTITION BY p.security_id
                                              ORDER BY p.date DESC) AS rn
                    FROM prices_daily p
                    JOIN securities s ON s.security_id = p.security_id
                    WHERE s.ticker = ANY(%s) AND s.is_active
                ) t
                WHERE rn <= %s
                ORDER BY ticker, date
                """,
                (list(tickers), n),
            )
            rows = cur.fetchall()
    finally:
        conn.close()

    out: dict[str, list[float]] = {t: [] for t in tickers}
    for ticker, adj_close in rows:
        f = _f(adj_close)
        if f is not None:
            out.setdefault(ticker, []).append(f)
    return out


# ── HTML builders ─────────────────────────────────────────────────────────────

def svg_sparkline(vals: list[float], w: int = 280, h: int = 56,
                  stroke: str = "#ffffff") -> str:
    """Inline SVG line chart for a short series; '' if not enough data."""
    pts_vals = [v for v in vals if v is not None]
    if len(pts_vals) < 2:
        return ""
    mn, mx = min(pts_vals), max(pts_vals)
    rng = (mx - mn) or 1.0
    pts = []
    for i, v in enumerate(pts_vals):
        x = i * w / (len(pts_vals) - 1)
        y = (h - 6) - (v - mn) / rng * (h - 12)
        pts.append(f"{x:.1f},{y:.1f}")
    points = " ".join(pts)
    return (
        f'<svg width="100%" height="{h}" viewBox="0 0 {w} {h}" '
        f'preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">'
        f'<polyline fill="none" stroke="{stroke}" stroke-width="2.5" '
        f'stroke-linecap="round" stroke-linejoin="round" points="{points}"/></svg>'
    )


def screener_header_html(score_date, stale_days: int | None) -> str:
    # Only claim freshness the data actually supports: a green pulse means the
    # latest scores are recent; amber (static) means the pipeline looks stale.
    if stale_days is not None and stale_days > 3:
        dot_cls, status = "live-dot stale", f"Scores {stale_days} days old"
    else:
        dot_cls, status = "live-dot", "Refreshed nightly"
    return (
        '<div class="ck-header">'
        "<div>"
        '<h1 class="ck-title">S&amp;P 500 Factor Screener</h1>'
        '<p class="ck-sub">Quantitative factor rankings — growth · value · quality · momentum</p>'
        '<p class="ck-disclaimer">Composite is a cross-sectional ranking within the S&amp;P 500 '
        "universe (100 = top). It is <b>not</b> a buy signal or return prediction.</p>"
        "</div>"
        '<div class="ck-right">'
        f'<div class="live-row"><span class="{dot_cls}"></span>{status}</div>'
        '<div class="ck-date-label">Scores as of</div>'
        f'<div class="ck-date">{escape(str(score_date))}</div>'
        "</div></div>"
    )


def stats_row_html(df: pd.DataFrame) -> str:
    total = len(df)
    ranked = int(df["composite"].notna().sum())
    full_cov = int(
        (df["growth_pctl"].notna() & df["value_pctl"].notna()
         & df["quality_pctl"].notna() & df["momentum_pctl"].notna()).sum()
    )
    sectors = int(df["sector"].nunique(dropna=True))
    tiles = [
        ("Companies ranked", f"{ranked:,}", f"of {total:,} in the active universe", "📊", "blue"),
        ("Full factor coverage", f"{full_cov:,}", "have all four factor scores", "🎯", "emerald"),
        ("Sectors", f"{sectors}", "GICS sectors covered", "🗂️", "purple"),
        ("Factors", "4", "growth · value · quality · momentum", "⚖️", "amber"),
    ]
    cards = "".join(
        '<div class="stat-card"><div>'
        f'<p class="stat-label">{label}</p>'
        f'<p class="stat-value">{value}</p>'
        f'<p class="stat-sub">{sub}</p>'
        f'</div><div class="stat-icon {color}">{icon}</div></div>'
        for label, value, sub, icon, color in tiles
    )
    return f'<div class="stats-grid">{cards}</div>'


def featured_card_html(rank: int, ticker: str, name: str, composite: float,
                       price, spark_vals: list[float],
                       grad: tuple[str, str]) -> str:
    spark = svg_sparkline(spark_vals)
    if len(spark_vals) >= 2 and spark_vals[-2]:
        chg = (spark_vals[-1] - spark_vals[-2]) / spark_vals[-2]
        arrow, cls = ("▲", "feat-chg-up") if chg >= 0 else ("▼", "feat-chg-dn")
        chg_html = f'<div class="{cls}">{arrow} {abs(chg) * 100:.1f}% (1d)</div>'
    else:
        chg_html = '<div class="feat-chg-na">—</div>'
    return (
        '<div class="feat-card">'
        f'<div class="feat-top" style="background:linear-gradient(135deg,{grad[0]},{grad[1]})">'
        '<div class="feat-top-row"><div>'
        f'<div class="feat-company">{escape(name or "")}</div>'
        f'<div class="feat-ticker">{escape(ticker)}</div>'
        f'</div><div class="feat-badge">#{rank} Composite</div></div>'
        f'<div class="feat-spark">{spark}</div>'
        "</div>"
        '<div class="feat-bottom"><div>'
        '<div class="feat-label">Composite</div>'
        f'<div class="feat-score">{composite:.1f}</div>'
        '</div><div style="text-align:right">'
        f'<div class="feat-price">{fmt_price(price)}</div>{chg_html}'
        "</div></div></div>"
    )


def deepdive_header_html(info: dict, rank, total: int) -> str:
    ticker = info["ticker"]
    sector = info.get("sector") or "—"
    exchange = info.get("exchange") or "—"
    industry = info.get("industry") or "—"
    comp = info.get("composite")
    score_date = info.get("score_date")
    if comp is not None:
        comp_value = f"{comp:.1f}"
        comp_sub = f"#{rank} of {total} by composite" if rank is not None else "vs S&amp;P 500"
    else:
        comp_value = "n/a"
        comp_sub = "no factor scores"
    price_sub = (
        f"as of {escape(str(info['price_date']))}" if info.get("price_date") else ""
    )
    return (
        '<div class="dd-header">'
        '<div class="dd-id">'
        f'<div class="dd-avatar">{escape(ticker[:2].upper())}</div>'
        "<div>"
        f'<span class="dd-ticker">{escape(ticker)}</span>'
        f'<span class="pill">{escape(sector)}</span>'
        f'<div class="dd-name">{escape(info.get("name") or "")}</div>'
        f'<div class="dd-meta">{escape(exchange)} · {escape(industry)}</div>'
        "</div></div>"
        '<div class="dd-stats">'
        '<div><div class="hstat-label">Last price</div>'
        f'<div class="hstat-value">{fmt_price(info.get("last_price"))}</div>'
        f'<div class="hstat-sub">{price_sub}</div></div>'
        '<div><div class="hstat-label">Composite</div>'
        f'<div class="hstat-value">{comp_value}</div>'
        f'<div class="hstat-sub">{comp_sub}</div></div>'
        '<div><div class="hstat-label">Score date</div>'
        f'<div class="hstat-value">{escape(str(score_date)) if score_date else "n/a"}</div>'
        '<div class="hstat-sub">latest pipeline run</div></div>'
        "</div></div>"
    )


def factor_cards_html(factor_pctls: dict, composite, rank, total: int) -> str:
    cards = []
    for factor in ("growth", "value", "quality", "momentum"):
        v = factor_pctls.get(factor)
        color = FACTOR_COLORS[factor]
        if v is None:
            sub = "no value factor" if factor == "value" else "data unavailable"
            cards.append(
                '<div class="factor-card">'
                f'<div class="factor-name">{factor}</div>'
                '<div class="factor-value na">n/a</div>'
                '<div class="factor-bar"></div>'
                f'<div class="factor-sub">{sub}</div></div>'
            )
        else:
            cards.append(
                '<div class="factor-card">'
                f'<div class="factor-name">{factor}</div>'
                f'<div class="factor-value">{v:.1f}</div>'
                '<div class="factor-bar">'
                f'<div class="factor-fill" style="width:{min(max(v, 0), 100):.0f}%;'
                f'background:{color}"></div></div>'
                '<div class="factor-sub">percentile rank</div></div>'
            )
    if composite is not None:
        comp_value = f'<div class="factor-value">{composite:.1f}</div>'
        comp_sub = f"#{rank} of {total}" if rank is not None else "weighted blend"
        comp_bar = (
            '<div class="factor-bar"><div class="factor-fill" '
            f'style="width:{min(max(composite, 0), 100):.0f}%;background:#60a5fa"></div></div>'
        )
    else:
        comp_value = '<div class="factor-value na">n/a</div>'
        comp_sub = "no factor scores"
        comp_bar = '<div class="factor-bar"></div>'
    cards.append(
        '<div class="factor-card fc-comp">'
        '<div class="factor-name">Composite</div>'
        f"{comp_value}{comp_bar}"
        f'<div class="factor-sub">{comp_sub}</div></div>'
    )
    return f'<div class="factor-grid">{"".join(cards)}</div>'


def _nav_to(ticker: str) -> None:
    st.session_state.page = "deepdive"
    st.session_state.selected_ticker = ticker
    st.query_params["ticker"] = ticker
    st.rerun()


# ── screener page ─────────────────────────────────────────────────────────────

def show_screener() -> None:
    df, score_date = load_screener_data()

    # sidebar ─────────────────────────────────────────────────────────────────
    with st.sidebar:
        st.markdown("## 📈 Research Cockpit")
        st.caption("S&P 500 · Factor screener")
        if st.button("↻ Refresh data", width="stretch",
                     help="Re-query the database now (data otherwise refreshes nightly)"):
            st.cache_data.clear()
            st.rerun()
        st.markdown("---")
        st.markdown("### Filters")

        search = st.text_input("Ticker / company search", placeholder="AAPL, Apple…")

        sectors = sorted(df["sector"].dropna().unique().tolist())
        sel_sectors = st.multiselect("Sector", sectors)

        st.markdown("**Composite score range**")
        comp_min, comp_max = st.slider(
            "Composite", 0.0, 100.0, (0.0, 100.0), 1.0,
            label_visibility="collapsed",
        )
        with st.expander("Per-factor ranges"):
            g_min, g_max = st.slider("Growth", 0.0, 100.0, (0.0, 100.0), 1.0)
            v_min, v_max = st.slider("Value", 0.0, 100.0, (0.0, 100.0), 1.0)
            q_min, q_max = st.slider("Quality", 0.0, 100.0, (0.0, 100.0), 1.0)
            m_min, m_max = st.slider("Momentum", 0.0, 100.0, (0.0, 100.0), 1.0)

        st.markdown("---")
        st.markdown("### Open deep-dive")
        go_ticker = st.selectbox(
            "Select ticker", [""] + sorted(df["ticker"].tolist()), index=0,
            label_visibility="collapsed",
        )
        if go_ticker and st.button(f"Open {go_ticker} →", width="stretch"):
            _nav_to(go_ticker)

    # apply filters ───────────────────────────────────────────────────────────
    view = df.copy()
    if search:
        # regex=False: treat the query literally so metacharacters like "(" or
        # "BRK.B" don't raise a regex-compile error mid-typing.
        q = search.strip()
        mask = (
            view["ticker"].str.contains(q, case=False, na=False, regex=False)
            | view["name"].str.contains(q, case=False, na=False, regex=False)
        )
        view = view[mask]
    if sel_sectors:
        view = view[view["sector"].isin(sel_sectors)]

    def _prange(series: pd.Series, lo: float, hi: float) -> pd.Series:
        return series.isna() | ((series >= lo) & (series <= hi))

    view = view[
        _prange(view["composite"], comp_min, comp_max)
        & _prange(view["growth_pctl"], g_min, g_max)
        & _prange(view["value_pctl"], v_min, v_max)
        & _prange(view["quality_pctl"], q_min, q_max)
        & _prange(view["momentum_pctl"], m_min, m_max)
    ]

    # header + stat tiles ─────────────────────────────────────────────────────
    stale_days = None
    if isinstance(score_date, date):
        stale_days = (date.today() - score_date).days
    st.markdown(APP_CSS_TAG, unsafe_allow_html=True)
    st.markdown(screener_header_html(score_date, stale_days), unsafe_allow_html=True)
    st.markdown(stats_row_html(df), unsafe_allow_html=True)

    # featured: top 3 by composite ────────────────────────────────────────────
    st.markdown("#### Highest composite rankings")
    st.caption(
        "The three top-ranked companies at the latest score date. "
        "A high ranking means strong relative factor readings — it is not a recommendation."
    )
    top3 = df[df["composite"].notna()].head(3)
    sparks = load_sparklines(tuple(top3["ticker"].tolist()))
    feat_cols = st.columns(3)
    for i, (_, row) in enumerate(top3.iterrows()):
        spark_vals = sparks.get(row["ticker"], [])
        with feat_cols[i]:
            st.markdown(
                featured_card_html(
                    int(row["rank"]) if pd.notna(row["rank"]) else i + 1,
                    row["ticker"], row["name"], row["composite"],
                    row["last_price"], spark_vals, FEATURED_GRADIENTS[i],
                ),
                unsafe_allow_html=True,
            )
            if st.button(f"View {row['ticker']} analysis →",
                         key=f"feat_{row['ticker']}", width="stretch"):
                _nav_to(row["ticker"])

    # table ───────────────────────────────────────────────────────────────────
    with st.container(border=True):
        tc1, tc2 = st.columns([4, 1])
        with tc1:
            st.markdown("#### All companies")
            st.caption(
                f"Showing **{len(view):,}** of {len(df):,} companies · "
                "click a row to open its deep-dive · click headers to sort"
            )

        display = view[[
            "rank", "ticker", "name", "sector",
            "composite", "growth_pctl", "value_pctl", "quality_pctl", "momentum_pctl",
            "last_price",
        ]].copy().reset_index(drop=True)

        for col in ("composite", "growth_pctl", "value_pctl", "quality_pctl", "momentum_pctl"):
            display[col] = display[col].round(1)

        event = st.dataframe(
            display,
            width="stretch",
            hide_index=True,
            height=580,
            on_select="rerun",
            selection_mode="single-row",
            column_config={
                "rank": st.column_config.NumberColumn("#", width=50, format="%d"),
                "ticker": st.column_config.TextColumn("Ticker", width=75),
                "name": st.column_config.TextColumn("Company", width=200),
                "sector": st.column_config.TextColumn("Sector", width=165),
                "composite": st.column_config.ProgressColumn(
                    "Composite", min_value=0, max_value=100, format="%.1f", width=130
                ),
                "growth_pctl": st.column_config.ProgressColumn(
                    "Growth", min_value=0, max_value=100, format="%.1f", width=110
                ),
                "value_pctl": st.column_config.ProgressColumn(
                    "Value", min_value=0, max_value=100, format="%.1f", width=110
                ),
                "quality_pctl": st.column_config.ProgressColumn(
                    "Quality", min_value=0, max_value=100, format="%.1f", width=110
                ),
                "momentum_pctl": st.column_config.ProgressColumn(
                    "Momentum", min_value=0, max_value=100, format="%.1f", width=110
                ),
                "last_price": st.column_config.NumberColumn(
                    "Last Price", format="$%.2f", width=95
                ),
            },
        )

    # row selection → deep-dive
    if event.selection and event.selection.rows:
        sel_ticker = display.iloc[event.selection.rows[0]]["ticker"]
        _nav_to(sel_ticker)


# ── deep-dive page ────────────────────────────────────────────────────────────

def show_deepdive(ticker: str) -> None:
    st.markdown(APP_CSS_TAG, unsafe_allow_html=True)
    info = load_company_header(ticker)
    price_df = load_price_history(ticker)

    # sidebar ─────────────────────────────────────────────────────────────────
    with st.sidebar:
        if st.button("← Back to Screener", width="stretch", type="primary"):
            st.session_state.page = "screener"
            st.session_state.selected_ticker = None
            st.query_params.clear()
            st.rerun()
        st.markdown("---")
        if info:
            st.markdown(f"**{info['ticker']}** — {info.get('name', '')}")
            st.caption(f"{info.get('sector') or '—'} · {info.get('exchange') or '—'}")
        st.markdown("---")
        _, sd = load_screener_data()
        st.caption(f"Universe score date: {sd}")

    if info is None:
        st.error(f"Ticker **{ticker}** not found in the active universe.")
        return

    details = info.get("details") or {}
    inputs = details.get("inputs", {})
    sub_pctls = details.get("sub_pctls", {})
    flags = details.get("flags", {})
    roic_is_proxy = flags.get("roic_pool") == "roa_proxy"
    is_financial = (info.get("sector") or "") in FINANCIAL_SECTORS

    # A factor_scores row can exist with every score NULL (no computable
    # factors yet) — treat that the same as "no scores".
    has_scores = info.get("composite") is not None or any(
        info.get(k) is not None
        for k in ("growth_pctl", "value_pctl", "quality_pctl", "momentum_pctl")
    )
    metrics_df = load_fundamental_metrics(ticker)
    has_fundamentals = not metrics_df.empty

    # composite rank within universe
    uni_df, _ = load_screener_data()
    ranked = uni_df[uni_df["composite"].notna()]
    total_ranked = len(ranked)
    rank_row = ranked[ranked["ticker"] == ticker]
    rank = int(rank_row["rank"].iloc[0]) if not rank_row.empty else None

    # header card ─────────────────────────────────────────────────────────────
    st.markdown(deepdive_header_html(info, rank, total_ranked), unsafe_allow_html=True)
    st.markdown("")

    # price chart ─────────────────────────────────────────────────────────────
    with st.container(border=True):
        ch1, ch2 = st.columns([3, 1])
        with ch1:
            st.markdown("#### Price history")
            st.caption("Adjusted close (splits & dividends applied) · up to 5 years")
        with ch2:
            # History is backfilled to ~5 years, so 5Y already shows everything —
            # no separate "Max" range (it would be identical).
            period = st.segmented_control(
                "Range", ["1Y", "3Y", "5Y"], default="1Y",
                label_visibility="collapsed",
            ) or "1Y"

        if price_df.empty:
            st.info("No price data available.")
        else:
            days = {"1Y": 365, "3Y": 3 * 365, "5Y": 5 * 365}[period]
            cutoff = price_df["date"].max() - pd.Timedelta(days=days)
            chart = price_df[price_df["date"] >= cutoff]

            if chart.empty:
                st.info(f"No price data for the {period} range.")
            else:
                fig = go.Figure()
                fig.add_trace(go.Scatter(
                    x=chart["date"], y=chart["adj_close"],
                    mode="lines", line={"color": "#2563eb", "width": 2},
                    name="Adj. Close",
                    hovertemplate="%{x|%b %d, %Y}: $%{y:,.2f}<extra></extra>",
                ))
                fig.update_layout(
                    height=240,
                    margin={"l": 0, "r": 10, "t": 6, "b": 10},
                    xaxis={"showgrid": False},
                    yaxis={"tickprefix": "$", "showgrid": True, "gridcolor": "#eef2f7"},
                    plot_bgcolor="rgba(0,0,0,0)",
                    paper_bgcolor="rgba(0,0,0,0)",
                    hovermode="x unified",
                    showlegend=False,
                )
                st.plotly_chart(fig, width="stretch", config={"displayModeBar": False})

    # no-data guard ───────────────────────────────────────────────────────────
    if not has_fundamentals and not has_scores:
        st.info(
            f"**No fundamental data available for {ticker}.** "
            "This security has no XBRL filings yet (likely a recent spinoff or IPO). "
            "Scores and metrics will populate automatically once filings are ingested "
            "by the weekly pipeline."
        )
        _show_placeholders()
        return

    # factor scores panel ─────────────────────────────────────────────────────
    st.markdown("")
    if not has_scores:
        st.info("No factor scores available for this company.")
    else:
        _show_factor_panel(info, inputs, sub_pctls, flags, roic_is_proxy,
                           rank, total_ranked)

    # fundamentals panel ──────────────────────────────────────────────────────
    st.markdown("")
    if has_fundamentals:
        _show_fundamentals_panel(metrics_df, roic_is_proxy, is_financial)
    else:
        st.info("No fundamental metrics available.")

    _show_placeholders()


# ── factor panel ──────────────────────────────────────────────────────────────

def _show_factor_panel(
    info: dict,
    inputs: dict,
    sub_pctls: dict,
    flags: dict,
    roic_is_proxy: bool,
    rank,
    total_ranked: int,
) -> None:
    factor_pctls = {
        "growth":   info.get("growth_pctl"),
        "value":    info.get("value_pctl"),
        "quality":  info.get("quality_pctl"),
        "momentum": info.get("momentum_pctl"),
    }
    composite = info.get("composite")
    weights = (info.get("details") or {}).get("weights", {})
    weight_str = "  ·  ".join(
        f"{k.capitalize()} {v * 100:.0f}%" for k, v in weights.items()
    )

    st.markdown("#### Factor scores")
    st.caption(
        f"Cross-sectional percentile ranks within the S&P 500 universe (100 = top). "
        f"Weights: {weight_str}."
    )
    st.markdown(
        factor_cards_html(factor_pctls, composite, rank, total_ranked),
        unsafe_allow_html=True,
    )
    if roic_is_proxy:
        st.caption(
            "⚠️ **ROIC shown as ROA proxy** (net income / total assets) — "
            "this company type does not report an operating-income subtotal. "
            "Ranked in a separate pool from true-ROIC companies."
        )
    if flags.get("momentum_basis"):
        st.caption(
            "Momentum = cross-sectional ranking of raw 3/6/12-month adj-close returns "
            "within the universe (no benchmark subtraction in v1)."
        )

    # sub-metric breakdown table
    with st.container(border=True):
        st.markdown("**Sub-metric detail**")
        rows: list[dict] = []
        for factor, defs in FACTOR_DEFS.items():
            factor_v = factor_pctls[factor]

            # Whole factor missing
            if factor_v is None:
                if factor == "value":
                    reason = (
                        "No market cap or share count available — "
                        "likely a multi-class share structure (e.g. BRK-B, V) "
                        "where cover-page share data is class-dimensioned and absent "
                        "from the XBRL companyfacts API."
                    )
                else:
                    reason = "Factor data unavailable."
                rows.append({
                    "Factor": factor.capitalize(),
                    "Metric": f"— {factor.capitalize()} factor n/a",
                    "Value": reason,
                    "Rank": "—",
                    "Better when": "",
                })
                continue

            for metric_key, direction in defs:
                raw = inputs.get(metric_key)
                pctl = sub_pctls.get(metric_key)
                val_str = fmt_input(
                    metric_key, raw,
                    roic_is_proxy=(metric_key == "roic" and roic_is_proxy),
                )
                rows.append({
                    "Factor": factor.capitalize(),
                    "Metric": INPUT_LABELS.get(metric_key, metric_key),
                    "Value": val_str,
                    "Rank": fmt_pctl(pctl),
                    "Better when": "↑ higher" if direction == "higher" else "↓ lower",
                })

        sub_df = pd.DataFrame(rows)
        st.dataframe(
            sub_df,
            width="stretch",
            hide_index=True,
            height=min(40 * len(sub_df) + 42, 520),
            column_config={
                "Factor":      st.column_config.TextColumn("Factor",       width=90),
                "Metric":      st.column_config.TextColumn("Metric",       width=185),
                "Value":       st.column_config.TextColumn("Value",        width=200),
                "Rank":        st.column_config.TextColumn("Rank (0–100)", width=100),
                "Better when": st.column_config.TextColumn("Better when",  width=110),
            },
        )
        if roic_is_proxy:
            st.caption("* ROIC value is ROA (net income ÷ total assets); see note above.")


# ── fundamentals panel ────────────────────────────────────────────────────────

def _show_fundamentals_panel(
    metrics_df: pd.DataFrame,
    roic_is_proxy: bool,
    is_financial: bool,
) -> None:
    with st.container(border=True):
        st.markdown("#### Fundamental metrics — point-in-time history")
        st.caption(
            "Values as known at each filing date (point-in-time correct — restatements "
            "apply forward only, never backward). TTM = trailing twelve months. "
            "Showing the eight most recent filing dates."
        )

        display_dates = metrics_df.head(8)
        # Full date label so two filings in the same calendar month (amendments,
        # transition filings — e.g. TSLA, EBAY) get distinct columns instead of
        # one silently overwriting the other.
        date_cols = [d.strftime("%b %d, %Y") for d in display_dates.index]

        showed_financial_na = False
        rows: list[dict] = []
        for metric in METRIC_DISPLAY_ORDER:
            if metric not in display_dates.columns:
                continue
            label = METRIC_LABELS.get(metric, metric)

            values: dict[str, str] = {}
            for dt, dt_label in zip(display_dates.index, date_cols, strict=True):
                v = display_dates.at[dt, metric]
                if pd.isna(v):
                    # Annotate known structural nulls for financials
                    if is_financial and metric in FINANCIAL_NULL_METRICS:
                        values[dt_label] = "n/a*"
                        showed_financial_na = True
                    else:
                        values[dt_label] = "—"
                else:
                    values[dt_label] = fmt_metric(
                        metric, v,
                        roic_is_proxy=(metric == "roic" and roic_is_proxy),
                    )

            rows.append({"Metric": label, **values})

        if not rows:
            st.info("No metrics available.")
            return

        trend_df = pd.DataFrame(rows).set_index("Metric")
        st.dataframe(trend_df, width="stretch")

        footnotes: list[str] = []
        if roic_is_proxy:
            footnotes.append(
                "* ROIC is shown as ROA (net income ÷ total assets) — "
                "company type does not report an operating-income subtotal. "
                "The proxy flag reflects the latest scoring run; a company's "
                "ROIC basis may differ in earlier periods shown here."
            )
        if showed_financial_na:
            footnotes.append(
                "* n/a for financials: gross margin, operating margin, "
                "current ratio, and net debt/EBITDA are not meaningful for "
                "banks, insurance companies, or REITs."
            )
        for note in footnotes:
            st.caption(note)


# ── placeholder sections ──────────────────────────────────────────────────────

def _show_placeholders() -> None:
    st.markdown("")
    with st.expander("📄 Filing summary — coming in Phase 10", expanded=False):
        st.info(
            "AI-generated summaries of the latest 10-K/10-Q (MD&A + Risk Factors) "
            "will appear here once Phase 10 (AI filing summarizer) is integrated. "
            "The summarizer will call the Anthropic API with structured-output prompts "
            "and cache results by filing accession number."
        )
    with st.expander("⭐ Watchlist & thesis notes — coming next", expanded=False):
        st.info(
            "Watchlist management and per-company thesis notes will be available "
            "in Stage 2. Write features are deliberately excluded from this "
            "read-only cockpit build."
        )


# ── routing ───────────────────────────────────────────────────────────────────

APP_CSS_TAG = f"<style>{APP_CSS}</style>"


def main() -> None:
    if "page" not in st.session_state:
        # First load: honor a ?ticker=XXXX deep link, else land on the screener.
        qp_ticker = st.query_params.get("ticker")
        if qp_ticker:
            st.session_state.page = "deepdive"
            st.session_state.selected_ticker = qp_ticker.strip().upper()
        else:
            st.session_state.page = "screener"
    if "selected_ticker" not in st.session_state:
        st.session_state.selected_ticker = None

    if st.session_state.page == "deepdive" and st.session_state.selected_ticker:
        show_deepdive(st.session_state.selected_ticker)
    else:
        show_screener()


if __name__ == "__main__":
    main()

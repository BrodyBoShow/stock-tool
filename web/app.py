"""Stock Research Cockpit — Streamlit front end (read-only).

Routing: st.session_state.page ∈ {"screener", "deepdive"}
         st.session_state.selected_ticker: str | None

All DB reads are wrapped in @st.cache_data(ttl=600) so the Supabase free tier
is not hammered on every widget interaction.
"""
from __future__ import annotations

import json
import sys
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

FACTOR_COLORS = {
    "growth": "#4CAF50",
    "value": "#2196F3",
    "quality": "#FF9800",
    "momentum": "#9C27B0",
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

@st.cache_data(ttl=600)
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
                LEFT JOIN (
                    SELECT DISTINCT ON (security_id) security_id, close
                    FROM prices_daily ORDER BY security_id, date DESC
                ) lp ON lp.security_id = s.security_id
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
    return df, score_date


@st.cache_data(ttl=600)
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
                LEFT JOIN (
                    SELECT DISTINCT ON (security_id) security_id, close, date
                    FROM prices_daily ORDER BY security_id, date DESC
                ) lp ON lp.security_id = s.security_id
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

    d = dict(zip(cols, row))
    if d.get("details") is not None and isinstance(d["details"], str):
        d["details"] = json.loads(d["details"])
    for key in ("composite", "growth_pctl", "value_pctl",
                "quality_pctl", "momentum_pctl", "last_price"):
        d[key] = _f(d.get(key))
    return d


@st.cache_data(ttl=600)
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


@st.cache_data(ttl=600)
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


# ── screener page ─────────────────────────────────────────────────────────────

def show_screener() -> None:
    df, score_date = load_screener_data()

    # sidebar ─────────────────────────────────────────────────────────────────
    with st.sidebar:
        st.markdown("## 📈 Stock Research Cockpit")
        st.caption("S&P 500 · Factor screener")
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
        if go_ticker and st.button(f"Open {go_ticker} →", use_container_width=True):
            st.session_state.page = "deepdive"
            st.session_state.selected_ticker = go_ticker
            st.rerun()

    # apply filters ───────────────────────────────────────────────────────────
    view = df.copy()
    if search:
        mask = (
            view["ticker"].str.contains(search.upper(), case=False, na=False)
            | view["name"].str.contains(search, case=False, na=False)
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

    # header ──────────────────────────────────────────────────────────────────
    hc1, hc2 = st.columns([4, 1])
    with hc1:
        st.markdown("## S&P 500 Factor Screener")
        st.caption(
            "Composite is a **cross-sectional style ranking** (value / quality / growth / "
            "momentum) within the S&P 500 universe. "
            "100 = top of universe on that factor. "
            "**Not a buy signal or return prediction.** "
            "Scores reflect data as of the pipeline's latest run — see score date →"
        )
    with hc2:
        st.metric("Score date", str(score_date))
        st.caption(f"{len(view):,} of {len(df):,} companies")

    # table ───────────────────────────────────────────────────────────────────
    display = view[[
        "ticker", "name", "sector",
        "composite", "growth_pctl", "value_pctl", "quality_pctl", "momentum_pctl",
        "last_price",
    ]].copy().reset_index(drop=True)

    for col in ("composite", "growth_pctl", "value_pctl", "quality_pctl", "momentum_pctl"):
        display[col] = display[col].round(1)

    event = st.dataframe(
        display,
        use_container_width=True,
        hide_index=True,
        height=580,
        on_select="rerun",
        selection_mode="single-row",
        column_config={
            "ticker": st.column_config.TextColumn("Ticker", width=75),
            "name": st.column_config.TextColumn("Company", width=210),
            "sector": st.column_config.TextColumn("Sector", width=170),
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
        st.session_state.page = "deepdive"
        st.session_state.selected_ticker = sel_ticker
        st.rerun()


# ── deep-dive page ────────────────────────────────────────────────────────────

def show_deepdive(ticker: str) -> None:
    info = load_company_header(ticker)
    price_df = load_price_history(ticker)

    # sidebar ─────────────────────────────────────────────────────────────────
    with st.sidebar:
        if st.button("← Back to Screener", use_container_width=True, type="primary"):
            st.session_state.page = "screener"
            st.session_state.selected_ticker = None
            st.rerun()
        st.markdown("---")
        if info:
            st.markdown(f"**{info['ticker']}**")
            st.markdown(info.get("name", ""))
            st.caption(
                f"{info.get('sector','—')} · "
                f"{info.get('exchange','—')}"
            )
            if info.get("last_price") is not None:
                st.metric("Last Price", fmt_price(info["last_price"]))
            if info.get("composite") is not None:
                st.metric("Composite Score", f"{info['composite']:.1f}")
            else:
                st.metric("Composite Score", "n/a")
        st.markdown("---")
        st.markdown("### Universe")
        _, sd = load_screener_data()
        st.caption(f"Score date: {sd}")

    if info is None:
        st.error(f"Ticker **{ticker}** not found in the active universe.")
        return

    details = info.get("details") or {}
    inputs = details.get("inputs", {})
    sub_pctls = details.get("sub_pctls", {})
    flags = details.get("flags", {})
    roic_is_proxy = flags.get("roic_pool") == "roa_proxy"
    is_financial = info.get("sector", "") in FINANCIAL_SECTORS

    has_scores = info.get("score_date") is not None
    metrics_df = load_fundamental_metrics(ticker)
    has_fundamentals = not metrics_df.empty

    # header strip ────────────────────────────────────────────────────────────
    hc1, hc2, hc3, hc4, hc5 = st.columns([1, 4, 2, 2, 2])
    with hc1:
        st.markdown(f"# {ticker}")
    with hc2:
        st.markdown(f"### {info['name']}")
        st.caption(
            f"{info.get('sector', '—')} · "
            f"{info.get('exchange', '—')} · "
            f"{info.get('industry', '—')}"
        )
    with hc3:
        st.metric("Last Price", fmt_price(info.get("last_price")))
        if info.get("price_date"):
            st.caption(f"as of {info['price_date']}")
    with hc4:
        sd = info.get("score_date")
        st.metric("Score Date", str(sd) if sd else "n/a")
    with hc5:
        comp = info.get("composite")
        st.metric("Composite", f"{comp:.1f}" if comp is not None else "n/a")

    st.markdown("---")

    # price chart ─────────────────────────────────────────────────────────────
    st.markdown("#### Price History  *(adj. close)*")
    if price_df.empty:
        st.info("No price data available.")
    else:
        period = st.radio(
            "Range", ["1Y", "3Y", "5Y"], index=0, horizontal=True,
            label_visibility="collapsed",
        )
        days = {"1Y": 365, "3Y": 3 * 365, "5Y": 5 * 365}[period]
        cutoff = price_df["date"].max() - pd.Timedelta(days=days)
        chart = price_df[price_df["date"] >= cutoff].copy()

        if chart.empty:
            st.info(f"No price data for the {period} range.")
        else:
            fig = go.Figure()
            fig.add_trace(go.Scatter(
                x=chart["date"], y=chart["adj_close"],
                mode="lines", line={"color": "#2196F3", "width": 1.5},
                name="Adj. Close", hovertemplate="%{x|%b %d, %Y}: $%{y:,.2f}<extra></extra>",
            ))
            fig.update_layout(
                height=220,
                margin={"l": 0, "r": 0, "t": 10, "b": 10},
                xaxis={"showgrid": False},
                yaxis={"tickprefix": "$", "showgrid": True, "gridcolor": "#f0f0f0"},
                plot_bgcolor="white",
                paper_bgcolor="white",
                hovermode="x unified",
                showlegend=False,
            )
            st.plotly_chart(fig, width="stretch", config={"displayModeBar": False})

    # no-data guard ───────────────────────────────────────────────────────────
    if not has_fundamentals and not has_scores:
        st.markdown("---")
        st.info(
            f"**No fundamental data available for {ticker}.** "
            "This security has no XBRL filings yet (likely a recent spinoff or IPO). "
            "Scores and metrics will populate automatically once filings are ingested "
            "by the weekly pipeline."
        )
        _show_placeholders()
        return

    # factor scores panel ─────────────────────────────────────────────────────
    st.markdown("---")
    if not has_scores:
        st.info("No factor scores available for this company.")
    else:
        _show_factor_panel(info, inputs, sub_pctls, flags, roic_is_proxy)

    # fundamentals panel ──────────────────────────────────────────────────────
    st.markdown("---")
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
) -> None:
    weights = (info.get("details") or {}).get("weights", {})
    weight_str = "  ·  ".join(
        f"{k.capitalize()} {v * 100:.0f}%" for k, v in weights.items()
    )
    st.markdown(f"#### Factor Scores")
    st.caption(
        f"Cross-sectional percentile ranks within the S&P 500 universe (100 = top). "
        f"Weights: {weight_str}."
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

    factor_pctls = {
        "growth":   info.get("growth_pctl"),
        "value":    info.get("value_pctl"),
        "quality":  info.get("quality_pctl"),
        "momentum": info.get("momentum_pctl"),
    }
    composite = info.get("composite")

    # top-line factor metrics
    cols = st.columns(5)
    for i, factor in enumerate(("growth", "value", "quality", "momentum")):
        v = factor_pctls[factor]
        with cols[i]:
            if v is None:
                st.metric(factor.capitalize(), "n/a")
                if factor == "value" and inputs.get("mktcap") is None:
                    st.caption("no market cap")
            else:
                st.metric(factor.capitalize(), f"{v:.1f}")
    with cols[4]:
        st.metric(
            "**Composite**",
            f"{composite:.1f}" if composite is not None else "n/a",
        )

    # sub-metric breakdown table
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
        use_container_width=True,
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
    st.markdown("#### Fundamental Metrics — Point-in-Time History")
    st.caption(
        "Values as known at each filing date (point-in-time correct — restatements "
        "apply forward only, never backward). TTM = trailing twelve months. "
        "Showing the eight most recent filing dates."
    )

    display_dates = metrics_df.head(8)
    date_cols = [d.strftime("%b %Y") for d in display_dates.index]

    rows: list[dict] = []
    for metric in METRIC_DISPLAY_ORDER:
        if metric not in display_dates.columns:
            continue
        label = METRIC_LABELS.get(metric, metric)

        values: dict[str, str] = {}
        for dt, dt_label in zip(display_dates.index, date_cols):
            v = display_dates.at[dt, metric]
            if pd.isna(v):
                # Annotate known structural nulls for financials
                if is_financial and metric in FINANCIAL_NULL_METRICS:
                    values[dt_label] = "n/a*"
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
    st.dataframe(trend_df, use_container_width=True)

    footnotes: list[str] = []
    if roic_is_proxy:
        footnotes.append(
            "* ROIC is shown as ROA (net income ÷ total assets) — "
            "company type does not report an operating-income subtotal."
        )
    if is_financial:
        footnotes.append(
            "* n/a for financials: gross margin, operating margin, "
            "current ratio, and net debt/EBITDA are not meaningful for "
            "banks, insurance companies, or REITs."
        )
    for note in footnotes:
        st.caption(note)


# ── placeholder sections ──────────────────────────────────────────────────────

def _show_placeholders() -> None:
    st.markdown("---")
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

def main() -> None:
    if "page" not in st.session_state:
        st.session_state.page = "screener"
    if "selected_ticker" not in st.session_state:
        st.session_state.selected_ticker = None

    if st.session_state.page == "deepdive" and st.session_state.selected_ticker:
        show_deepdive(st.session_state.selected_ticker)
    else:
        show_screener()


if __name__ == "__main__":
    main()

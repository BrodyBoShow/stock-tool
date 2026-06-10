"""StockBud — Streamlit front end (read-only).

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
import streamlit.components.v1 as components

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from engine.db import get_connection  # noqa: E402

# ── page config ───────────────────────────────────────────────────────────────
st.set_page_config(
    page_title="StockBud",
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

# Per-factor colors for the screener table (from Figma spec)
FACTOR_TABLE = {
    "composite": ("#1e293b", "rgba(30,41,59,0.08)",   "#1e293b"),
    "growth":    ("#3b82f6", "rgba(59,130,246,0.10)",  "#2563eb"),
    "value":     ("#10b981", "rgba(16,185,129,0.10)",  "#059669"),
    "quality":   ("#a855f7", "rgba(168,85,247,0.10)",  "#9333ea"),
    "momentum":  ("#f59e0b", "rgba(245,158,11,0.10)",  "#d97706"),
}  # (bar_color, tint_high_bg, header_text_color)

# Macro context series (CONTEXT ONLY — never feeds factor scores).
# (series_id, label, unit_suffix, decimals)
MACRO_DISPLAY = [
    ("DGS10",    "10Y Treasury", "%", 2),
    ("DGS2",     "2Y Treasury",  "%", 2),
    ("FEDFUNDS", "Fed Funds",    "%", 2),
    ("CPIAUCSL", "CPI",          "",  1),  # index level
    ("VIXCLS",   "VIX",          "",  2),  # volatility level
]
MACRO_LABEL = {s[0]: s[1] for s in MACRO_DISPLAY}
MACRO_UNIT = {s[0]: s[2] for s in MACRO_DISPLAY}
MACRO_DEC = {s[0]: s[3] for s in MACRO_DISPLAY}

SECTOR_PILLS = {
    "Technology":             ("#dbeafe", "#1d4ed8"),
    "Information Technology": ("#dbeafe", "#1d4ed8"),
    "Health Care":            ("#dcfce7", "#15803d"),
    "Financials":             ("#fef9c3", "#a16207"),
    "Real Estate":            ("#fee2e2", "#b91c1c"),
    "Materials":              ("#f3e8ff", "#7e22ce"),
    "Energy":                 ("#ffedd5", "#c2410c"),
    "Consumer Discretionary": ("#fce7f3", "#9d174d"),
    "Consumer Staples":       ("#ecfeff", "#0e7490"),
    "Utilities":              ("#e0f2fe", "#0369a1"),
    "Industrials":            ("#f1f5f9", "#475569"),
    "Communication Services": ("#fdf4ff", "#86198f"),
}

APP_CSS = """
@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@600;700;800&display=swap');
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

/* featured card dark CTA button + invisible Streamlit overlay trick */
.feat-view-btn {
  background: #0f172a; color: #fff;
  border-radius: 10px; padding: 13px 16px;
  font-size: .88rem; font-weight: 700;
  text-align: center; margin: 0 16px 16px;
  letter-spacing: .01em;
}
div[data-testid="stMarkdownContainer"]:has(.foa) + div[data-testid="stButton"] {
  margin-top: -52px !important;
  position: relative;
  z-index: 20;
}
div[data-testid="stMarkdownContainer"]:has(.foa) + div[data-testid="stButton"] button {
  opacity: 0 !important;
  height: 50px;
  width: 100%;
}

/* watchlist & thesis */
.review-badge {
  display: inline-block; background: #fef2f2; color: #dc2626;
  border: 1px solid #fecaca; border-radius: 6px; padding: 2px 8px;
  font-size: .72rem; font-weight: 700;
}
.thesis-block {
  background: #f8fafc; border: 1px solid #e2e8f0;
  border-radius: 12px; padding: 16px; margin: 8px 0;
}
.thesis-label {
  color: #6b7280; font-size: .75rem; font-weight: 600;
  text-transform: uppercase; letter-spacing: .05em; margin-bottom: 4px;
}
.thesis-text { color: #111827; font-size: .92rem; line-height: 1.55; }

/* ── custom screener table ───────────────────────── */
.sct-wrap { overflow-x: auto; border-radius: 10px; }
.sct-header { padding: 14px 16px 10px; }
.sct-title { font-size: 1rem; font-weight: 700; color: #111827; }
.sct-sub { font-size: .78rem; color: #6b7280; margin-top: 2px; }
.sct-legend { display: flex; align-items: center; justify-content: space-between;
  padding: 8px 16px; background: #f9fafb; border-top: 1px solid #f3f4f6;
  border-bottom: 1px solid #e5e7eb; flex-wrap: wrap; gap: 8px; }
.sct-legend-left { display: flex; gap: 14px; flex-wrap: wrap; }
.sct-leg-item { display: flex; align-items: center; font-size: .73rem; color: #4b5563; }
.sct-dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%;
  margin-right: 5px; flex: none; }
.sct-legend-note { font-size: .7rem; color: #9ca3af; font-style: italic; white-space: nowrap; }

/* grid table: shared column template across header + every row anchor.
   Built with <a> rows (not <table>) because Streamlit's HTML sanitizer
   strips inline onclick — anchors navigate via the ?ticker= deep link. */
.sct { font-size: .84rem; min-width: 760px; }
.sct-grid { display: grid; align-items: stretch;
  grid-template-columns: 38px minmax(140px,1.5fr) minmax(130px,1.4fr)
    repeat(5, minmax(70px,1fr)) minmax(82px,.9fr); }
.sct-headrow { background: #f9fafb; border-bottom: 1px solid #e5e7eb; }
.sct-th { padding: 9px 12px; display: flex; align-items: center;
  font-size: .68rem; font-weight: 700; text-transform: uppercase;
  letter-spacing: .06em; color: #6b7280; white-space: nowrap; }
.sct-th-rank { justify-content: flex-end; padding-right: 8px; }
.sct-th-num  { justify-content: center; }
.sct-th-price { justify-content: flex-end; }
/* accent uses inset box-shadow (not border-left) so it adds no layout width
   and the row grid stays pixel-aligned with the borderless header */
.sct-row { border-bottom: 1px solid #f3f4f6; cursor: pointer;
  text-decoration: none; color: inherit;
  transition: box-shadow .12s, background .12s; }
.sct-row:hover { background: #f8fafc; box-shadow: inset 3px 0 0 #1e293b; }
.sct-c { display: flex; flex-direction: column; justify-content: center;
  padding: 8px 12px; min-width: 0; }
.sct-rank { font-size: .7rem; color: #cbd5e1; align-items: flex-end;
  padding-right: 8px; white-space: nowrap; }
.sct-sym { font-weight: 700; color: #111827; font-size: .88rem; line-height: 1.15; }
.sct-co  { font-size: .72rem; color: #9ca3af; margin-top: 1px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sct-sec-cell { align-items: flex-start; }
.sct-pill { display: inline-block; padding: 2px 9px; border-radius: 999px;
  font-size: .68rem; font-weight: 600; white-space: nowrap;
  max-width: 100%; overflow: hidden; text-overflow: ellipsis; }
.sct-score-cell { align-items: center; }
.sct-score { font-size: .82rem; font-weight: 700; }
.sct-bar-bg { width: 48px; height: 4px; background: #e5e7eb; border-radius: 999px;
  overflow: hidden; margin: 4px auto 0; }
.sct-bar-fill { height: 100%; border-radius: 999px; }
.sct-price-td { align-items: flex-end; }
.sct-px  { font-weight: 600; color: #111827; font-size: .85rem; }
.sct-chg-up { color: #16a34a; font-size: .7rem; font-weight: 600; }
.sct-chg-dn { color: #dc2626; font-size: .7rem; font-weight: 600; }

/* ── macro context strip (deep-dive) ─────────────── */
.mc-heading { font-size: .82rem; font-weight: 700; color: #334155; margin: 2px 0 8px; }
.mc-heading-sub { font-weight: 500; color: #9ca3af; font-size: .76rem; }
.mc-strip { display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px;
  margin: 0 0 6px; }
.mc-tile { background: #fff; border: 1px solid #e5e7eb; border-radius: 12px;
  padding: 12px 14px; box-shadow: 0 1px 2px rgba(15,23,42,.05); }
.mc-label { font-size: .67rem; font-weight: 700; color: #6b7280;
  text-transform: uppercase; letter-spacing: .05em; }
.mc-val { font-size: 1.32rem; font-weight: 800; color: #111827;
  margin: 3px 0 2px; line-height: 1.1; }
/* macro deltas are direction-only (slate) — rising rates/VIX/CPI are context,
   not "good/bad", so no green-up/red-down semantics here */
.mc-chgrow { display: flex; align-items: baseline; gap: 6px; flex-wrap: wrap; }
.mc-delta { font-size: .74rem; font-weight: 700; color: #475569; }
.mc-since { font-size: .67rem; color: #9ca3af; }
.mc-asof { font-size: .63rem; color: #cbd5e1; margin-top: 3px; }
.mc-noprior { font-size: .72rem; color: #9ca3af; }
@media (max-width: 1100px) { .mc-strip { grid-template-columns: repeat(2, 1fr); } }

/* ── filter panel (sidebar) ──────────────────────── */
.flt-hdr { padding: 2px 0 10px; border-bottom: 1px solid #f1f5f9; margin-bottom: 2px; }
.flt-hdr-top { display: flex; align-items: center; justify-content: space-between; }
.flt-hdr-title { display: flex; align-items: center; gap: 7px;
  font-size: .88rem; font-weight: 700; color: #1e293b; }
.flt-badge { display: inline-flex; align-items: center; justify-content: center;
  width: 18px; height: 18px; border-radius: 50%; background: #1e293b;
  color: #fff; font-size: .64rem; font-weight: 800; flex-shrink: 0; }
.flt-hdr-count { margin-top: 5px; font-size: .8rem; color: #6b7280; }
.flt-n { color: #1e293b; font-weight: 800; font-size: .9rem; }
.flt-label { font-size: .67rem; font-weight: 700; color: #6b7280;
  text-transform: uppercase; letter-spacing: .07em; margin: 2px 0 0 0;
  line-height: 1.4; }
.flt-active-banner { background: #1e293b; color: #fff; border-radius: 10px;
  padding: 10px 12px; margin-top: 8px; }
.flt-active-banner strong { font-size: .8rem; font-weight: 700; }
.flt-active-sub { font-size: .69rem; color: #94a3b8; margin-top: 2px; }

/* ── sidebar refinements ─────────────────────────── */
section[data-testid="stSidebar"] div[data-testid="stSidebarUserContent"] { padding-top: 1.1rem; }
section[data-testid="stSidebar"] div[data-testid="stVerticalBlock"] { gap: .72rem; }
section[data-testid="stSidebar"] hr { margin: 10px 0; }
section[data-testid="stSidebar"] div[data-testid="stButton"] button { min-height: 34px; }
.sb-brand { font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: .96rem; font-weight: 800; color: #0f172a; padding: 0 0 6px;
  letter-spacing: .14em; display: flex; align-items: center; gap: 8px; }
.sb-brand .sb-mark { color: #2a9d8f; font-size: 1.1rem; }

/* minimal uppercase nav tabs — scoped to the .navmark container so the
   Reset/Refresh/Save buttons elsewhere in the sidebar are untouched */
section[data-testid="stSidebar"]
  div[data-testid="stVerticalBlock"]:has(> div[data-testid="stElementContainer"] .navmark)
  div[data-testid="stElementContainer"]:has(.navmark)
  { display: none; }
section[data-testid="stSidebar"]
  div[data-testid="stVerticalBlock"]:has(> div[data-testid="stElementContainer"] .navmark)
  div[data-testid="stButton"] button {
  background: transparent !important; border: none !important;
  border-left: 2px solid transparent !important; border-radius: 0 !important;
  justify-content: flex-start !important; box-shadow: none !important;
  text-transform: uppercase; letter-spacing: .13em;
  font-size: .76rem !important; font-weight: 700 !important;
  color: #64748b !important; padding: 5px 12px !important; min-height: 30px !important;
}
section[data-testid="stSidebar"]
  div[data-testid="stVerticalBlock"]:has(> div[data-testid="stElementContainer"] .navmark)
  div[data-testid="stButton"] button:hover
  { color: #0f172a !important; background: #f1f5f9 !important; }
section[data-testid="stSidebar"]
  div[data-testid="stVerticalBlock"]:has(> div[data-testid="stElementContainer"] .navmark)
  button[data-testid="stBaseButton-primary"] {
  color: #0f172a !important; background: #f8fafc !important;
  border-left-color: #2a9d8f !important;
}

/* hide slider numeric clutter (floating value + min/max ticks) — the
   Any/N+ badge in the label row is the single source of truth */
section[data-testid="stSidebar"] div[data-testid="stSliderThumbValue"],
section[data-testid="stSidebar"] div[data-testid="stSliderTickBar"] { display: none !important; }

/* label rows: label left, value badge right, slider pulled close beneath */
.flt-row { display: flex; justify-content: space-between; align-items: center; }
.flt-val { font-size: .7rem; font-weight: 800; background: #f1f5f9;
  padding: 2px 8px; border-radius: 6px; }
.flt-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block;
  margin-right: 6px; flex: none; }
.flt-fname { display: inline-flex; align-items: center; font-size: .78rem;
  font-weight: 600; color: #374151; }
/* Streamlit compensates for a trailing <p> margin with -1rem on the markdown
   container; our label divs have no such margin, so undo it or the labels
   get swallowed by the next widget */
section[data-testid="stSidebar"] div[data-testid="stMarkdownContainer"]:has(.flt-label),
section[data-testid="stSidebar"] div[data-testid="stMarkdownContainer"]:has(.flt-row),
section[data-testid="stSidebar"] div[data-testid="stMarkdownContainer"]:has(.flt-hdr),
section[data-testid="stSidebar"] div[data-testid="stMarkdownContainer"]:has(.flt-active-banner) {
  margin-bottom: 0 !important;
}
section[data-testid="stSidebar"] div[data-testid="stElementContainer"]:has(.flt-label)
  { margin-bottom: -4px; }
section[data-testid="stSidebar"] div[data-testid="stElementContainer"]:has(.flt-row)
  { margin-bottom: -14px; }

/* per-slider coloring: theme primary #2563eb (hue 221°) is rotated/muted
   onto each factor's color; applies to fill + thumb together */
section[data-testid="stSidebar"] div[data-testid="stElementContainer"]:has(.mk-comp)
  + div[data-testid="stElementContainer"] div[data-testid="stSlider"]
  { filter: saturate(.35) brightness(.8); }
section[data-testid="stSidebar"] div[data-testid="stElementContainer"]:has(.mk-v)
  + div[data-testid="stElementContainer"] div[data-testid="stSlider"]
  { filter: hue-rotate(-61deg); }
section[data-testid="stSidebar"] div[data-testid="stElementContainer"]:has(.mk-q)
  + div[data-testid="stElementContainer"] div[data-testid="stSlider"]
  { filter: hue-rotate(49deg); }
section[data-testid="stSidebar"] div[data-testid="stElementContainer"]:has(.mk-m)
  + div[data-testid="stElementContainer"] div[data-testid="stSlider"]
  { filter: hue-rotate(177deg) saturate(1.4) brightness(1.08); }

/* sector chips: compact pills */
section[data-testid="stSidebar"] div[data-testid="stButtonGroup"] { gap: 5px; }
section[data-testid="stSidebar"] div[data-testid="stButtonGroup"] button {
  min-height: 26px !important; padding: 1px 11px !important; border-radius: 999px !important; }
section[data-testid="stSidebar"] div[data-testid="stButtonGroup"] button p {
  font-size: .72rem !important; font-weight: 600 !important; color: inherit !important; }

/* per-factor expander: compact uppercase header */
section[data-testid="stSidebar"] div[data-testid="stExpander"] summary { padding: 8px 12px; }
section[data-testid="stSidebar"] div[data-testid="stExpander"] summary p {
  font-size: .72rem; font-weight: 700; color: #475569;
  text-transform: uppercase; letter-spacing: .05em; }
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
                       lp.close AS last_price,
                       lp2.close AS prev_close,
                       s.security_id
                FROM securities s
                JOIN factor_scores fs
                    ON fs.security_id = s.security_id AND fs.score_date = %s
                LEFT JOIN LATERAL (
                    SELECT close FROM prices_daily p
                    WHERE p.security_id = s.security_id
                    ORDER BY p.date DESC LIMIT 1
                ) lp ON true
                LEFT JOIN LATERAL (
                    SELECT close FROM prices_daily p2
                    WHERE p2.security_id = s.security_id
                    ORDER BY p2.date DESC LIMIT 1 OFFSET 1
                ) lp2 ON true
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
                "quality_pctl", "momentum_pctl", "last_price", "prev_close"):
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


@st.cache_data(ttl=DATA_TTL)
def load_macro_latest() -> dict:
    """For each tracked macro series: the two most recent observations, so the
    strip can show an honest change vs the previous *real* reading.

    Returns {series_id: [(latest_date, latest_val), (prev_date, prev_val)]}.
    Macro is CONTEXT ONLY — this reads macro_series and feeds nothing else.
    """
    series_ids = [s[0] for s in MACRO_DISPLAY]
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT series_id, date, value FROM (
                    SELECT series_id, date, value,
                           row_number() OVER (
                               PARTITION BY series_id ORDER BY date DESC
                           ) AS rn
                    FROM macro_series
                    WHERE series_id = ANY(%s)
                ) t
                WHERE rn <= 2
                ORDER BY series_id, date DESC
                """,
                (series_ids,),
            )
            rows = cur.fetchall()
    finally:
        conn.close()

    out: dict[str, list] = {}
    for sid, d, v in rows:
        out.setdefault(sid, []).append((d, _f(v)))
    return out


@st.cache_data(ttl=DATA_TTL, max_entries=16)
def load_macro_series(series_id: str) -> pd.DataFrame:
    """Full history for one macro series (for the opt-in chart overlay)."""
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT date, value FROM macro_series "
                "WHERE series_id = %s ORDER BY date",
                (series_id,),
            )
            rows = cur.fetchall()
    finally:
        conn.close()

    if not rows:
        return pd.DataFrame(columns=["date", "value"])
    df = pd.DataFrame(rows, columns=["date", "value"])
    df["date"] = pd.to_datetime(df["date"])
    df["value"] = pd.to_numeric(df["value"], errors="coerce")
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


@st.cache_data(ttl=DATA_TTL)
def load_watchlist() -> pd.DataFrame:
    """Watchlist rows joined with securities + latest factor scores."""
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT s.ticker, s.name, s.sector, w.added_at,
                       fs.composite, fs.growth_pctl, fs.value_pctl,
                       fs.quality_pctl, fs.momentum_pctl,
                       lp.close AS last_price,
                       w.id AS watchlist_id, s.security_id
                FROM watchlist w
                JOIN securities s ON s.security_id = w.security_id
                LEFT JOIN factor_scores fs
                    ON fs.security_id = s.security_id
                    AND fs.score_date = (SELECT max(score_date) FROM factor_scores)
                LEFT JOIN LATERAL (
                    SELECT close FROM prices_daily p
                    WHERE p.security_id = s.security_id
                    ORDER BY p.date DESC LIMIT 1
                ) lp ON true
                ORDER BY w.added_at DESC
                """
            )
            rows = cur.fetchall()
            cols = [d[0] for d in cur.description]
    finally:
        conn.close()
    if not rows:
        return pd.DataFrame(columns=[
            "ticker", "name", "sector", "added_at",
            "composite", "growth_pctl", "value_pctl", "quality_pctl", "momentum_pctl",
            "last_price", "watchlist_id", "security_id",
        ])
    df = pd.DataFrame(rows, columns=cols)
    for col in ("composite", "growth_pctl", "value_pctl",
                "quality_pctl", "momentum_pctl", "last_price"):
        df[col] = pd.to_numeric(df[col], errors="coerce")
    return df


@st.cache_data(ttl=DATA_TTL)
def load_watchlist_set() -> frozenset:
    """Frozenset of tickers currently in the watchlist (for button state)."""
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT s.ticker FROM watchlist w "
                "JOIN securities s ON s.security_id = w.security_id"
            )
            rows = cur.fetchall()
    finally:
        conn.close()
    return frozenset(r[0] for r in rows)


@st.cache_data(ttl=DATA_TTL, max_entries=128)
def load_thesis(ticker: str) -> dict | None:
    """Active thesis for one ticker, or None."""
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT t.id, t.security_id, t.summary, t.invalidation_rules,
                       t.review_date, t.conviction, t.status,
                       t.created_at, t.updated_at
                FROM theses t
                JOIN securities s ON s.security_id = t.security_id
                WHERE s.ticker = %s AND t.status = 'active'
                ORDER BY t.updated_at DESC
                LIMIT 1
                """,
                (ticker,),
            )
            row = cur.fetchone()
            if row is None:
                return None
            cols = [d[0] for d in cur.description]
    finally:
        conn.close()
    return dict(zip(cols, row, strict=True))


@st.cache_data(ttl=DATA_TTL)
def load_all_theses() -> pd.DataFrame:
    """All active theses joined with securities + latest composite."""
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT s.ticker, s.name, s.sector,
                       t.id AS thesis_id, t.security_id,
                       t.summary, t.invalidation_rules,
                       t.review_date, t.conviction, t.updated_at,
                       fs.composite
                FROM theses t
                JOIN securities s ON s.security_id = t.security_id
                LEFT JOIN factor_scores fs
                    ON fs.security_id = s.security_id
                    AND fs.score_date = (SELECT max(score_date) FROM factor_scores)
                WHERE t.status = 'active'
                ORDER BY t.review_date ASC NULLS LAST, t.updated_at DESC
                """
            )
            rows = cur.fetchall()
            cols = [d[0] for d in cur.description]
    finally:
        conn.close()
    if not rows:
        return pd.DataFrame(columns=[
            "ticker", "name", "sector", "thesis_id", "security_id",
            "summary", "invalidation_rules", "review_date",
            "conviction", "updated_at", "composite",
        ])
    df = pd.DataFrame(rows, columns=cols)
    df["composite"] = pd.to_numeric(df["composite"], errors="coerce")
    df["review_date"] = pd.to_datetime(df["review_date"]).dt.date
    return df


# ── DB write functions (not cached) ──────────────────────────────────────────

def watchlist_add(security_id: int) -> None:
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO watchlist (security_id) VALUES (%s) "
                "ON CONFLICT (security_id) DO NOTHING",
                (security_id,),
            )
        conn.commit()
    finally:
        conn.close()
    st.cache_data.clear()


def watchlist_remove(security_id: int) -> None:
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM watchlist WHERE security_id = %s", (security_id,))
        conn.commit()
    finally:
        conn.close()
    st.cache_data.clear()


def thesis_save(
    security_id: int,
    summary: str,
    invalidation_rules: str,
    review_date,
) -> None:
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id FROM theses WHERE security_id = %s AND status = 'active' LIMIT 1",
                (security_id,),
            )
            row = cur.fetchone()
            if row:
                cur.execute(
                    """
                    UPDATE theses
                    SET summary = %s, invalidation_rules = %s,
                        review_date = %s, updated_at = NOW()
                    WHERE id = %s
                    """,
                    (summary, invalidation_rules or None, review_date, row[0]),
                )
            else:
                cur.execute(
                    """
                    INSERT INTO theses (security_id, summary, invalidation_rules, review_date)
                    VALUES (%s, %s, %s, %s)
                    """,
                    (security_id, summary, invalidation_rules or None, review_date),
                )
        conn.commit()
    finally:
        conn.close()
    st.cache_data.clear()


def thesis_delete(thesis_id: int) -> None:
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM theses WHERE id = %s", (thesis_id,))
        conn.commit()
    finally:
        conn.close()
    st.cache_data.clear()


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


# Height of the terminal header iframe (px). Keep in sync with its content.
TERMINAL_HEADER_HEIGHT = 184


def screener_terminal_header_html(
    score_date, stale_days: int | None,
    vix: float | None, vix_chg: float | None,
    adv: int, dec: int, total: int,
) -> str:
    """Bloomberg-ish terminal header rendered in an isolated iframe so it can
    carry its own monospace font + a live JS clock.

    Honesty notes: the status badge says NIGHTLY/STALE (never "LIVE" — the
    pipeline is a nightly batch). The clock and OPEN/CLOSED are real wall-clock
    ET (pure time, not a data claim). VIX is the FRED last close; ADV/DEC are
    computed from our own nightly close-vs-prior-close, not an index feed.
    """
    fresh = stale_days is None or stale_days <= 3
    badge_cls = "ok" if fresh else "stale"
    badge_txt = "NIGHTLY" if fresh else f"STALE {stale_days}D"
    sd = escape(str(score_date)) if score_date else "n/a"

    if vix is None:
        vix_cell = '<span class="k">VIX</span> <span class="mut">n/a</span>'
    elif vix_chg is None:
        vix_cell = f'<span class="k">VIX</span> <span class="v">{vix:.2f}</span>'
    else:
        # market convention: rising VIX = risk/fear = red; falling = green
        cc = "dn" if vix_chg > 0 else ("up" if vix_chg < 0 else "mut")
        ar = "▲" if vix_chg > 0 else ("▼" if vix_chg < 0 else "■")
        vix_cell = (
            f'<span class="k">VIX</span> <span class="v">{vix:.2f}</span> '
            f'<span class="{cc}">{ar}{abs(vix_chg):.2f}</span>'
        )
    ratio = f"{adv / dec:.2f}" if dec else "—"

    style = """<style>
    @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@500;600;700;800&display=swap');
    *{box-sizing:border-box} html,body{margin:0;padding:0}
    body{font-family:'JetBrains Mono',ui-monospace,SFMono-Regular,Menlo,monospace;
      background:transparent}
    .term{background:#0f1117;border-radius:13px;border-bottom:2px solid #2a9d8f;
      padding:15px 20px 13px;color:#e5e7eb;box-shadow:0 6px 22px rgba(8,11,18,.22);
      background-image:radial-gradient(120% 140% at 0% 0%,#151a23 0%,#0f1117 55%);}
    .row{display:flex;justify-content:space-between;align-items:flex-end;gap:16px}
    .eyebrow{font-size:10px;letter-spacing:.3em;color:#6b7280;font-weight:700}
    .clk-label{font-size:10px;letter-spacing:.22em;color:#6b7280;font-weight:700;text-align:right}
    .title{font-size:22px;font-weight:800;color:#f8fafc;letter-spacing:.01em;margin-top:3px}
    .badge{display:inline-flex;align-items:center;gap:6px;font-size:10px;font-weight:700;
      letter-spacing:.14em;padding:2px 8px;border-radius:5px;margin-left:12px;
      vertical-align:middle;position:relative;top:-3px}
    .badge.ok{background:rgba(34,197,94,.12);color:#22c55e;border:1px solid rgba(34,197,94,.32)}
    .badge.stale{background:rgba(245,158,11,.13);color:#f59e0b;
      border:1px solid rgba(245,158,11,.32)}
    .dot{width:7px;height:7px;border-radius:50%;background:currentColor}
    .badge.ok .dot{animation:pulse 1.6s ease-in-out infinite}
    @keyframes pulse{0%,100%{opacity:1}50%{opacity:.2}}
    .clk{font-size:19px;color:#cbd5e1;font-weight:600;text-align:right;letter-spacing:.02em;
      font-variant-numeric:tabular-nums}
    .mkt{font-size:10px;font-weight:700;letter-spacing:.16em;padding:2px 9px;border-radius:5px}
    .mkt-open{background:rgba(34,197,94,.12);color:#22c55e;border:1px solid rgba(34,197,94,.32)}
    .mkt-closed{background:rgba(148,163,184,.1);color:#94a3b8;
      border:1px solid rgba(148,163,184,.26)}
    .tabs{display:flex;gap:20px;margin-top:11px}
    .tab{font-size:12px;font-weight:700;letter-spacing:.09em;color:#5b6675;
      padding-bottom:7px;border-bottom:2px solid transparent}
    .tab.active{color:#f8fafc;border-bottom-color:#2a9d8f}
    .divider{height:1px;background:linear-gradient(90deg,rgba(42,157,143,.45),transparent);
      margin:10px 0 9px}
    .bar{display:flex;flex-wrap:wrap;align-items:center;font-size:12px}
    .cell{padding:0 13px;border-right:1px solid #1d2430;white-space:nowrap;line-height:1.5}
    .cell:first-child{padding-left:0}.cell:last-child{border-right:none}
    .k{color:#6b7280;font-weight:700;letter-spacing:.05em}
    .v{color:#e5e7eb;font-weight:700}
    .up{color:#22c55e;font-weight:700}.dn{color:#ef4444;font-weight:700}.mut{color:#94a3b8}
    </style>"""

    body = f"""<div class="term">
      <div class="row">
        <div class="eyebrow">EQUITY SCREENER</div>
        <div class="clk-label">NYSE · ET</div>
      </div>
      <div class="row">
        <div class="title">S&amp;P 500 FACTOR SCREENER<span class="badge {badge_cls}">\
<span class="dot"></span>{badge_txt}</span></div>
        <div class="clk" id="clk">————-—— ——:——:——</div>
      </div>
      <div class="row">
        <div class="tabs"><span class="tab active">S&amp;P 500</span></div>
        <div class="mkt mkt-closed" id="mkt">— —</div>
      </div>
      <div class="divider"></div>
      <div class="bar">
        <span class="cell">{vix_cell}</span>
        <span class="cell"><span class="k">ADV</span> <span class="up">{adv}</span></span>
        <span class="cell"><span class="k">DEC</span> <span class="dn">{dec}</span></span>
        <span class="cell"><span class="k">A/D</span> <span class="v">{ratio}</span></span>
        <span class="cell"><span class="k">NAMES</span> <span class="v">{total}</span></span>
        <span class="cell"><span class="k">SCORES</span> <span class="mut">{sd}</span></span>
      </div>
    </div>"""

    script = """<script>
    function etParts(){
      var n=new Date();
      var f=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',
        year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',
        minute:'2-digit',second:'2-digit',weekday:'short',hour12:false});
      var o={}; f.formatToParts(n).forEach(function(p){o[p.type]=p.value;}); return o;
    }
    function tick(){
      var m=etParts(); var h=(m.hour==='24')?'00':m.hour;
      document.getElementById('clk').textContent=
        m.year+'-'+m.month+'-'+m.day+'  '+h+':'+m.minute+':'+m.second;
      var mins=parseInt(h,10)*60+parseInt(m.minute,10);
      var wk=!(m.weekday==='Sat'||m.weekday==='Sun');
      var open=wk && mins>=570 && mins<960;   // 09:30–16:00 ET regular session
      var e=document.getElementById('mkt');
      e.textContent=open?'● OPEN':'● CLOSED';
      e.className='mkt '+(open?'mkt-open':'mkt-closed');
    }
    tick(); setInterval(tick,1000);
    </script>"""

    return ("<!doctype html><html><head><meta charset='utf-8'>"
            + style + "</head><body>" + body + script + "</body></html>")


def stats_row_html(df: pd.DataFrame) -> str:
    top_comp = int((df["composite"] > 75).sum())
    top_qual = int((df["quality_pctl"] > 75).sum())
    top_mom  = int((df["momentum_pctl"] > 75).sum())
    top_val  = int((df["value_pctl"] > 75).sum())
    tiles = [
        ("Top composite", f"{top_comp:,}", "composite score above 75", "📊", "blue"),
        ("Strong quality", f"{top_qual:,}", "quality percentile above 75", "🎯", "emerald"),
        ("Momentum leaders", f"{top_mom:,}", "momentum percentile above 75", "⚡", "amber"),
        ("Value plays", f"{top_val:,}", "value percentile above 75", "💎", "purple"),
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
        "</div></div>"
        '<div class="feat-view-btn">View Analysis</div>'
        "</div>"
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


def screener_table_html(view: pd.DataFrame, total: int) -> str:
    """Custom screener table matching Figma design — colored bars, tinted cells, sector pills."""
    n = len(view)

    legend_dots = "".join(
        f'<span class="sct-leg-item"><span class="sct-dot" '
        f'style="background:{c}"></span>{lbl}</span>'
        for lbl, c in [
            ("Composite", "#1e293b"), ("Growth", "#3b82f6"),
            ("Value", "#10b981"), ("Quality", "#a855f7"), ("Momentum", "#f59e0b"),
        ]
    )
    legend = (
        '<div class="sct-legend">'
        f'<div class="sct-legend-left">{legend_dots}</div>'
        '<span class="sct-legend-note">Cell tint: high ≥75 &nbsp;·&nbsp; low &lt;25</span>'
        "</div>"
    )

    factor_hdrs = "".join(
        f'<div class="sct-th sct-th-num" style="color:{hcol}">{lbl}</div>'
        for lbl, hcol in [
            ("COMPOSITE", "#1e293b"), ("GROWTH", "#2563eb"),
            ("VALUE", "#059669"), ("QUALITY", "#9333ea"), ("MOMENTUM", "#d97706"),
        ]
    )
    thead = (
        '<div class="sct-grid sct-headrow">'
        '<div class="sct-th sct-th-rank">#</div>'
        '<div class="sct-th">TICKER</div>'
        '<div class="sct-th">SECTOR</div>'
        f"{factor_hdrs}"
        '<div class="sct-th sct-th-price">PRICE</div>'
        "</div>"
    )

    tint_low = "rgba(239,68,68,0.07)"
    FACTORS = [
        ("composite",   "#1e293b", "rgba(30,41,59,0.08)"),
        ("growth_pctl", "#3b82f6", "rgba(59,130,246,0.10)"),
        ("value_pctl",  "#10b981", "rgba(16,185,129,0.10)"),
        ("quality_pctl","#a855f7", "rgba(168,85,247,0.10)"),
        ("momentum_pctl","#f59e0b","rgba(245,158,11,0.10)"),
    ]

    rows_html = []
    for _, row in view.iterrows():
        ticker = escape(str(row["ticker"]))
        name   = escape(str(row.get("name") or ""))
        sector = str(row.get("sector") or "")
        spill  = SECTOR_PILLS.get(sector, ("#f1f5f9", "#475569"))
        rank   = row.get("rank")
        rank_s = str(int(rank)) if pd.notna(rank) else ""
        last   = _f(row.get("last_price"))
        prev   = _f(row.get("prev_close"))

        price_inner = f'<div class="sct-px">{fmt_price(last)}</div>'
        if last is not None and prev is not None and prev > 0:
            chg  = (last - prev) / prev
            sign = "+" if chg >= 0 else ""
            cls  = "sct-chg-up" if chg >= 0 else "sct-chg-dn"
            price_inner += f'<div class="{cls}">{sign}{chg * 100:.1f}%</div>'

        cells = (
            f'<div class="sct-c sct-rank">{rank_s}</div>'
            f'<div class="sct-c">'
            f'<div class="sct-sym">{ticker}</div>'
            f'<div class="sct-co">{name}</div></div>'
            f'<div class="sct-c sct-sec-cell"><span class="sct-pill" '
            f'style="background:{spill[0]};color:{spill[1]}">'
            f"{escape(sector)}</span></div>"
        )
        for col, bar_col, tint_hi in FACTORS:
            v = _f(row.get(col))
            if v is None:
                cells += ('<div class="sct-c sct-score-cell" '
                          'style="color:#9ca3af">—</div>')
            else:
                bg = tint_hi if v >= 75 else (tint_low if v < 25 else "transparent")
                cells += (
                    f'<div class="sct-c sct-score-cell" style="background:{bg}">'
                    f'<div class="sct-score" style="color:{bar_col}">{v:.1f}</div>'
                    f'<div class="sct-bar-bg"><div class="sct-bar-fill" '
                    f'style="width:{min(v, 100):.0f}%;background:{bar_col}">'
                    f"</div></div></div>"
                )
        cells += f'<div class="sct-c sct-price-td">{price_inner}</div>'

        # anchor row → ?ticker= deep link (sanitizer-safe; full reload routes
        # to the deep-dive via main()'s query-param check)
        rows_html.append(
            f'<a class="sct-grid sct-row" href="?ticker={ticker}" '
            f'target="_self">{cells}</a>'
        )

    return (
        '<div class="sct-wrap">'
        '<div class="sct-header">'
        '<div class="sct-title">All companies</div>'
        f'<div class="sct-sub">Showing {n:,} of {total:,} &nbsp;·&nbsp; '
        "sorted by Composite &nbsp;·&nbsp; click a row for the deep-dive</div>"
        "</div>"
        f"{legend}"
        f'<div class="sct">{thead}{"".join(rows_html)}</div>'
        "</div>"
    )


def _md(d) -> str:
    """'Jun 6' — no leading zero, cross-platform (Windows lacks %-d)."""
    return f"{d:%b} {d.day}"


def _mdy(d) -> str:
    """'Jun 6, 2026'."""
    return f"{d:%b} {d.day}, {d.year}"


def macro_strip_html(latest: dict) -> str:
    """Ambient macro context tiles: current value + change vs the previous
    *real* observation (never a fabricated period delta). Returns "" if no
    macro data is loaded yet."""
    tiles = []
    for sid, label, unit, dec in MACRO_DISPLAY:
        seq = latest.get(sid)
        if not seq:
            continue
        cur_d, cur_v = seq[0]
        if cur_v is None:
            continue
        val_str = f"{cur_v:.{dec}f}{unit}"

        prev = seq[1] if len(seq) > 1 else None
        if prev is not None and prev[1] is not None:
            delta = cur_v - prev[1]
            arrow = "▲" if delta > 0 else ("▼" if delta < 0 else "■")
            chg_html = (
                f'<span class="mc-delta">{arrow} {abs(delta):.{dec}f}{unit}</span>'
                f'<span class="mc-since">vs {escape(_md(prev[0]))}</span>'
            )
        else:
            chg_html = '<span class="mc-noprior">no prior reading</span>'

        tiles.append(
            '<div class="mc-tile">'
            f'<div class="mc-label">{escape(label)}</div>'
            f'<div class="mc-val">{val_str}</div>'
            f'<div class="mc-chgrow">{chg_html}</div>'
            f'<div class="mc-asof">as of {escape(_mdy(cur_d))}</div>'
            "</div>"
        )

    if not tiles:
        return ""
    return f'<div class="mc-strip">{"".join(tiles)}</div>'


def _nav_to(ticker: str) -> None:
    st.session_state.page = "deepdive"
    st.session_state.selected_ticker = ticker
    st.query_params["ticker"] = ticker
    st.rerun()


# ── shared nav ───────────────────────────────────────────────────────────────

def _sidebar_nav(current: str) -> None:
    st.markdown(
        '<div class="sb-brand"><span class="sb-mark">▚</span>STOCKBUD</div>',
        unsafe_allow_html=True,
    )
    # Real pages only — no dead nav. The .navmark scopes the minimal-tab CSS to
    # just these buttons (active page = primary, styled with the accent rule).
    pages = [
        ("screener",  "Screener"),
        ("watchlist", "Watchlist"),
        ("theses",    "Theses"),
    ]
    nav = st.container()
    with nav:
        st.markdown('<div class="navmark"></div>', unsafe_allow_html=True)
        for page_key, label in pages:
            btn_type = "primary" if current == page_key else "secondary"
            if st.button(label, key=f"nav_{page_key}", width="stretch", type=btn_type):
                st.session_state.page = page_key
                st.session_state.selected_ticker = None
                st.query_params.clear()
                st.rerun()


# ── screener page ─────────────────────────────────────────────────────────────

def _apply_screener_filters(df: pd.DataFrame, search: str, sector: str,
                            comp_min: float, g_min: float, v_min: float,
                            q_min: float, m_min: float) -> pd.DataFrame:
    """Filter the screener frame. Score minimums keep NaN rows (data honesty:
    a missing factor is not the same as a failing one)."""
    view = df
    if search:
        # regex=False: treat the query literally so metacharacters like "(" or
        # "BRK.B" don't raise a regex-compile error mid-typing.
        q = search.strip()
        view = view[
            view["ticker"].str.contains(q, case=False, na=False, regex=False)
            | view["name"].str.contains(q, case=False, na=False, regex=False)
        ]
    if sector and sector != "All":
        view = view[view["sector"] == sector]
    for col, mv in [
        ("composite", comp_min), ("growth_pctl", g_min), ("value_pctl", v_min),
        ("quality_pctl", q_min), ("momentum_pctl", m_min),
    ]:
        if mv > 0:
            view = view[view[col].isna() | (view[col] >= mv)]
    return view


def show_screener() -> None:
    df, score_date = load_screener_data()

    # sidebar ─────────────────────────────────────────────────────────────────
    with st.sidebar:
        _sidebar_nav("screener")

        # quick actions — kept near the top so their dropdowns always have
        # room below to open downward (BaseWeb/Popper flips a menu upward when
        # the control sits too close to the viewport bottom)
        st.markdown('<div class="flt-label flt-nopull">Jump to company</div>',
                    unsafe_allow_html=True)
        go_ticker = st.selectbox(
            "Jump to company", sorted(df["ticker"].tolist()),
            index=None, placeholder="Type or select a ticker…",
            label_visibility="collapsed",
        )
        if go_ticker:
            _nav_to(go_ticker)

        st.markdown('<div class="flt-label flt-nopull">Save to watchlist</div>',
                    unsafe_allow_html=True)
        add_ticker = st.selectbox(
            "Save to watchlist", sorted(df["ticker"].tolist()),
            index=None, placeholder="Type or select a ticker…",
            key="sb_wl_add2", label_visibility="collapsed",
        )
        if add_ticker:
            sid_row = df[df["ticker"] == add_ticker]
            if not sid_row.empty:
                sid = int(sid_row["security_id"].iloc[0])
                if add_ticker in load_watchlist_set():
                    st.caption(f"★ {add_ticker} is already on the watchlist")
                elif st.button(f"★ Save {add_ticker}", width="stretch",
                               key="sb_wl_save"):
                    watchlist_add(sid)
                    st.rerun()

        st.markdown("---")

        # pills has no natural default without the param, so seed it here;
        # the default= param can't be used because Reset assigns via the
        # Session State API and mixing the two triggers a Streamlit warning
        if "flt_sector" not in st.session_state:
            st.session_state.flt_sector = "All"

        # current filter state — widget values land in session_state before
        # the rerun, so reading here lets the header show the live count
        _srch = st.session_state.get("flt_search", "")
        _sec  = st.session_state.get("flt_sector", "All") or "All"
        _cmin = float(st.session_state.get("flt_comp_min", 0.0))
        _gmin = float(st.session_state.get("flt_g_min", 0.0))
        _vmin = float(st.session_state.get("flt_v_min", 0.0))
        _qmin = float(st.session_state.get("flt_q_min", 0.0))
        _mmin = float(st.session_state.get("flt_m_min", 0.0))
        _an = sum([bool(_srch), _sec != "All", _cmin > 0,
                   _gmin > 0, _vmin > 0, _qmin > 0, _mmin > 0])

        view = _apply_screener_filters(df, _srch, _sec, _cmin,
                                       _gmin, _vmin, _qmin, _mmin)

        # panel header: filters icon + active-count badge + live result count
        _badge = f'<span class="flt-badge">{_an}</span>' if _an else ""
        _ncol = "#2563eb" if _an else "#1e293b"
        st.markdown(
            '<div class="flt-hdr"><div class="flt-hdr-top">'
            '<span class="flt-hdr-title">'
            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" '
            'stroke="#475569" stroke-width="2.2" stroke-linecap="round">'
            '<line x1="3" y1="6" x2="21" y2="6"/>'
            '<line x1="3" y1="12" x2="21" y2="12"/>'
            '<line x1="3" y1="18" x2="21" y2="18"/>'
            '<circle cx="9" cy="6" r="2.6" fill="#fff"/>'
            '<circle cx="15" cy="12" r="2.6" fill="#fff"/>'
            '<circle cx="7" cy="18" r="2.6" fill="#fff"/></svg>'
            f'Filters {_badge}</span></div>'
            f'<div class="flt-hdr-count"><span class="flt-n" '
            f'style="color:{_ncol}">{len(view):,}</span> of {len(df):,} '
            "companies</div></div>",
            unsafe_allow_html=True,
        )

        if _an > 0 and st.button("↺ Reset all filters", width="stretch",
                                 key="flt_reset_btn"):
            # assign defaults (don't pop): assignment resets the frontend
            # widget value too, popping leaves the old value live in the UI
            st.session_state.flt_search = ""
            st.session_state.flt_sector = "All"
            for _k in ("flt_comp_min", "flt_g_min",
                       "flt_v_min", "flt_q_min", "flt_m_min"):
                st.session_state[_k] = 0.0
            st.rerun()

        # search
        st.markdown('<div class="flt-label">Search</div>',
                    unsafe_allow_html=True)
        st.text_input("Search", placeholder="AAPL, Apple…",
                      key="flt_search", label_visibility="collapsed")

        # sector chips — tinted to match the table's sector pills; nth-of-type
        # rules are generated from the option order so each chip gets its color
        _sector_opts = ["All"] + sorted(df["sector"].dropna().unique().tolist())
        _ABBREV = {
            "Communication Services": "Comm. Svcs",
            "Consumer Discretionary": "Cons. Disc.",
            "Consumer Staples": "Cons. Staples",
            "Information Technology": "Info. Tech.",
        }
        _rules = []
        for _i, _s in enumerate(_sector_opts):
            if _s == "All":
                _bg, _fg, _abg, _afg = "#f1f5f9", "#475569", "#334155", "#ffffff"
            else:
                _bg, _fg = SECTOR_PILLS.get(_s, ("#f1f5f9", "#475569"))
                _abg, _afg = _fg, "#ffffff"
            _sel = ('section[data-testid="stSidebar"] '
                    'div[data-testid="stButtonGroup"] '
                    f"button:nth-of-type({_i + 1})")
            _rules.append(
                _sel + " { background: " + _bg + " !important; color: " + _fg
                + " !important; border-color: transparent !important; } "
                + _sel + '[data-testid="stBaseButton-pillsActive"] '
                + "{ background: " + _abg + " !important; color: " + _afg
                + " !important; }"
            )
        st.markdown(
            f"<style>{''.join(_rules)}</style>"
            '<div class="flt-label">Sector</div>',
            unsafe_allow_html=True,
        )
        st.pills("Sector", _sector_opts,
                 format_func=lambda x: _ABBREV.get(x, x),
                 selection_mode="single",
                 key="flt_sector", label_visibility="collapsed")

        # min composite
        _cbadge = f"{int(_cmin)}+" if _cmin > 0 else "Any"
        _ccol = "#1e293b" if _cmin > 0 else "#9ca3af"
        st.markdown(
            '<div class="flt-row"><span class="flt-label">Min composite</span>'
            f'<span class="flt-val mk-comp" style="color:{_ccol}">{_cbadge}'
            "</span></div>",
            unsafe_allow_html=True,
        )
        st.slider("Composite", 0.0, 100.0, step=1.0,
                  key="flt_comp_min", label_visibility="collapsed")

        # per-factor minimums — collapsed label carries the active summary
        _summ = [f"{_l} {int(_v)}+" for _l, _v in
                 [("Growth", _gmin), ("Value", _vmin),
                  ("Quality", _qmin), ("Momentum", _mmin)] if _v > 0]
        _exp_lbl = ("Per-factor · " + " · ".join(_summ)) if _summ \
            else "Per-factor minimums"
        with st.expander(_exp_lbl):
            for _fk, _fl, _fc, _mk, _fv in [
                ("flt_g_min", "Growth",   "#3b82f6", "mk-g", _gmin),
                ("flt_v_min", "Value",    "#10b981", "mk-v", _vmin),
                ("flt_q_min", "Quality",  "#a855f7", "mk-q", _qmin),
                ("flt_m_min", "Momentum", "#f59e0b", "mk-m", _mmin),
            ]:
                _b = f"{int(_fv)}+" if _fv > 0 else "Any"
                _bc = _fc if _fv > 0 else "#9ca3af"
                st.markdown(
                    '<div class="flt-row"><span class="flt-fname">'
                    f'<span class="flt-dot" style="background:{_fc}"></span>'
                    f'{_fl}</span><span class="flt-val {_mk}" '
                    f'style="color:{_bc}">{_b}</span></div>',
                    unsafe_allow_html=True,
                )
                st.slider(_fl, 0.0, 100.0, step=1.0,
                          key=_fk, label_visibility="collapsed")

        # active filter summary banner
        if _an > 0:
            st.markdown(
                f'<div class="flt-active-banner"><strong>{_an} filter'
                f'{"s" if _an > 1 else ""} active</strong>'
                '<div class="flt-active-sub">Table updates automatically</div>'
                "</div>",
                unsafe_allow_html=True,
            )

        st.markdown("---")
        if st.button("↻ Refresh data", width="stretch",
                     help="Re-query the database now"):
            st.cache_data.clear()
            st.rerun()
        st.caption("Cached for 6 h · pipeline updates nightly")

    # `view` is computed in the sidebar via _apply_screener_filters so the
    # panel header can show the live result count on the same rerun.

    # header + stat tiles ─────────────────────────────────────────────────────
    stale_days = None
    if isinstance(score_date, date):
        stale_days = (date.today() - score_date).days
    st.markdown(APP_CSS_TAG, unsafe_allow_html=True)

    # honest market-bar inputs: VIX last close from FRED; ADV/DEC from our own
    # nightly close-vs-prior-close (NaN comparisons are False, so they're skipped)
    vix = vix_chg = None
    vseq = load_macro_latest().get("VIXCLS")
    if vseq and vseq[0][1] is not None:
        vix = vseq[0][1]
        if len(vseq) > 1 and vseq[1][1] is not None:
            vix_chg = vix - vseq[1][1]
    adv = int((df["last_price"] > df["prev_close"]).sum())
    dec = int((df["last_price"] < df["prev_close"]).sum())

    components.html(
        screener_terminal_header_html(
            score_date, stale_days, vix, vix_chg, adv, dec, len(df),
        ),
        height=TERMINAL_HEADER_HEIGHT,
    )
    st.caption(
        "Quantitative factor rankings — growth · value · quality · momentum. "
        "Composite is a cross-sectional ranking within the S&P 500 universe "
        "(100 = top); it is **not** a buy signal or return prediction."
    )
    st.markdown(stats_row_html(df), unsafe_allow_html=True)

    # featured: top 3 by composite ────────────────────────────────────────────
    st.markdown("#### Highest composite rankings")
    st.caption(
        "The three top-ranked companies at the latest score date. "
        "A high ranking means strong relative factor readings — it is not a recommendation."
    )
    top3 = df[df["composite"].notna()].head(3)
    sparks = load_sparklines(tuple(top3["ticker"].tolist()))
    wl_set = load_watchlist_set()
    feat_cols = st.columns(3)
    for i, (_, row) in enumerate(top3.iterrows()):
        spark_vals = sparks.get(row["ticker"], [])
        t = row["ticker"]
        with feat_cols[i]:
            st.markdown(
                featured_card_html(
                    int(row["rank"]) if pd.notna(row["rank"]) else i + 1,
                    t, row["name"], row["composite"],
                    row["last_price"], spark_vals, FEATURED_GRADIENTS[i],
                ),
                unsafe_allow_html=True,
            )
            # Invisible Streamlit button overlaid on the dark card button above
            st.markdown('<div class="foa"></div>', unsafe_allow_html=True)
            if st.button("View Analysis", key=f"feat_{t}", width="stretch"):
                _nav_to(t)
            # Watchlist toggle — visible below
            if t in wl_set:
                st.button("★ Saved", key=f"wl_feat_{t}", width="stretch",
                          disabled=True)
            else:
                if st.button("☆ Save to Watchlist", key=f"wl_feat_{t}",
                             width="stretch"):
                    watchlist_add(int(row["security_id"]))
                    st.rerun()

    # table ───────────────────────────────────────────────────────────────────
    PREVIEW_N = 100
    expanded = st.session_state.get("screener_expand", False)
    # auto-collapse if filter brings results under the preview cap
    if len(view) <= PREVIEW_N:
        expanded = False
        st.session_state.screener_expand = False

    view_slice = view if expanded else view.head(PREVIEW_N)

    with st.container(border=True):
        st.markdown(screener_table_html(view_slice, len(view)), unsafe_allow_html=True)

    n_hidden = len(view) - len(view_slice)
    if n_hidden > 0:
        if st.button(f"▼  Show all {len(view):,} companies", width="stretch"):
            st.session_state.screener_expand = True
            st.rerun()
    elif expanded:
        if st.button("▲  Show top 100 only", width="stretch"):
            st.session_state.screener_expand = False
            st.rerun()


# ── deep-dive page ────────────────────────────────────────────────────────────

def show_deepdive(ticker: str) -> None:
    st.markdown(APP_CSS_TAG, unsafe_allow_html=True)
    info = load_company_header(ticker)
    price_df = load_price_history(ticker)

    # sidebar ─────────────────────────────────────────────────────────────────
    with st.sidebar:
        _sidebar_nav("deepdive")
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

    # watchlist toggle
    _dd_watchlist_toggle(ticker, int(info["security_id"]))
    st.markdown("")

    # ambient macro context strip (CONTEXT ONLY — never feeds factor scores) ───
    macro_latest = load_macro_latest()
    macro_strip = macro_strip_html(macro_latest)
    if macro_strip:
        st.markdown(
            '<div class="mc-heading">Macro backdrop '
            '<span class="mc-heading-sub">· market context, not a signal</span>'
            "</div>",
            unsafe_allow_html=True,
        )
        st.markdown(macro_strip, unsafe_allow_html=True)

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

        # opt-in macro overlay — OFF by default on purpose: a rate line on every
        # stock implies a relationship that's real for some names and noise for
        # most. Only offered when macro data is actually loaded.
        macro_on = False
        macro_pick = MACRO_DISPLAY[0][0]
        if macro_latest:
            mo1, mo2 = st.columns([1, 2])
            with mo1:
                macro_on = st.toggle(
                    "Macro backdrop", value=False, key="dd_macro_overlay",
                    help="Overlay one macro series on a secondary axis. Off by "
                         "default — a macro line on every stock implies a "
                         "relationship that is real for some names and noise "
                         "for most.",
                )
            with mo2:
                if macro_on:
                    macro_pick = st.selectbox(
                        "Macro series",
                        [s[0] for s in MACRO_DISPLAY],
                        format_func=lambda s: MACRO_LABEL.get(s, s),
                        index=0, key="dd_macro_series",
                        label_visibility="collapsed",
                    )

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

                # macro backdrop on a secondary axis (subordinate dotted line)
                macro_axis = None
                if macro_on:
                    mdf = load_macro_series(macro_pick)
                    if not mdf.empty:
                        mdf = mdf[mdf["date"] >= cutoff]
                    if mdf.empty:
                        st.caption(
                            f"No {MACRO_LABEL.get(macro_pick, macro_pick)} data "
                            "in this range yet — run scripts/ingest_macro.py."
                        )
                    else:
                        unit = MACRO_UNIT.get(macro_pick, "")
                        label = MACRO_LABEL.get(macro_pick, macro_pick)
                        fig.add_trace(go.Scatter(
                            x=mdf["date"], y=mdf["value"], mode="lines",
                            line={"color": "#94a3b8", "width": 1.5, "dash": "dot"},
                            name=f"{label} (macro)", yaxis="y2",
                            hovertemplate=(
                                "%{x|%b %d, %Y}: %{y:,.2f}" + unit + "<extra></extra>"
                            ),
                        ))
                        macro_axis = {
                            "overlaying": "y", "side": "right", "showgrid": False,
                            "title": {
                                "text": label + (f" ({unit})" if unit else ""),
                                "font": {"size": 11, "color": "#94a3b8"},
                            },
                            "tickfont": {"size": 10, "color": "#94a3b8"},
                        }

                layout = {
                    "height": 240,
                    "margin": {"l": 0, "r": 10, "t": 6, "b": 10},
                    "xaxis": {"showgrid": False},
                    "yaxis": {"tickprefix": "$", "showgrid": True,
                              "gridcolor": "#eef2f7"},
                    "plot_bgcolor": "rgba(0,0,0,0)",
                    "paper_bgcolor": "rgba(0,0,0,0)",
                    "hovermode": "x unified",
                    "showlegend": macro_axis is not None,
                    "legend": {"orientation": "h", "y": 1.16, "x": 0,
                               "font": {"size": 11}},
                }
                if macro_axis is not None:
                    layout["yaxis2"] = macro_axis
                    layout["margin"]["r"] = 36
                fig.update_layout(**layout)
                st.plotly_chart(fig, width="stretch", config={"displayModeBar": False})

    # no-data guard ───────────────────────────────────────────────────────────
    if not has_fundamentals and not has_scores:
        st.info(
            f"**No fundamental data available for {ticker}.** "
            "This security has no XBRL filings yet (likely a recent spinoff or IPO). "
            "Scores and metrics will populate automatically once filings are ingested "
            "by the weekly pipeline."
        )
        _show_thesis_section(info)
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

    st.markdown("")
    _show_thesis_section(info)
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


# ── deep-dive watchlist toggle ────────────────────────────────────────────────

def _dd_watchlist_toggle(ticker: str, security_id: int) -> None:
    wl_set = load_watchlist_set()
    in_wl = ticker in wl_set
    wl_col, _ = st.columns([2, 6])
    with wl_col:
        if in_wl:
            if st.button("★ In Watchlist · Remove?", key="dd_wl_btn",
                         width="stretch", type="secondary"):
                st.session_state["dd_wl_confirm"] = True
        else:
            if st.button("☆ Add to Watchlist", key="dd_wl_btn",
                         width="stretch", type="secondary"):
                watchlist_add(security_id)
                st.rerun()
    if st.session_state.get("dd_wl_confirm"):
        c1, c2, _ = st.columns([1.2, 1, 6])
        with c1:
            if st.button("Confirm remove", key="dd_wl_yes", type="primary"):
                watchlist_remove(security_id)
                st.session_state.pop("dd_wl_confirm", None)
                st.rerun()
        with c2:
            if st.button("Cancel", key="dd_wl_cancel"):
                st.session_state.pop("dd_wl_confirm", None)
                st.rerun()


# ── thesis section (deep-dive) ────────────────────────────────────────────────

def _show_thesis_section(info: dict) -> None:
    ticker = info["ticker"]
    security_id = int(info["security_id"])
    thesis = load_thesis(ticker)
    editing = st.session_state.get(f"thesis_edit_{ticker}", False)

    with st.expander("📝 Investment thesis", expanded=bool(thesis)):
        # --- delete confirm ---
        if st.session_state.get(f"thesis_del_confirm_{ticker}"):
            st.warning("Delete this thesis permanently?")
            dc1, dc2, _ = st.columns([1, 1, 5])
            with dc1:
                if st.button("Yes, delete", key=f"tdel_yes_{ticker}", type="primary"):
                    thesis_delete(int(thesis["id"]))
                    st.session_state.pop(f"thesis_del_confirm_{ticker}", None)
                    st.session_state.pop(f"thesis_edit_{ticker}", None)
                    st.rerun()
            with dc2:
                if st.button("Cancel", key=f"tdel_cancel_{ticker}"):
                    st.session_state.pop(f"thesis_del_confirm_{ticker}", None)
                    st.rerun()
            return

        # --- show saved thesis ---
        if thesis and not editing:
            upd = thesis.get("updated_at")
            upd_str = upd.strftime("%b %d, %Y") if hasattr(upd, "strftime") else str(upd or "")
            st.caption(f"Last updated {upd_str}")
            st.markdown(
                f'<div class="thesis-block">'
                f'<div class="thesis-label">Thesis</div>'
                f'<div class="thesis-text">{escape(thesis["summary"])}</div>'
                f'</div>',
                unsafe_allow_html=True,
            )
            if thesis.get("invalidation_rules"):
                st.markdown(
                    f'<div class="thesis-block">'
                    f'<div class="thesis-label">Exit / invalidation condition</div>'
                    f'<div class="thesis-text">{escape(thesis["invalidation_rules"])}</div>'
                    f'</div>',
                    unsafe_allow_html=True,
                )
            if thesis.get("review_date"):
                rd = thesis["review_date"]
                rd_str = rd.strftime("%b %d, %Y") if hasattr(rd, "strftime") else str(rd)
                overdue = (rd <= date.today()) if rd else False
                if overdue:
                    st.markdown(
                        f'<span class="review-badge">Review due</span> {rd_str}',
                        unsafe_allow_html=True,
                    )
                else:
                    st.caption(f"Review date: {rd_str}")

            ec1, ec2, _ = st.columns([1, 1, 5])
            with ec1:
                if st.button("✏️ Edit", key=f"thesis_edit_btn_{ticker}"):
                    st.session_state[f"thesis_edit_{ticker}"] = True
                    st.rerun()
            with ec2:
                if st.button("🗑️ Delete", key=f"thesis_del_btn_{ticker}"):
                    st.session_state[f"thesis_del_confirm_{ticker}"] = True
                    st.rerun()
            return

        # --- create / edit form ---
        default_summary = thesis["summary"] if thesis else ""
        default_inv = thesis.get("invalidation_rules") or "" if thesis else ""
        default_date = thesis.get("review_date") if thesis else None

        with st.form(key=f"thesis_form_{ticker}"):
            st.markdown("**Write your thesis**" if not thesis else "**Edit thesis**")
            summary_text = st.text_area(
                "Your view on this company *",
                value=default_summary,
                placeholder=(
                    "Why does this company deserve a position? "
                    "What is the core investment case?"
                ),
                height=120,
            )
            inv_text = st.text_area(
                "Exit / invalidation condition",
                value=default_inv,
                placeholder=(
                    "What would make you change your mind? "
                    "e.g. gross margin falls below 30%, loses key contract"
                ),
                height=80,
            )
            review_dt = st.date_input(
                "Review date (optional)",
                value=default_date,
                help="Set a future date to revisit this thesis",
            )
            submitted = st.form_submit_button("Save thesis")

        if submitted:
            if not summary_text.strip():
                st.error("Thesis text cannot be empty.")
            else:
                thesis_save(
                    security_id,
                    summary_text.strip(),
                    inv_text.strip(),
                    review_dt,
                )
                st.session_state.pop(f"thesis_edit_{ticker}", None)
                st.rerun()

        if not thesis:
            st.caption(
                "Record your investment case, the condition that would make you exit, "
                "and a date to review it."
            )


# ── watchlist page ────────────────────────────────────────────────────────────

def show_watchlist() -> None:
    st.markdown(APP_CSS_TAG, unsafe_allow_html=True)

    with st.sidebar:
        _sidebar_nav("watchlist")
        st.markdown("---")
        if st.button("↻ Refresh data", width="stretch"):
            st.cache_data.clear()
            st.rerun()

    st.markdown("## ⭐ Watchlist")

    wl_df = load_watchlist()

    if wl_df.empty:
        with st.container(border=True):
            st.info(
                "No saved names yet — add one from the screener or from any "
                "company's deep-dive page."
            )
            if st.button("Go to Screener →", key="wl_empty_go"):
                st.session_state.page = "screener"
                st.session_state.selected_ticker = None
                st.query_params.clear()
                st.rerun()
        return

    st.caption(f"{len(wl_df)} saved {'company' if len(wl_df) == 1 else 'companies'}")

    display = wl_df[[
        "ticker", "name", "sector",
        "composite", "growth_pctl", "value_pctl", "quality_pctl", "momentum_pctl",
        "last_price",
    ]].copy().reset_index(drop=True)
    for col in ("composite", "growth_pctl", "value_pctl", "quality_pctl", "momentum_pctl"):
        display[col] = pd.to_numeric(display[col], errors="coerce").round(1)

    event = st.dataframe(
        display,
        width="stretch",
        hide_index=True,
        height=min(55 * len(display) + 55, 560),
        on_select="rerun",
        selection_mode="single-row",
        column_config={
            "ticker":       st.column_config.TextColumn("Ticker",    width=75),
            "name":         st.column_config.TextColumn("Company",   width=200),
            "sector":       st.column_config.TextColumn("Sector",    width=155),
            "composite":    st.column_config.ProgressColumn(
                "Composite", min_value=0, max_value=100, format="%.1f", width=130),
            "growth_pctl":  st.column_config.ProgressColumn(
                "Growth",    min_value=0, max_value=100, format="%.1f", width=110),
            "value_pctl":   st.column_config.ProgressColumn(
                "Value",     min_value=0, max_value=100, format="%.1f", width=110),
            "quality_pctl": st.column_config.ProgressColumn(
                "Quality",   min_value=0, max_value=100, format="%.1f", width=110),
            "momentum_pctl":st.column_config.ProgressColumn(
                "Momentum",  min_value=0, max_value=100, format="%.1f", width=110),
            "last_price":   st.column_config.NumberColumn(
                "Last Price", format="$%.2f", width=95),
        },
    )

    if event.selection and event.selection.rows:
        sel_ticker = display.iloc[event.selection.rows[0]]["ticker"]
        _nav_to(sel_ticker)

    # remove section
    with st.container(border=True):
        st.markdown("**Remove from watchlist**")
        remove_ticker = st.selectbox(
            "Company to remove",
            ["— select —"] + wl_df["ticker"].tolist(),
            label_visibility="collapsed",
            key="wl_remove_sel",
        )
        if remove_ticker != "— select —":
            match = wl_df[wl_df["ticker"] == remove_ticker].iloc[0]
            st.warning(
                f"Remove **{remove_ticker}** ({match['name']}) from your watchlist?"
            )
            rc1, rc2, _ = st.columns([1, 1, 5])
            with rc1:
                if st.button("Yes, remove", key="wl_rm_yes", type="primary"):
                    watchlist_remove(int(match["security_id"]))
                    st.rerun()
            with rc2:
                if st.button("Cancel", key="wl_rm_cancel"):
                    st.rerun()


# ── thesis tracker page ───────────────────────────────────────────────────────

def _render_thesis_tracker_row(row: pd.Series, review_due: bool) -> None:
    with st.container(border=True):
        c1, c2, c3, c4 = st.columns([1.5, 4, 2, 1])
        with c1:
            st.markdown(f"**{row['ticker']}**")
            st.caption(row.get("sector") or "—")
            comp = _f(row.get("composite"))
            if comp is not None:
                st.caption(f"Composite: {comp:.1f}")
        with c2:
            summary = str(row.get("summary") or "")
            st.markdown(summary[:160] + ("…" if len(summary) > 160 else ""))
            inv = str(row.get("invalidation_rules") or "")
            if inv:
                st.caption(
                    "Exit: " + inv[:100] + ("…" if len(inv) > 100 else "")
                )
        with c3:
            rd = row.get("review_date")
            if rd:
                rd_str = rd.strftime("%b %d, %Y") if hasattr(rd, "strftime") else str(rd)
                if review_due:
                    st.markdown(
                        f'<span class="review-badge">Review due</span><br>{rd_str}',
                        unsafe_allow_html=True,
                    )
                else:
                    st.caption(f"Review: {rd_str}")
            else:
                st.caption("No review date")
        with c4:
            if st.button("Open →", key=f"th_open_{row['thesis_id']}",
                         width="stretch"):
                _nav_to(row["ticker"])


def show_theses() -> None:
    st.markdown(APP_CSS_TAG, unsafe_allow_html=True)

    with st.sidebar:
        _sidebar_nav("theses")
        st.markdown("---")
        if st.button("↻ Refresh data", width="stretch"):
            st.cache_data.clear()
            st.rerun()

    st.markdown("## 📝 Thesis Tracker")
    st.caption(
        "Your investment theses — one per company. "
        "Review-due theses appear first."
    )

    theses_df = load_all_theses()

    if theses_df.empty:
        with st.container(border=True):
            st.info(
                "No theses written yet. Open any company's deep-dive and "
                "write your first thesis there."
            )
            if st.button("Go to Screener →", key="th_empty_go"):
                st.session_state.page = "screener"
                st.session_state.selected_ticker = None
                st.query_params.clear()
                st.rerun()
        return

    today = date.today()
    due_mask = theses_df["review_date"].notna() & (theses_df["review_date"] <= today)
    due_df = theses_df[due_mask]
    active_df = theses_df[~due_mask]

    if not due_df.empty:
        st.markdown(
            f"#### Review due — {len(due_df)} "
            f"{'thesis' if len(due_df) == 1 else 'theses'}"
        )
        for _, row in due_df.iterrows():
            _render_thesis_tracker_row(row, review_due=True)

    if not active_df.empty:
        st.markdown("#### Active theses" if due_df.empty else "#### Upcoming")
        for _, row in active_df.iterrows():
            _render_thesis_tracker_row(row, review_due=False)


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

    page = st.session_state.page
    if page == "deepdive" and st.session_state.selected_ticker:
        show_deepdive(st.session_state.selected_ticker)
    elif page == "watchlist":
        show_watchlist()
    elif page == "theses":
        show_theses()
    else:
        show_screener()


if __name__ == "__main__":
    main()

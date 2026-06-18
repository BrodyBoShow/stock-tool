"""SEC form taxonomy — one source of truth for which filings we catalog, how we
label/group them in the UI, and which the AI can analyze (and how).

Used by:
- engine/filing_catalog.py  → CATALOG_FORMS decides what the nightly records.
- api/routers/securities.py → form_label / form_category enrich the Filings list.
- engine/summarize.py, filing_qa.py → analysis_profile / generic_focus drive the
  form-aware AI read.

Everything here is metadata only (no network, no cost). Amendments ("…/A") are
handled generically so we don't have to enumerate every "-/A" variant.
"""
from __future__ import annotations

# base form -> (plain-English label, display category)
_FORM_INFO: dict[str, tuple[str, str]] = {
    # ── Annual reports ──
    "10-K": ("Annual report (10-K)", "Annual report"),
    "20-F": ("Annual report — foreign issuer (20-F)", "Annual report"),
    "40-F": ("Annual report — Canadian issuer (40-F)", "Annual report"),
    "11-K": ("Employee benefit plan annual report (11-K)", "Annual report"),
    "ARS": ("Annual report to shareholders (ARS)", "Annual report"),
    # ── Quarterly reports ──
    "10-Q": ("Quarterly report (10-Q)", "Quarterly report"),
    # ── Current reports ──
    "8-K": ("Current report (8-K)", "Current report"),
    "6-K": ("Current report — foreign issuer (6-K)", "Current report"),
    # ── Proxy & governance ──
    "DEF 14A": ("Proxy statement (DEF 14A)", "Proxy & governance"),
    "DEFA14A": ("Additional proxy materials (DEFA14A)", "Proxy & governance"),
    "DEFM14A": ("Merger / special-meeting proxy (DEFM14A)", "Proxy & governance"),
    "DEFC14A": ("Contested proxy statement (DEFC14A)", "Proxy & governance"),
    "DEFR14A": ("Revised proxy statement (DEFR14A)", "Proxy & governance"),
    "PRE 14A": ("Preliminary proxy statement (PRE 14A)", "Proxy & governance"),
    "PREM14A": ("Preliminary merger proxy (PREM14A)", "Proxy & governance"),
    # ── Ownership & insiders ──
    "SC 13D": ("Activist stake — >5% with intent (SC 13D)", "Ownership & insiders"),
    "SC 13G": ("Passive stake — >5% (SC 13G)", "Ownership & insiders"),
    "SC 13E3": ("Going-private transaction (SC 13E3)", "Ownership & insiders"),
    "3": ("Insider initial holdings (Form 3)", "Ownership & insiders"),
    "4": ("Insider transaction (Form 4)", "Ownership & insiders"),
    "5": ("Insider annual summary (Form 5)", "Ownership & insiders"),
    # ── Tender & M&A ──
    "SC TO-T": ("Third-party tender offer (SC TO-T)", "Tender & M&A"),
    "SC TO-I": ("Issuer tender offer / buyback (SC TO-I)", "Tender & M&A"),
    "SC 14D9": ("Tender-offer response (SC 14D9)", "Tender & M&A"),
    "425": ("M&A communication (425)", "Tender & M&A"),
    # ── Offerings & registration ──
    "S-1": ("IPO / securities registration (S-1)", "Offering & registration"),
    "S-3": ("Shelf registration (S-3)", "Offering & registration"),
    "S-4": ("M&A / exchange registration (S-4)", "Offering & registration"),
    "S-8": ("Employee stock-plan registration (S-8)", "Offering & registration"),
    "F-1": ("Foreign issuer registration (F-1)", "Offering & registration"),
    "F-3": ("Foreign issuer shelf (F-3)", "Offering & registration"),
    "F-4": ("Foreign issuer M&A registration (F-4)", "Offering & registration"),
    "424B1": ("Prospectus (424B1)", "Offering & registration"),
    "424B2": ("Prospectus (424B2)", "Offering & registration"),
    "424B3": ("Prospectus (424B3)", "Offering & registration"),
    "424B4": ("Prospectus — priced offering (424B4)", "Offering & registration"),
    "424B5": ("Prospectus — shelf takedown (424B5)", "Offering & registration"),
    # ── Status & other ──
    "NT 10-K": ("Late-filing notice — annual (NT 10-K)", "Status & other"),
    "NT 10-Q": ("Late-filing notice — quarterly (NT 10-Q)", "Status & other"),
    "SD": ("Specialized disclosure — conflict minerals (SD)", "Status & other"),
    "8-A12B": ("Securities registration / listing (8-A12B)", "Status & other"),
    "25-NSE": ("Delisting notice (25-NSE)", "Status & other"),
    "15-12B": ("Deregistration (15-12B)", "Status & other"),
}

# Display order for grouping the Filings list.
CATEGORY_ORDER = [
    "Annual report", "Quarterly report", "Current report", "Proxy & governance",
    "Ownership & insiders", "Tender & M&A", "Offering & registration",
    "Status & other",
]

# Forms the catalog ingest records (base + the "…/A" amendment of each). This is
# the curated "everything that matters for research" set — EDGAR's long tail of
# purely administrative forms (CERT, EFFECT, FWP, CORRESP, …) is deliberately
# excluded so the Filings list stays signal, not noise.
CATALOG_FORMS: frozenset[str] = frozenset(
    set(_FORM_INFO) | {f"{base}/A" for base in _FORM_INFO}
)

# Forms too thin or too structured for a useful free-text AI read: Section 16
# insider XML (3/4/5 — already parsed by insiders.py), bare status notices, and
# listing/dereg housekeeping. Everything else routes to the generic reader.
_NON_ANALYZABLE: frozenset[str] = frozenset({
    "3", "4", "5", "NT 10-K", "NT 10-Q", "25-NSE", "15-12B", "8-A12B", "SD",
})


def _base(form: str) -> str:
    """Strip a trailing amendment marker so '10-K/A' resolves like '10-K'."""
    return form[:-2] if form.endswith("/A") else form


def form_label(form: str | None) -> str:
    """Plain-English label for a form code; amendments get an ' (amended)' tag."""
    if not form:
        return "Filing"
    base = _base(form)
    label, _cat = _FORM_INFO.get(base, (form, "Status & other"))
    return f"{label} — amended" if form.endswith("/A") and base in _FORM_INFO else label


def form_category(form: str | None) -> str:
    """Display category for a form code; unknown forms fall to 'Status & other'."""
    if not form:
        return "Status & other"
    _label, cat = _FORM_INFO.get(_base(form), (form, "Status & other"))
    return cat


def analysis_profile(form: str | None) -> str | None:
    """How the AI should read this form, or None if it isn't worth analyzing.

    - 'annual_10k' : domestic 10-K / 10-Q item-anchored extraction.
    - 'annual_20f' : foreign 20-F item-anchored extraction.
    - 'generic'    : any other narrative filing (40-F, proxy, S-1, 424B, 13D, 6-K)
                     read via a capped whole-document pass.
    """
    if not form:
        return None
    base = _base(form)
    if base in ("10-K", "10-Q"):
        return "annual_10k"
    if base == "20-F":
        return "annual_20f"
    if base in _NON_ANALYZABLE:
        return None
    return "generic"


def generic_focus(form: str | None) -> str:
    """A one-line, form-tailored steer for the generic AI reader."""
    cat = form_category(form)
    return {
        "Proxy & governance": (
            "Focus on executive compensation, board/director changes, shareholder "
            "proposals, and any merger or special-meeting terms being voted on."
        ),
        "Ownership & insiders": (
            "Focus on who is filing, the percentage of the company they own, how "
            "that changed, and any stated plans or intentions toward the company."
        ),
        "Tender & M&A": (
            "Focus on the deal: price/consideration, who is acquiring whom, "
            "conditions, financing, termination fees, and the timeline."
        ),
        "Offering & registration": (
            "Focus on the size and type of offering, the use of proceeds, dilution "
            "to existing holders, and the key terms and risks."
        ),
        "Current report": (
            "Focus on the specific material event or results being reported and why "
            "it matters to an investor."
        ),
        "Annual report": (
            "Focus on what the business does, financial performance and trends, and "
            "the most material risks."
        ),
    }.get(cat, "Summarize what is most material to an investor, grounded in the text.")

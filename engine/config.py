"""Centralized runtime config (env-overridable).

Keeps the LLM model id in ONE place — every on-demand AI feature (decision
briefs, 10-K summaries, filing Q&A, the market brief) shares it, so switching
models or A/B-ing cost is a single env var instead of edits across four modules.
Default is Haiku (the cost posture: budget model everywhere, on demand only).
"""
from __future__ import annotations

import os

# Model used by all on-demand AI features. Override with LLM_MODEL in the env.
LLM_MODEL = os.getenv("LLM_MODEL", "claude-haiku-4-5")

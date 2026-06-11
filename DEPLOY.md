# Deploying StockBud (private link, public-ready)

The site = **frontend** (static React) + **backend** (FastAPI) + **Supabase**
(already hosted). You deploy the first two once; after that every `git push`
auto-redeploys both. You need two free accounts: **Render** (backend) and
**Vercel** (frontend). I can't create these for you — the link is generated in
your accounts.

Private vs public is one env var: `APP_ACCESS_PASSWORD`.
- **Set** it → the site asks for that password before showing anything.
- **Delete** it (and redeploy) → fully public. No code change.

---

## 1. Backend → Render (~10 min)

1. Sign in at <https://dashboard.render.com> with GitHub.
2. **New → Blueprint**, pick the `stock-tool` repo. Render reads `render.yaml`.
3. When prompted, fill the env vars (values stay private, never in git):
   - `DATABASE_URL` — your Supabase pooler URI (port 6543), same as your `.env`.
   - `SEC_USER_AGENT` — `Your Name your@email`.
   - `ANTHROPIC_API_KEY` — your key (powers the AI deep-dives).
   - `FRED_API_KEY` — optional (macro strip).
   - `APP_ACCESS_PASSWORD` — **choose any password** → this makes it private.
   - `ALLOWED_ORIGINS` — leave blank for now; fill in step 3.
4. Create the service. When it's live, copy its URL, e.g.
   `https://stockbud-api.onrender.com`. Open `<that URL>/health` → should show
   `{"status":"ok","db":"ok"}`.

> Plan: `render.yaml` defaults to **Starter (~$7/mo, always-on)**. To trial for
> free, change `plan: starter` → `plan: free` (it sleeps after 15 min idle →
> ~30 s cold start, and the live-score endpoint may be tight on RAM).

## 2. Frontend → Vercel (~5 min)

1. Sign in at <https://vercel.com> with GitHub → **Add New → Project** → the
   `stock-tool` repo.
2. Set **Root Directory = `frontend`** (Vercel auto-detects Vite + `vercel.json`).
3. Add one env var:
   - `VITE_API_URL` = your Render URL from step 1 (e.g.
     `https://stockbud-api.onrender.com`).
4. Deploy. You get your link, e.g. `https://stockbud.vercel.app`.

## 3. Connect the two

1. Back in Render → the service → **Environment** → set
   `ALLOWED_ORIGINS` = your Vercel URL (e.g. `https://stockbud.vercel.app`) →
   save (it redeploys).
2. Open your Vercel link → it prompts for the password → enter the one you set
   in `APP_ACCESS_PASSWORD`. You're in. Share the link + password with anyone
   you want; nobody else gets past the prompt.

## Going public later

Render → service → Environment → **delete** `APP_ACCESS_PASSWORD` → save. The
password screen disappears for everyone. (Re-add it any time to lock it again.)
Before going public, consider rate-limiting the AI endpoints — each deep-dive
brief/filing-Q&A bills your Anthropic key.

## Notes

- The nightly data refresh already runs on GitHub Actions — independent of
  these hosts. Your machine stays off.
- Every push to `main` redeploys both Render and Vercel automatically.
- `.env` is still git-ignored; all secrets live only in the Render/Vercel
  dashboards.

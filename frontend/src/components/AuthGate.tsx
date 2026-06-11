import { useEffect, useState } from 'react'

import { checkAuth, setAppPassword } from '@/lib/api'

type Phase = 'checking' | 'locked' | 'open'

/**
 * Private-mode gate. Probes /auth/check on load:
 *  - open  → render the app (public mode, or password already valid)
 *  - locked → show a password screen; on submit, store + re-probe
 *
 * When the API has no APP_ACCESS_PASSWORD set, the probe returns ok and this
 * is invisible — so the same build serves both private and public deploys.
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const [phase, setPhase] = useState<Phase>('checking')
  const [pw, setPw] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    void checkAuth().then((r) => setPhase(r.ok ? 'open' : 'locked'))
  }, [])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    setAppPassword(pw.trim())
    const r = await checkAuth()
    setSubmitting(false)
    if (r.ok) {
      setPhase('open')
    } else {
      setAppPassword('')
      setError('Incorrect password.')
    }
  }

  if (phase === 'checking') {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-[#94a3b8]">
        Loading…
      </div>
    )
  }

  if (phase === 'locked') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f8fafc] px-6">
        <form
          onSubmit={submit}
          className="w-full max-w-[360px] rounded-2xl border border-[#e5e7eb] bg-white p-7 shadow-[0_4px_24px_rgba(15,23,42,0.08)]"
        >
          <div className="flex items-center gap-2 text-[0.72rem] font-semibold uppercase tracking-[0.16em]">
            <span className="text-[#4f46e5]">StockBud</span>
          </div>
          <h1 className="mt-2 text-[1.4rem] font-extrabold text-[#0f172a]">Private access</h1>
          <p className="mt-1 text-[0.85rem] text-[#64748b]">
            Enter the access password to continue.
          </p>
          <input
            type="password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            autoFocus
            placeholder="Password"
            className="mt-4 w-full rounded-lg border border-[#e5e7eb] bg-white px-3 py-2 text-sm text-[#111827] focus:border-[#4f46e5] focus:outline-none"
          />
          {error && <p className="mt-2 text-[0.8rem] font-medium text-[#dc2626]">{error}</p>}
          <button
            type="submit"
            disabled={submitting || !pw.trim()}
            className="mt-4 w-full rounded-lg bg-[#4f46e5] px-3 py-2 text-sm font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {submitting ? 'Checking…' : 'Enter'}
          </button>
        </form>
      </div>
    )
  }

  return <>{children}</>
}

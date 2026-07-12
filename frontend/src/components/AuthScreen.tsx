import { useState } from 'react'

import { TickerBackdrop } from '@/components/TickerBackdrop'
import { supabase } from '@/lib/supabase'

type Mode = 'signin' | 'signup'

/**
 * Email + password auth on a dark, branded page: a faint scrolling ticker
 * backdrop + glow behind a frosted card, the StockBud mark, and feature pills —
 * so it reads like a product, not a bare form. Shown by AuthGate when there's no
 * session; on success the SDK fires onAuthStateChange and AuthGate swaps in the app.
 */
export function AuthScreen() {
  const [mode, setMode] = useState<Mode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    setNotice(null)

    const creds = { email: email.trim(), password }
    try {
      if (mode === 'signup') {
        const { data, error: err } = await supabase.auth.signUp(creds)
        if (err) {
          setError(err.message)
        } else if (!data.session) {
          setNotice('Check your email to confirm your account, then sign in.')
        }
      } else {
        const { error: err } = await supabase.auth.signInWithPassword(creds)
        if (err) setError(err.message)
      }
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  function switchMode(next: Mode) {
    setMode(next)
    setError(null)
    setNotice(null)
  }

  const inputCls =
    'w-full rounded-lg border border-white/10 bg-stone-900/80 px-3.5 py-2.5 text-sm ' +
    'text-white placeholder-stone-500 outline-none focus:border-amber-400 ' +
    'focus:ring-2 focus:ring-amber-400/30'

  return (
    <div
      className="relative flex min-h-screen items-center justify-center overflow-hidden px-4"
      style={{ background: 'linear-gradient(160deg, #0e0c0a 0%, #14110d 58%, #241c11 100%)' }}
    >
      <TickerBackdrop />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-0"
        style={{
          backgroundImage:
            'radial-gradient(55% 45% at 50% 36%, rgba(251,191,36,0.10), transparent 70%)',
        }}
      />

      <div className="relative z-10 w-full max-w-sm">
        {/* brand mark + wordmark */}
        <div className="mb-5 flex items-center justify-center gap-2.5">
          <img src="/logo-dark.png" alt="" aria-hidden="true" className="h-9 w-auto" />
          <span className="text-lg font-bold tracking-tight">
            <span className="text-white">Stock</span>
            <span className="text-amber-400">Bud</span>
          </span>
        </div>

        {/* card */}
        <div className="rounded-xl border border-white/10 bg-stone-950/80 p-7 shadow-2xl shadow-black/40 backdrop-blur">
          <h1 className="text-[1.4rem] font-bold text-white">
            {mode === 'signin' ? 'Welcome back' : 'Create your account'}
          </h1>
          <p className="mt-1 text-[0.85rem] text-slate-400">
            {mode === 'signin'
              ? 'Sign in to your StockBud account.'
              : 'Sign up to start tracking your portfolio and theses.'}
          </p>

          <form onSubmit={submit} className="mt-5 space-y-3">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
              autoComplete="email"
              placeholder="you@email.com"
              className={inputCls}
            />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={mode === 'signup' ? 8 : undefined}
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              placeholder={mode === 'signup' ? 'Choose a password (8+ chars)' : 'Password'}
              className={inputCls}
            />

            {error && <p className="text-sm font-medium text-rose-400">{error}</p>}
            {notice && <p className="text-sm font-medium text-emerald-400">{notice}</p>}

            <button
              type="submit"
              disabled={submitting || !email.trim() || !password}
              className="w-full rounded-lg bg-amber-400 px-4 py-2.5 text-sm font-semibold text-stone-950 transition hover:bg-amber-300 disabled:opacity-50"
            >
              {submitting
                ? mode === 'signin'
                  ? 'Signing in…'
                  : 'Creating…'
                : mode === 'signin'
                  ? 'Sign in'
                  : 'Sign up'}
            </button>
          </form>

          <p className="mt-5 text-center text-[0.8rem] text-slate-400">
            {mode === 'signin' ? (
              <>
                No account?{' '}
                <button
                  type="button"
                  onClick={() => switchMode('signup')}
                  className="font-semibold text-amber-400 hover:text-amber-300"
                >
                  Sign up
                </button>
              </>
            ) : (
              <>
                Already have an account?{' '}
                <button
                  type="button"
                  onClick={() => switchMode('signin')}
                  className="font-semibold text-amber-400 hover:text-amber-300"
                >
                  Sign in
                </button>
              </>
            )}
          </p>

          <p className="mt-4 text-center text-[0.7rem] leading-relaxed text-slate-500">
            Informational tool — not investment advice.
          </p>
        </div>

        {/* feature pills */}
        <div className="mt-5 flex flex-wrap items-center justify-center gap-x-2 gap-y-1.5 text-[0.7rem] text-slate-400">
          {['Factor screener', 'AI decision briefs', 'Portfolio analytics'].map((f) => (
            <span key={f} className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1">
              {f}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

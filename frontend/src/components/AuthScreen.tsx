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
    'w-full rounded-lg border border-white/10 bg-slate-800/80 px-3.5 py-2.5 text-sm ' +
    'text-white placeholder-slate-500 outline-none focus:border-indigo-500 ' +
    'focus:ring-2 focus:ring-indigo-500/30'

  return (
    <div
      className="relative flex min-h-screen items-center justify-center overflow-hidden px-4"
      style={{ background: 'linear-gradient(160deg, #0f172a 0%, #1e1b4b 58%, #312e81 100%)' }}
    >
      <TickerBackdrop />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-0"
        style={{
          backgroundImage:
            'radial-gradient(55% 45% at 50% 36%, rgba(99,102,241,0.18), transparent 70%)',
        }}
      />

      <div className="relative z-10 w-full max-w-sm">
        {/* brand mark + wordmark */}
        <div className="mb-5 flex items-center justify-center gap-2.5">
          <svg viewBox="0 0 280 148" className="h-9 w-auto" fill="none" aria-hidden="true">
            <path
              d="M28.0,118.0 C31.3,117.0 42.3,113.3 48.0,112.0 C53.7,110.7 57.7,114.7 62.0,110.0 C66.3,105.3 70.7,89.0 74.0,84.0 C77.3,79.0 79.0,80.8 82.0,80.0 C85.0,79.2 88.7,79.0 92.0,79.0 C95.3,79.0 99.0,79.2 102.0,80.0 C105.0,80.8 106.7,79.0 110.0,84.0 C113.3,89.0 118.7,105.5 122.0,110.0 C125.3,114.5 127.3,111.3 130.0,111.0 C132.7,110.7 135.3,114.5 138.0,108.0 C140.7,101.5 144.0,79.7 146.0,72.0 C148.0,64.3 148.3,63.8 150.0,62.0 C151.7,60.2 154.0,61.0 156.0,61.0 C158.0,61.0 159.7,60.2 162.0,62.0 C164.3,63.8 166.3,65.7 170.0,72.0 C173.7,78.3 177.7,99.7 184.0,100.0 C190.3,100.3 200.0,82.0 208.0,74.0 C216.0,66.0 224.7,57.7 232.0,52.0 C239.3,46.3 248.7,42.0 252.0,40.0"
              stroke="#818cf8"
              strokeWidth={12}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <line x1="252" y1="40" x2="226" y2="38" stroke="#818cf8" strokeWidth={12} strokeLinecap="round" />
            <line x1="252" y1="40" x2="241" y2="64" stroke="#818cf8" strokeWidth={12} strokeLinecap="round" />
            <circle cx="92" cy="62" r="13" fill="#ffffff" />
            <circle cx="156" cy="40" r="17" fill="#ffffff" />
          </svg>
          <span className="text-lg font-extrabold tracking-tight">
            <span className="text-white">Stock</span>
            <span className="text-indigo-400">Bud</span>
          </span>
        </div>

        {/* card */}
        <div className="rounded-2xl border border-white/10 bg-slate-900/80 p-7 shadow-2xl shadow-indigo-950/40 backdrop-blur">
          <h1 className="text-[1.4rem] font-extrabold text-white">
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
              className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:opacity-50"
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
                  className="font-semibold text-indigo-400 hover:text-indigo-300"
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
                  className="font-semibold text-indigo-400 hover:text-indigo-300"
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

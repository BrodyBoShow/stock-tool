import { useState } from 'react'

import { supabase } from '@/lib/supabase'

type Mode = 'signin' | 'signup'

/**
 * Email + password auth, mirroring the landing page's sign-up UX (dark slate
 * card, indigo accent). Shown by AuthGate whenever there's no active session.
 * On success the SDK fires onAuthStateChange and AuthGate swaps in the app —
 * we don't navigate ourselves.
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
          // Email-confirmation is on: no session yet until they click the link.
          setNotice('Check your email to confirm your account, then sign in.')
        }
        // If a session came back, onAuthStateChange will mount the app.
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
    'w-full rounded-lg border border-white/10 bg-slate-800 px-3.5 py-2.5 text-sm ' +
    'text-white placeholder-slate-500 outline-none focus:border-indigo-500 ' +
    'focus:ring-2 focus:ring-indigo-500/30'

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4">
      <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-slate-900 p-7 shadow-2xl">
        <div className="flex items-center gap-2 text-[0.72rem] font-semibold uppercase tracking-[0.16em]">
          <span className="text-white">Stock</span>
          <span className="-ml-1 text-indigo-400">Bud</span>
        </div>
        <h1 className="mt-2 text-[1.4rem] font-extrabold text-white">
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
    </div>
  )
}

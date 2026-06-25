import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'

import { AuthScreen } from '@/components/AuthScreen'
import { supabase } from '@/lib/supabase'

type Phase = 'checking' | 'unauthenticated' | 'authenticated'

/**
 * Session gate. Resolves the current Supabase session on mount and tracks it
 * via onAuthStateChange (login, logout, token refresh):
 *  - checking        → brief spinner; we do NOT flash the login screen while
 *                      getSession() is still resolving a restored session.
 *  - unauthenticated → <AuthScreen/> (email/password login + signup)
 *  - authenticated   → render the app
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const [phase, setPhase] = useState<Phase>('checking')

  useEffect(() => {
    let active = true
    const apply = (session: Session | null) => {
      if (active) setPhase(session ? 'authenticated' : 'unauthenticated')
    }

    void supabase.auth.getSession().then(({ data }) => apply(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) =>
      apply(session),
    )

    return () => {
      active = false
      sub.subscription.unsubscribe()
    }
  }, [])

  if (phase === 'checking') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950">
        <span className="h-6 w-6 animate-spin rounded-full border-2 border-indigo-300/40 border-t-indigo-400" />
      </div>
    )
  }

  if (phase === 'unauthenticated') {
    return <AuthScreen />
  }

  return <>{children}</>
}

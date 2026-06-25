import { createClient } from '@supabase/supabase-js'

/**
 * Single Supabase client for the whole app. Same project as the landing page
 * (ref oqweuhwaiknnqupzkmxt). The anon/publishable key is safe to ship — RLS
 * and the backend JWT check are what actually protect data.
 *
 *  - persistSession    → survives reloads (token kept in localStorage)
 *  - autoRefreshToken  → the SDK silently refreshes before expiry
 */
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

if (!supabaseUrl || !supabaseAnonKey) {
  // Fail loudly in dev rather than booting into a half-broken auth state.
  throw new Error(
    'Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY — see frontend/.env.example',
  )
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { persistSession: true, autoRefreshToken: true },
})

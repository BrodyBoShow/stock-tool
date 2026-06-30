/** Named screener views, persisted in localStorage. A view stores the URL query
 *  string (filters + sort), so applying one is just restoring those params. */
const KEY = 'stockbud.savedViews'

export interface SavedView {
  name: string
  query: string
}

export function getSavedViews(): SavedView[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown
    if (!Array.isArray(raw)) return []
    return raw.filter(
      (v): v is SavedView =>
        typeof v === 'object' && v !== null &&
        typeof (v as SavedView).name === 'string' &&
        typeof (v as SavedView).query === 'string',
    )
  } catch {
    return []
  }
}

export function saveView(name: string, query: string): SavedView[] {
  const next = [...getSavedViews().filter((v) => v.name !== name), { name, query }]
  localStorage.setItem(KEY, JSON.stringify(next))
  return next
}

export function deleteView(name: string): SavedView[] {
  const next = getSavedViews().filter((v) => v.name !== name)
  localStorage.setItem(KEY, JSON.stringify(next))
  return next
}

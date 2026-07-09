import { ApiError } from '@/lib/api'

export function ErrorCard({
  error,
  onRetry,
}: {
  error: unknown
  onRetry?: () => void
}) {
  let title = 'Something went wrong'
  let detail = 'An unexpected error occurred while loading data.'
  if (error instanceof ApiError) {
    if (error.status === 0) {
      title = 'API unreachable'
      detail =
        'Could not reach the data API. Start it from the repo root with ' +
        '"uvicorn api.main:app --reload" and retry.'
    } else if (error.status === 404) {
      title = 'Not found'
      detail = error.message
    } else {
      title = `API error (${error.status})`
      detail = error.message
    }
  } else if (error instanceof Error) {
    detail = error.message
  }

  return (
    <div className="rounded-card border border-neg-border bg-neg-soft p-5 shadow-card">
      <div className="text-sm font-bold text-neg">{title}</div>
      <p className="mt-1 text-sm text-neg">{detail}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 rounded-lg border border-neg-border bg-surface px-3 py-1.5 text-xs font-bold text-neg hover:bg-neg-soft"
        >
          Retry
        </button>
      )}
    </div>
  )
}

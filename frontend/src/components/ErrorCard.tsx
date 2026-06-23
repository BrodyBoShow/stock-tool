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
    <div className="rounded-card border border-red-200 bg-red-50 p-5 shadow-card">
      <div className="text-sm font-bold text-red-700">{title}</div>
      <p className="mt-1 text-sm text-red-900">{detail}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-bold text-red-700 hover:bg-[#fff1f1]"
        >
          Retry
        </button>
      )}
    </div>
  )
}

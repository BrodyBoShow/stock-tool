import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Unhandled render error:', error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="mx-auto mt-10 max-w-xl rounded-card border border-[#fecaca] bg-[#fef2f2] p-6 shadow-card">
          <div className="text-sm font-bold text-[#b91c1c]">
            Something broke while rendering this page
          </div>
          <p className="mt-1 text-sm text-[#7f1d1d]">{this.state.error.message}</p>
          <button
            type="button"
            onClick={() => this.setState({ error: null })}
            className="mt-3 rounded-lg border border-[#fca5a5] bg-white px-3 py-1.5 text-xs font-bold text-[#b91c1c] hover:bg-[#fff1f1]"
          >
            Try again
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

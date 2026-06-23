import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from 'react'

type ToastKind = 'success' | 'error'

interface Toast {
  id: number
  kind: ToastKind
  message: string
}

interface ToastApi {
  push: (kind: ToastKind, message: string) => void
}

const ToastContext = createContext<ToastApi | null>(null)

let nextId = 0

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const push = useCallback((kind: ToastKind, message: string) => {
    const id = ++nextId
    setToasts((t) => [...t, { id, kind, message }])
    setTimeout(() => {
      setToasts((t) => t.filter((x) => x.id !== id))
    }, 3500)
  }, [])

  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      <div className="pointer-events-none fixed bottom-5 right-5 z-[60] flex flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={
              'pointer-events-auto rounded-xl border px-4 py-2.5 text-[0.84rem] font-semibold shadow-[0_8px_30px_rgba(15,23,42,0.12)] ' +
              (t.kind === 'success'
                ? 'border-emerald-200 bg-white text-emerald-700'
                : 'border-red-200 bg-white text-red-700')
            }
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastApi['push'] {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx.push
}

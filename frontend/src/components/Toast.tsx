import { CheckCircle2, XCircle } from 'lucide-react';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

type Kind = 'success' | 'error';
interface ToastItem { id: number; kind: Kind; text: string }
const Ctx = createContext<(text: string, kind?: Kind) => void>(() => undefined);
let seq = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((text: string, kind: Kind = 'success') => {
    const id = ++seq;
    setItems((s) => [...s.slice(-2), { id, kind, text }]);
    setTimeout(() => setItems((s) => s.filter((i) => i.id !== id)), 4500);
  }, []);
  const value = useMemo(() => push, [push]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4" role="status" aria-live="polite">
        {items.map((i) => (
          <div key={i.id} className={`toast-in pointer-events-auto flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-bold shadow-xl ${i.kind === 'success' ? 'bg-navy text-white' : 'bg-white text-danger-text ring-1 ring-danger'}`}>
            {i.kind === 'success' ? <CheckCircle2 size={18} aria-hidden /> : <XCircle size={18} aria-hidden />}
            {i.text}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
export const useToast = () => useContext(Ctx);

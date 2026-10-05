import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import { Toaster } from "sonner";
import { can, useAuth, type Role } from "@/lib/auth";

export function Shell({ title, need, wide, children }: { title: string; need?: Role[]; wide?: boolean; children: ReactNode }) {
  const { session, roles, loading } = useAuth();
  const nav = useNavigate();
  useEffect(() => {
    if (!loading && !session) nav({ to: "/" });
  }, [loading, session, nav]);
  const allowed = !need || can(roles, ...need);
  return (
    <main className={`mx-auto px-4 pb-16 pt-4 ${wide ? "max-w-[1400px]" : "max-w-xl"}`}>
      <header className="mb-4 flex items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-bold tracking-tight">{title}</h1>
        <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">← Меню</Link>
      </header>
      {loading || !session ? <p className="text-muted-foreground">Загрузка…</p> : allowed ? children : <p>Нет доступа к этому разделу.</p>}
      <Toaster position="top-center" richColors />
    </main>
  );
}

export function Pill({ on, children, onClick, className = "" }: { on?: boolean; children: ReactNode; onClick?: () => void; className?: string }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on}
      className={`min-h-14 rounded-xl border px-3 py-3 font-medium transition ${on ? "border-primary bg-primary text-primary-foreground shadow-md" : "border-border bg-card hover:border-primary/50"} ${className}`}>
      {children}
    </button>
  );
}

export const inputCls = "w-full rounded-xl border border-input bg-card px-4 py-3 text-base outline-none focus:ring-2 focus:ring-ring";
export const goCls = "mt-6 block w-full min-h-14 rounded-xl bg-primary text-lg font-bold text-primary-foreground shadow-lg transition disabled:opacity-35";

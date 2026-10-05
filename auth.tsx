import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export type Role = "admin" | "foreman" | "worker";
type Ctx = { session: Session | null; roles: Role[]; loading: boolean; name: string };
const AuthCtx = createContext<Ctx>({ session: null, roles: [], loading: true, name: "" });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (!data.session) setLoading(false);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) { setRoles([]); return; }
    setLoading(true);
    const uid = session.user.id;
    Promise.all([
      supabase.from("user_roles").select("role").eq("user_id", uid),
      supabase.from("profiles").select("full_name,email").eq("id", uid).maybeSingle(),
    ]).then(([r, p]) => {
      setRoles((r.data ?? []).map((x) => x.role as Role));
      setName(p.data?.full_name || p.data?.email || "");
      setLoading(false);
    });
  }, [session?.user.id]);

  return <AuthCtx.Provider value={{ session, roles, loading, name }}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);
export const can = (roles: Role[], ...need: Role[]) => roles.includes("admin") || need.some((n) => roles.includes(n));

export const ROLE_LABEL: Record<Role, string> = { admin: "Админ", foreman: "Бригадир", worker: "Сотрудник" };

import { supabase } from "@/integrations/supabase/client";

export type WashType = { id: number; name: string; minutes: number | null; sort: number | null };
export type Chemical = { id: number; name: string; kind: string; bottle_l: number | null; per_unit: number | null; sort: number | null };
export type Recipe = { wash_type_id: number; chemical_id: number; ml_per_l: number };

export async function loadRefs() {
  const [w, c, r, s] = await Promise.all([
    supabase.from("wash_types").select("*").order("sort"),
    supabase.from("chemicals").select("*").order("sort"),
    supabase.from("recipes").select("*"),
    supabase.from("settings").select("*"),
  ]);
  const settings: Record<string, number> = {};
  (s.data ?? []).forEach((x) => (settings[x.key] = Number(x.value)));
  return {
    washTypes: (w.data ?? []) as WashType[],
    chemicals: (c.data ?? []) as Chemical[],
    recipes: (r.data ?? []) as Recipe[],
    settings,
  };
}

export const today = () => {
  // смена начинается в 06:00 по местному времени (UTC+5)
  const d = new Date(Date.now() + 5 * 3600e3 - 6 * 3600e3);
  return d.toISOString().slice(0, 10);
};
export const fmt = (n: number, d = 1) => (Math.round(n * 10 ** d) / 10 ** d).toLocaleString("ru-RU");

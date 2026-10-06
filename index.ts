// Edge Function «create-user»: суперадмин создаёт пользователя и выдаёт доступ к бланкам.
// Вызов с сайта: sb.functions.invoke('create-user', { body: { email, password, access: [{ form_id, role }] } })
// role в access: 'worker' | 'foreman' | 'admin'. Секреты SUPABASE_URL, SUPABASE_ANON_KEY и SUPABASE_SERVICE_ROLE_KEY Supabase подставляет сам.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return reply({ error: 'Нужен POST' }, 405);

  const url = Deno.env.get('SUPABASE_URL')!;
  const auth = req.headers.get('Authorization') ?? '';
  if (!auth) return reply({ error: 'Нет входа в систему' }, 401);

  // кто вызывает
  const asCaller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } });
  const { data: me, error: meErr } = await asCaller.auth.getUser();
  if (meErr || !me?.user) return reply({ error: 'Сессия недействительна, войдите заново' }, 401);

  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: prof } = await admin.from('profiles').select('role').eq('id', me.user.id).maybeSingle();
  if (prof?.role !== 'superadmin') return reply({ error: 'Создавать пользователей может только суперадмин' }, 403);

  let b: any;
  try { b = await req.json(); } catch { return reply({ error: 'Некорректный запрос' }, 400); }
  const email = String(b?.email ?? '').trim().toLowerCase();
  const password = String(b?.password ?? '');
  if (!/^\S+@\S+\.\S+$/.test(email)) return reply({ error: 'Укажите почту' }, 400);
  if (password.length < 6) return reply({ error: 'Пароль должен быть не короче 6 символов' }, 400);

  const { data: created, error: cErr } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (cErr || !created?.user) {
    const m = cErr?.message ?? 'не удалось создать';
    return reply({ error: /already|registered|exists/i.test(m) ? 'Такая почта уже есть' : m }, 400);
  }
  const id = created.user.id;

  // профиль: если его создаёт триггер базы, строка уже есть и ничего не меняется
  const { error: pErr } = await admin.from('profiles').upsert({ id }, { onConflict: 'id', ignoreDuplicates: true });
  if (pErr) console.log('profiles:', pErr.message);

  // доступ к бланкам
  const access = Array.isArray(b?.access) ? b.access : [];
  const rows = access
    .filter((a: any) => a?.form_id != null && ['worker', 'foreman', 'admin'].includes(a?.role))
    .map((a: any) => ({ user_id: id, form_id: a.form_id, role: a.role }));
  if (rows.length) {
    const { error: aErr } = await admin.from('form_access').insert(rows);
    if (aErr) return reply({ ok: true, id, warning: 'Пользователь создан, но доступ не выдан: ' + aErr.message });
  }
  return reply({ ok: true, id });
});

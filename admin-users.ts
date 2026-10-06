// Supabase -> Edge Functions -> Create function, имя: admin-users. Вставить этот код и нажать Deploy.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Должно совпадать с LOGIN_DOMAIN в config.js
const LOGIN_DOMAIN = 'euss.local';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const out = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  const token = (req.headers.get('Authorization') || '').replace('Bearer ', '');
  const { data: { user } } = await admin.auth.getUser(token);
  if (!user) return out({ error: 'Нужно войти' }, 401);
  const { data: p } = await admin.from('profiles').select('role').eq('id', user.id).maybeSingle();
  if (p?.role !== 'superadmin') return out({ error: 'Только суперадмин' }, 403);

  const b = await req.json();
  if (b.action === 'create') {
    const login = String(b.login || '').trim().toLowerCase();
    if (login.length < 4 || login.length > 32 || !/^[a-z0-9._-]+$/.test(login)) return out({ error: 'Логин: от 4 до 32 символов, латинские буквы, цифры и . _ -' }, 400);
    if ((b.password || '').length < 6) return out({ error: 'Пароль: не меньше 6 символов' }, 400);
    const email = login + '@' + LOGIN_DOMAIN;
    const { data, error } = await admin.auth.admin.createUser({ email, password: b.password, email_confirm: true });
    if (error) return out({ error: /already|registered|exists/i.test(error.message) ? 'Такой логин уже занят' : error.message }, 400);
    const id = data.user.id;
    const r1 = await admin.from('people').insert({ id, email, full_name: b.full_name || null });
    const r2 = b.access?.length ? await admin.from('form_access').insert(b.access.map((a: any) => ({ user_id: id, form_id: a.form_id, role: a.role }))) : { error: null };
    if (r1.error || r2.error) { await admin.auth.admin.deleteUser(id); return out({ error: (r1.error || r2.error)!.message }, 400); }
    return out({ id });
  }
  if (b.action === 'password') {
    if ((b.password || '').length < 6) return out({ error: 'Пароль: не меньше 6 символов' }, 400);
    const { error } = await admin.auth.admin.updateUserById(b.id, { password: b.password });
    return error ? out({ error: error.message }, 400) : out({ ok: true });
  }
  if (b.action === 'remove') {
    if (b.id === user.id) return out({ error: 'Суперадмина удалить нельзя' }, 400);
    const { error } = await admin.auth.admin.deleteUser(b.id);
    return error ? out({ error: error.message }, 400) : out({ ok: true });
  }
  return out({ error: 'Неизвестное действие' }, 400);
});

// Supabase -> Edge Functions -> Create function, имя: badge-login. Вставить этот код и нажать Deploy.
// Вход по QR: принимает код с бейджа и возвращает одноразовый токен, по которому сайт получает сессию (sb.auth.verifyOtp).
// Админам и суперадмину вход по QR запрещён.
import { createClient } from 'npm:@supabase/supabase-js@2';   // npm: надёжнее, чем esm.sh (тот иногда не грузится и функция не стартует)

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const out = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  const b = await req.json().catch(() => ({}));
  const code = String(b.code || '');
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(code)) return out({ error: 'Это не бейдж EuSS' }, 400);

  const { data: bd } = await admin.from('badges').select('user_id').eq('code', code).maybeSingle();
  if (!bd) return out({ error: 'QR-код не найден или отозван. Обратитесь к суперадмину' }, 401);

  const { data: p } = await admin.from('profiles').select('role').eq('id', bd.user_id).maybeSingle();
  const { data: fa } = await admin.from('form_access').select('role').eq('user_id', bd.user_id).eq('role', 'admin').limit(1);
  if (p?.role === 'superadmin' || (fa && fa.length)) return out({ error: 'Админам вход по QR недоступен. Войдите по логину и паролю' }, 403);

  const { data: tu } = await admin.auth.admin.getUserById(bd.user_id);
  const email = tu?.user?.email;
  if (!email) return out({ error: 'Аккаунт не найден' }, 404);

  // письмо не отправляется, нужен только токен
  const { data: lk, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  if (error || !lk?.properties?.hashed_token) return out({ error: 'Не удалось войти, попробуйте ещё раз' }, 500);

  await admin.from('badges').update({ last_used_at: new Date().toISOString() }).eq('user_id', bd.user_id);
  return out({ token_hash: lk.properties.hashed_token });
  } catch (e) {   // любая неожиданная ошибка уходит ответом с CORS, а не обрывом связи
    return out({ error: 'Ошибка функции: ' + (e instanceof Error ? e.message : String(e)) }, 500);
  }
});

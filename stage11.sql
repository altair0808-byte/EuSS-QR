-- Этап 11: списание остатка (тихое), правки админа и суперадмина с паролем, список всех аккаунтов.
-- Выполнить в Supabase -> SQL Editor ПОСЛЕ stage10.sql (или после stage9.sql, если stage10 не запускали). Можно запускать повторно.
-- ЧЕРНОВИК: на живой базе не запускался. Сначала прогоните на копии базы.
-- Порядок выкладки: сначала этот файл, потом новые html/js на сайт.
-- ВАЖНО: после этого файла прямое изменение и удаление записей суперадмином закрыто, правки идут только через функции с паролем.

create extension if not exists pgcrypto with schema extensions;

-- 1) новые колонки: списание остатка и пометка «исправлено» для замен химии
alter table chem_changes add column if not exists written_off_at timestamptz;
alter table chem_changes add column if not exists written_off_by uuid;
alter table chem_changes add column if not exists edited_at timestamptz;
alter table chem_changes add column if not exists edited_by uuid;

-- 2) тихое хранилище списаний: видит только суперадмин, в приложении нигде не показывается
create table if not exists chem_writeoffs (
  id uuid primary key default gen_random_uuid(),
  ts timestamptz not null default now(),
  chemical_id bigint not null,
  amount_l numeric,
  amount_kg numeric,
  change_ids uuid[] not null,
  created_by uuid
);
alter table chem_writeoffs enable row level security;
drop policy if exists wo_sel on chem_writeoffs;
create policy wo_sel on chem_writeoffs for select to authenticated using (is_super());

-- 3) журнал изменений не пишет списание остатка (меняется только пометка written_off_*)
create or replace function audit_row() returns trigger language plpgsql security definer set search_path = public as $$
declare ent text := tg_argv[0]; o jsonb; n jsonb; rid text;
        skip text[] := array['finished_at','edited_at','edited_by','connect_id','written_off_at','written_off_by'];
begin
  if tg_op = 'INSERT' then n := to_jsonb(new); rid := n->>'id';
  elsif tg_op = 'UPDATE' then
    o := to_jsonb(old); n := to_jsonb(new); rid := n->>'id';
    if (o - skip) is not distinct from (n - skip) then return new; end if;   -- «Постиралось», подключение и списание остатка не считаем правкой
  else o := to_jsonb(old); rid := o->>'id'; end if;
  insert into audit_log(actor, action, entity, entity_id, old_data, new_data)
  values (auth.uid(), lower(tg_op), ent, rid, o, n);
  return coalesce(new, old);
end $$;

-- 4) списанный остаток не попадает в запас и в подключение
create or replace function leftover_pool()
returns table(id text, ts timestamptz, shift_date date, chemical_id bigint, machine_group text,
              leftover_kg numeric, leftover_l numeric, created_by uuid)
language sql stable security definer set search_path = public as $$
  select c.id::text, c.ts, c.shift_date::date, c.chemical_id::bigint, c.machine_group::text,
         c.leftover_kg::numeric, c.leftover_l::numeric, c.created_by
  from chem_changes c
  where (can_fill_chem() or can_report())
    and c.connect_id is null
    and c.written_off_at is null
    and (coalesce(c.leftover_kg,0) > 0 or coalesce(c.leftover_l,0) > 0)
  order by c.ts $$;
revoke all on function leftover_pool() from public;
grant execute on function leftover_pool() to authenticated;

create or replace function connect_leftovers(p_chemical bigint, p_group text) returns uuid
language plpgsql security definer set search_path = public as $$
declare ch chemicals%rowtype; tz int := (select value from settings where key='tz_offset');
        st int := (select value from settings where key='shift_start');
        n int; al numeric; akg numeric; cid uuid;
begin
  if not can_fill_chem() then raise exception 'Нет прав подключать остаток'; end if;
  if p_group not in ('1_10','11_12') then raise exception 'Выберите дозатор'; end if;
  perform pg_advisory_xact_lock(hashtext('connect_leftovers:' || p_chemical::text));
  select * into ch from chemicals where id = p_chemical;
  if not found then raise exception 'Химия не найдена'; end if;
  select count(*),
         sum(case when coalesce(leftover_l,0) > 0 then leftover_l
                  when coalesce(leftover_kg,0) > 0 and ch.bottle_kg > 0 and ch.bottle_l > 0 then leftover_kg * ch.bottle_l / ch.bottle_kg end),
         sum(case when coalesce(leftover_kg,0) > 0 then leftover_kg
                  when coalesce(leftover_l,0) > 0 and ch.bottle_kg > 0 and ch.bottle_l > 0 then leftover_l * ch.bottle_kg / ch.bottle_l end)
    into n, al, akg
  from chem_changes
  where chemical_id = p_chemical and connect_id is null and written_off_at is null
    and (coalesce(leftover_kg,0) > 0 or coalesce(leftover_l,0) > 0);
  if n = 0 then raise exception 'Остатка нет'; end if;
  insert into chem_connects(shift_date, chemical_id, machine_group, amount_l, amount_kg, n)
  values (((now() at time zone 'UTC') + make_interval(hours => tz) - make_interval(hours => st))::date, p_chemical, p_group, al, akg, n)
  returning id into cid;
  update chem_changes set connect_id = cid
  where chemical_id = p_chemical and connect_id is null and written_off_at is null
    and (coalesce(leftover_kg,0) > 0 or coalesce(leftover_l,0) > 0);
  return cid;
end $$;
revoke all on function connect_leftovers(bigint, text) from public;
grant execute on function connect_leftovers(bigint, text) to authenticated;

-- запас для вкладки «Химия» (есть только если выполнен stage10.sql)
do $do$ begin
  if to_regclass('public.chem_moves') is not null then
    execute $fn$
      create or replace function chem_stock_l(p_chemical bigint) returns numeric language sql stable security definer set search_path = public as $q$
        select coalesce((select sum(case when coalesce(leftover_l,0) > 0 then leftover_l end) from chem_changes
                         where chemical_id = p_chemical and connect_id is null and written_off_at is null),0)
             + coalesce((select sum(case kind when 'take' then amount_l else -amount_l end) from chem_moves where chemical_id = p_chemical),0) $q$
    $fn$;
  end if;
end $do$;

-- 5) проверка пароля текущего пользователя. Неверный пароль НЕ бросает исключение (иначе откатится и счётчик попыток),
--    а возвращает текст ошибки. После 5 неверных попыток за 10 минут проверка блокируется.
create table if not exists pw_attempts (user_id uuid not null, ts timestamptz not null default now());
create index if not exists pw_attempts_idx on pw_attempts (user_id, ts);
alter table pw_attempts enable row level security;        -- без политик: напрямую недоступна

create or replace function check_my_password(p_pw text) returns text
language plpgsql security definer set search_path = public, extensions, auth as $$
declare h text; fails int;
begin
  if auth.uid() is null then return 'Нужно войти'; end if;
  select count(*) into fails from pw_attempts where user_id = auth.uid() and ts > now() - interval '10 minutes';
  if fails >= 5 then return 'Слишком много неверных паролей. Подождите 10 минут'; end if;
  select encrypted_password into h from auth.users where id = auth.uid();
  if h is null or coalesce(p_pw,'') = '' or h <> crypt(p_pw, h) then
    insert into pw_attempts(user_id) values (auth.uid());
    return 'Неверный пароль';
  end if;
  delete from pw_attempts where user_id = auth.uid();
  return null;
end $$;
revoke all on function check_my_password(text) from public, anon, authenticated;   -- вызывается только из функций ниже

-- 6) правки админа и суперадмина. Админ = роль «admin» на бланке, к которому относится запись; суперадмин может всё.
--    Пароль нужен при каждой правке. Журнал изменений пишется как обычно (кто, когда, что было и что стало).
create or replace function edit_load(p_id uuid, p_pw text, p_machine int, p_wash int, p_weight numeric, p_extras jsonb, p_ts timestamptz)
returns jsonb language plpgsql security definer set search_path = public as $$
declare l loads%rowtype; msg text;
begin
  select * into l from loads where id = p_id;
  if not found then raise exception 'Запись не найдена'; end if;
  if form_role(l.form_id) is distinct from 'admin' then raise exception 'Нет прав исправлять эту запись'; end if;
  if p_machine is null or p_machine not between 1 and 12 then raise exception 'Машина указана неверно'; end if;
  if p_weight is null or not (p_weight > 0 and p_weight <= 500) then raise exception 'Вес указан неверно'; end if;
  if not exists (select 1 from wash_types where id = p_wash) then raise exception 'Вид стирки не найден'; end if;
  msg := check_my_password(p_pw);
  if msg is not null then return jsonb_build_object('ok', false, 'error', msg); end if;
  update loads set machine = p_machine, wash_type_id = p_wash, weight_kg = p_weight,
                   extras = coalesce(p_extras, '{}'::jsonb), ts = coalesce(p_ts, ts)
  where id = p_id;                                         -- смена и день/ночь пересчитываются триггером, «исправлено» ставится им же
  return jsonb_build_object('ok', true);
end $$;

create or replace function delete_load(p_id uuid, p_pw text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare l loads%rowtype; msg text;
begin
  select * into l from loads where id = p_id;
  if not found then raise exception 'Запись не найдена'; end if;
  if form_role(l.form_id) is distinct from 'admin' then raise exception 'Нет прав удалять эту запись'; end if;
  msg := check_my_password(p_pw);
  if msg is not null then return jsonb_build_object('ok', false, 'error', msg); end if;
  delete from loads where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

create or replace function edit_chem(p_id uuid, p_pw text, p_group text, p_leftover_l numeric, p_leftover_kg numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c chem_changes%rowtype; msg text;
begin
  select * into c from chem_changes where id = p_id;
  if not found then raise exception 'Запись не найдена'; end if;
  if form_role(c.form_id) is distinct from 'admin' then raise exception 'Нет прав исправлять эту запись'; end if;
  if p_group not in ('1_10','11_12') then raise exception 'Выберите дозатор'; end if;
  if coalesce(p_leftover_l,0) < 0 or coalesce(p_leftover_kg,0) < 0 then raise exception 'Остаток указан неверно'; end if;
  msg := check_my_password(p_pw);
  if msg is not null then return jsonb_build_object('ok', false, 'error', msg); end if;
  update chem_changes set machine_group = p_group, leftover_l = p_leftover_l, leftover_kg = p_leftover_kg,
                          edited_at = now(), edited_by = auth.uid()
  where id = p_id;                                         -- подключение остатка пересчитывает триггер из stage9.sql
  return jsonb_build_object('ok', true);
end $$;

create or replace function delete_chem(p_id uuid, p_pw text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c chem_changes%rowtype; msg text;
begin
  select * into c from chem_changes where id = p_id;
  if not found then raise exception 'Запись не найдена'; end if;
  if form_role(c.form_id) is distinct from 'admin' then raise exception 'Нет прав удалять эту запись'; end if;
  msg := check_my_password(p_pw);
  if msg is not null then return jsonb_build_object('ok', false, 'error', msg); end if;
  delete from chem_changes where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

-- 7) списание остатка (только суперадмин, с паролем). В журнале изменений и в отчётах не отображается.
--    Расход за период не меняется: замена бутыли уже посчитана по остатку, списывается только то, что лежало в запасе.
create or replace function writeoff_leftovers(p_chemical bigint, p_ids uuid[], p_pw text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare ch chemicals%rowtype; msg text; ids uuid[]; n int; al numeric; akg numeric;
begin
  if not is_super() then raise exception 'Только суперадмин'; end if;
  perform pg_advisory_xact_lock(hashtext('connect_leftovers:' || p_chemical::text));   -- тот же замок, что у «Подключили остаток»
  select * into ch from chemicals where id = p_chemical;
  if not found then raise exception 'Химия не найдена'; end if;
  select array_agg(id), count(*),
         sum(case when coalesce(leftover_l,0) > 0 then leftover_l
                  when coalesce(leftover_kg,0) > 0 and ch.bottle_kg > 0 and ch.bottle_l > 0 then leftover_kg * ch.bottle_l / ch.bottle_kg end),
         sum(case when coalesce(leftover_kg,0) > 0 then leftover_kg
                  when coalesce(leftover_l,0) > 0 and ch.bottle_kg > 0 and ch.bottle_l > 0 then leftover_l * ch.bottle_kg / ch.bottle_l end)
    into ids, n, al, akg
  from chem_changes
  where chemical_id = p_chemical and connect_id is null and written_off_at is null
    and (coalesce(leftover_kg,0) > 0 or coalesce(leftover_l,0) > 0)
    and (p_ids is null or id = any(p_ids));
  if coalesce(n,0) = 0 then raise exception 'Остатка нет'; end if;
  msg := check_my_password(p_pw);
  if msg is not null then return jsonb_build_object('ok', false, 'error', msg); end if;
  update chem_changes set written_off_at = now(), written_off_by = auth.uid() where id = any(ids);
  insert into chem_writeoffs(chemical_id, amount_l, amount_kg, change_ids, created_by) values (p_chemical, al, akg, ids, auth.uid());
  return jsonb_build_object('ok', true, 'n', n);
end $$;

-- 8) все аккаунты для страницы «Пользователи» (только суперадмин). Заодно добавляет в people тех, кто создан вручную в Supabase.
create or replace function list_accounts()
returns table(acc_id uuid, acc_email text, acc_name text, acc_created timestamptz, acc_last timestamptz, acc_super boolean)
language plpgsql security definer set search_path = public as $$
begin
  if not is_super() then raise exception 'Только суперадмин'; end if;
  insert into people(id, email)
  select u.id, u.email::text from auth.users u
  where u.email is not null and not exists (select 1 from people p where p.id = u.id);
  return query
  select u.id, u.email::text, p.full_name::text, u.created_at, u.last_sign_in_at, coalesce(pr.role = 'superadmin', false)
  from auth.users u
  left join people p on p.id = u.id
  left join profiles pr on pr.id = u.id
  order by u.created_at;
end $$;

-- 9) отчёт по заменам отдаёт пометки «списано» и «исправлено» (набор колонок меняется, поэтому drop)
drop function if exists report_changes(date, date);
create function report_changes(d1 date, d2 date)
returns table(id text, ts timestamptz, shift_date date, machine_group text, chemical_id bigint,
              leftover_kg numeric, leftover_l numeric, created_by uuid, connect_id uuid,
              written_off_at timestamptz, edited_at timestamptz)
language sql stable security definer set search_path = public as
$$ select c.id::text, c.ts, c.shift_date::date, c.machine_group::text, c.chemical_id::bigint,
          c.leftover_kg::numeric, c.leftover_l::numeric, c.created_by, c.connect_id,
          c.written_off_at, c.edited_at
   from chem_changes c
   where can_report() and c.shift_date between d1 and d2
   order by c.ts $$;
revoke all on function report_changes(date, date) from public;
grant execute on function report_changes(date, date) to authenticated;

-- 10) права на новые функции
revoke all on function edit_load(uuid, text, int, int, numeric, jsonb, timestamptz) from public;
revoke all on function delete_load(uuid, text) from public;
revoke all on function edit_chem(uuid, text, text, numeric, numeric) from public;
revoke all on function delete_chem(uuid, text) from public;
revoke all on function writeoff_leftovers(bigint, uuid[], text) from public;
revoke all on function list_accounts() from public;
grant execute on function edit_load(uuid, text, int, int, numeric, jsonb, timestamptz) to authenticated;
grant execute on function delete_load(uuid, text) to authenticated;
grant execute on function edit_chem(uuid, text, text, numeric, numeric) to authenticated;
grant execute on function delete_chem(uuid, text) to authenticated;
grant execute on function writeoff_leftovers(bigint, uuid[], text) to authenticated;
grant execute on function list_accounts() to authenticated;

-- 11) прямые правки и удаление записей суперадмином закрыты: теперь только через функции выше (с паролем).
--     Отмена своей записи за 10 минут (политики l_del и c_del) остаётся как была.
drop policy if exists l_upd_super on loads;
drop policy if exists l_del_super on loads;
drop policy if exists cc_upd_super on chem_changes;
drop policy if exists cc_del_super on chem_changes;

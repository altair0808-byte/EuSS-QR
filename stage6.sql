-- Этап 6: журнал изменений, кто внёс запись, остатки химии и «Подключили остаток».
-- Выполнить в Supabase -> SQL Editor ПОСЛЕ stage5.sql. Можно запускать повторно.
-- Сначала выполните этот файл, потом выложите новые html/js на сайт.

-- 1) кто внёс запись (проставляется базой, подделать с телефона нельзя)
alter table loads        add column if not exists created_by uuid;
alter table chem_changes add column if not exists created_by uuid;
alter table chem_changes add column if not exists connect_id uuid;   -- к какому «подключению остатка» относится
-- дозатор замены (раньше добавлялся в stage3.sql; если его не запускали, колонки не было)
alter table chem_changes add column if not exists machine_group text default '1_10';
update chem_changes set machine_group = '1_10' where machine_group is null;

create or replace function set_created_by() returns trigger language plpgsql as $$
begin
  if auth.uid() is not null then new.created_by := auth.uid(); end if;
  return new;
end $$;
drop trigger if exists t_loads_by on loads;
create trigger t_loads_by before insert on loads for each row execute function set_created_by();
drop trigger if exists t_chem_by on chem_changes;
create trigger t_chem_by before insert on chem_changes for each row execute function set_created_by();

-- если раньше автор хранился в колонке user_id, подтянем его для старых записей
do $$ begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='loads' and column_name='user_id') then
    execute 'update loads set created_by = user_id where created_by is null';
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='chem_changes' and column_name='user_id') then
    execute 'update chem_changes set created_by = user_id where created_by is null';
  end if;
end $$;

-- 2) подключения остатка: сколько и в какой дозатор подключили
create table if not exists chem_connects (
  id uuid primary key default gen_random_uuid(),
  ts timestamptz not null default now(),
  shift_date date,
  chemical_id bigint not null,
  machine_group text not null check (machine_group in ('1_10','11_12')),
  amount_l numeric,
  amount_kg numeric,
  n int not null default 0,
  created_by uuid default auth.uid()
);
alter table chem_connects enable row level security;      -- напрямую не читается и не пишется, только через функции ниже

-- 3) исправлять и удалять замены химии может только суперадмин
drop policy if exists cc_sel_super on chem_changes;
create policy cc_sel_super on chem_changes for select to authenticated using (is_super());
drop policy if exists cc_upd_super on chem_changes;
create policy cc_upd_super on chem_changes for update to authenticated using (is_super()) with check (is_super());
drop policy if exists cc_del_super on chem_changes;
create policy cc_del_super on chem_changes for delete to authenticated using (is_super());

-- 4) журнал изменений: только дописывается, из приложения его не стереть
create table if not exists audit_log (
  id bigserial primary key,
  ts timestamptz not null default now(),
  actor uuid,
  action text not null,            -- insert | update | delete
  entity text not null,            -- load | chem | connect
  entity_id text,
  old_data jsonb,
  new_data jsonb
);
create index if not exists audit_log_ts on audit_log (ts desc);
alter table audit_log enable row level security;
drop policy if exists a_sel on audit_log;
create policy a_sel on audit_log for select to authenticated using (can_report());

create or replace function audit_row() returns trigger language plpgsql security definer set search_path = public as $$
declare ent text := tg_argv[0]; o jsonb; n jsonb; rid text;
        skip text[] := array['finished_at','edited_at','edited_by','connect_id'];
begin
  if tg_op = 'INSERT' then n := to_jsonb(new); rid := n->>'id';
  elsif tg_op = 'UPDATE' then
    o := to_jsonb(old); n := to_jsonb(new); rid := n->>'id';
    if (o - skip) is not distinct from (n - skip) then return new; end if;   -- «Постиралось» и подключение остатка не считаем правкой
  else o := to_jsonb(old); rid := o->>'id'; end if;
  insert into audit_log(actor, action, entity, entity_id, old_data, new_data)
  values (auth.uid(), lower(tg_op), ent, rid, o, n);
  return coalesce(new, old);
end $$;

drop trigger if exists t_loads_audit on loads;
create trigger t_loads_audit after insert or update or delete on loads for each row execute function audit_row('load');
drop trigger if exists t_chem_audit on chem_changes;
create trigger t_chem_audit after insert or update or delete on chem_changes for each row execute function audit_row('chem');
drop trigger if exists t_conn_audit on chem_connects;
create trigger t_conn_audit after insert on chem_connects for each row execute function audit_row('connect');

-- 5) имена сотрудников (по почте). Отчётам видны все, остальным только они сами
create or replace function staff_names() returns table(id uuid, name text)
language sql stable security definer set search_path = public as $$
  select u.id, coalesce(nullif(u.raw_user_meta_data->>'full_name',''), nullif(u.raw_user_meta_data->>'name',''), split_part(u.email,'@',1))::text
  from auth.users u where can_report() or is_super() or u.id = auth.uid() $$;
revoke all on function staff_names() from public;
grant execute on function staff_names() to authenticated;

-- 6) кто может видеть остатки и подключать их
create or replace function can_fill_chem() returns boolean language sql stable security definer set search_path = public as $$
  select is_super() or exists (select 1 from form_access fa join forms f on f.id = fa.form_id
                               where fa.user_id = auth.uid() and f.type = 'laundry_chem') $$;
revoke all on function can_fill_chem() from public;
grant execute on function can_fill_chem() to authenticated;

-- 7) остатки, ещё не подключённые к дозатору
create or replace function leftover_pool()
returns table(id text, ts timestamptz, shift_date date, chemical_id bigint, machine_group text,
              leftover_kg numeric, leftover_l numeric, created_by uuid)
language sql stable security definer set search_path = public as $$
  select c.id::text, c.ts, c.shift_date::date, c.chemical_id::bigint, c.machine_group::text,
         c.leftover_kg::numeric, c.leftover_l::numeric, c.created_by
  from chem_changes c
  where (can_fill_chem() or can_report())
    and c.connect_id is null
    and (coalesce(c.leftover_kg,0) > 0 or coalesce(c.leftover_l,0) > 0)
  order by c.ts $$;
revoke all on function leftover_pool() from public;
grant execute on function leftover_pool() to authenticated;

-- 8) кнопка «Подключили остаток»: весь запас этой химии уходит в выбранный дозатор
create or replace function connect_leftovers(p_chemical bigint, p_group text) returns uuid
language plpgsql security definer set search_path = public as $$
declare ch chemicals%rowtype; tz int := (select value from settings where key='tz_offset');
        st int := (select value from settings where key='shift_start');
        n int; al numeric; akg numeric; cid uuid;
begin
  if not can_fill_chem() then raise exception 'Нет прав подключать остаток'; end if;
  if p_group not in ('1_10','11_12') then raise exception 'Выберите дозатор'; end if;
  select * into ch from chemicals where id = p_chemical;
  if not found then raise exception 'Химия не найдена'; end if;
  select count(*),
         sum(case when coalesce(leftover_l,0) > 0 then leftover_l
                  when coalesce(leftover_kg,0) > 0 and ch.bottle_kg > 0 and ch.bottle_l > 0 then leftover_kg * ch.bottle_l / ch.bottle_kg end),
         sum(case when coalesce(leftover_kg,0) > 0 then leftover_kg
                  when coalesce(leftover_l,0) > 0 and ch.bottle_kg > 0 and ch.bottle_l > 0 then leftover_l * ch.bottle_kg / ch.bottle_l end)
    into n, al, akg
  from chem_changes
  where chemical_id = p_chemical and connect_id is null and (coalesce(leftover_kg,0) > 0 or coalesce(leftover_l,0) > 0);
  if n = 0 then raise exception 'Остатка нет'; end if;
  insert into chem_connects(shift_date, chemical_id, machine_group, amount_l, amount_kg, n)
  values (((now() at time zone 'UTC') + make_interval(hours => tz) - make_interval(hours => st))::date, p_chemical, p_group, al, akg, n)
  returning id into cid;
  update chem_changes set connect_id = cid
  where chemical_id = p_chemical and connect_id is null and (coalesce(leftover_kg,0) > 0 or coalesce(leftover_l,0) > 0);
  return cid;
end $$;
revoke all on function connect_leftovers(bigint, text) from public;
grant execute on function connect_leftovers(bigint, text) to authenticated;

-- 9) отчёты отдают автора, id замен и подключения (набор колонок меняется, поэтому drop)
drop function if exists report_loads(date, date);
create function report_loads(d1 date, d2 date)
returns table(id uuid, ts timestamptz, shift_date date, part text, machine int,
              wash_type_id int, weight_kg numeric, extras jsonb, finished_at timestamptz, edited_at timestamptz, created_by uuid)
language sql stable security definer set search_path = public as
$$ select l.id, l.ts, l.shift_date, l.part, l.machine, l.wash_type_id, l.weight_kg, l.extras, l.finished_at, l.edited_at, l.created_by
   from loads l
   where can_report() and l.shift_date between d1 and d2
   order by l.ts $$;
revoke all on function report_loads(date, date) from public;
grant execute on function report_loads(date, date) to authenticated;

drop function if exists report_changes(date, date);
create function report_changes(d1 date, d2 date)
returns table(id text, ts timestamptz, shift_date date, machine_group text, chemical_id bigint,
              leftover_kg numeric, leftover_l numeric, created_by uuid, connect_id uuid)
language sql stable security definer set search_path = public as
$$ select c.id::text, c.ts, c.shift_date::date, c.machine_group::text, c.chemical_id::bigint,
          c.leftover_kg::numeric, c.leftover_l::numeric, c.created_by, c.connect_id
   from chem_changes c
   where can_report() and c.shift_date between d1 and d2
   order by c.ts $$;
revoke all on function report_changes(date, date) from public;
grant execute on function report_changes(date, date) to authenticated;

drop function if exists report_connects(date, date);
create function report_connects(d1 date, d2 date)
returns table(id text, ts timestamptz, shift_date date, chemical_id bigint, machine_group text,
              amount_l numeric, amount_kg numeric, n int, created_by uuid)
language sql stable security definer set search_path = public as
$$ select k.id::text, k.ts, k.shift_date, k.chemical_id, k.machine_group, k.amount_l, k.amount_kg, k.n, k.created_by
   from chem_connects k
   where can_report() and k.shift_date between d1 and d2
   order by k.ts $$;
revoke all on function report_connects(date, date) from public;
grant execute on function report_connects(date, date) to authenticated;

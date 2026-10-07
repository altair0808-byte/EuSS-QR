-- Этап 13: проживающие (видят и вводят только админы) и «Добавить химию» (суперадмин, любое количество).
-- Выполнить в Supabase -> SQL Editor ПОСЛЕ stage12.sql. Можно запускать повторно.
-- Порядок выкладки: сначала этот файл, потом новые html/js на сайт.
-- ЧЕРНОВИК: на живой базе не запускался, сначала прогоните на копии.

-- =====================================================================
-- 1) Кто такой «админ»: суперадмин или роль «admin» хотя бы на одном бланке
-- =====================================================================
create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as
$$ select is_super() or exists (select 1 from form_access where user_id = auth.uid() and role = 'admin') $$;
revoke all on function is_admin() from public;
grant execute on function is_admin() to authenticated;

-- =====================================================================
-- 2) Проживающие по дням смены
--    Таблица закрыта для прямого доступа (RLS включён, политик нет): читать и писать можно только
--    через функции ниже, а они пускают только админов. Бригадир и сотрудник не увидят число ни в приложении,
--    ни напрямую через API. В журнал изменений (audit_log) эти данные намеренно НЕ пишутся:
--    журнал виден бригадирам.
-- =====================================================================
create table if not exists resident_counts(
  day        date primary key,                              -- дата смены (как shift_date)
  cnt        int  not null check (cnt >= 0 and cnt <= 100000),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid());
alter table resident_counts enable row level security;
revoke all on resident_counts from anon, authenticated;

-- старая заготовка residents (supabase.sql) никогда не использовалась в приложении; если в ней что-то есть, переносим
do $$ begin
  if to_regclass('public.residents') is not null then
    insert into resident_counts(day, cnt)
    select day, max(cnt) from residents group by day
    on conflict (day) do nothing;
  end if;
end $$;

create or replace function get_residents(d1 date, d2 date)
returns table(day date, cnt int, updated_at timestamptz)
language sql stable security definer set search_path = public as
$$ select r.day, r.cnt, r.updated_at from resident_counts r
   where is_admin() and r.day between d1 and d2
   order by r.day $$;
revoke all on function get_residents(date, date) from public;
grant execute on function get_residents(date, date) to authenticated;

-- p_cnt = null удаляет число за этот день. Вводить можно за текущую смену и за прошлые, за будущие нельзя.
create or replace function set_residents(p_day date, p_cnt int) returns void
language plpgsql security definer set search_path = public as $$
declare tz int := coalesce((select value from settings where key = 'tz_offset'), 5);
        st int := coalesce((select value from settings where key = 'shift_start'), 6);
        today date;
begin
  if not is_admin() then raise exception 'Проживающих вводят только админы'; end if;
  if p_day is null then raise exception 'Не указана дата смены'; end if;
  today := ((now() at time zone 'UTC') + make_interval(hours => tz) - make_interval(hours => st))::date;
  if p_day > today then raise exception 'На будущие смены вводить нельзя'; end if;
  if p_cnt is null then
    delete from resident_counts where day = p_day;
    return;
  end if;
  if p_cnt < 0 or p_cnt > 100000 then raise exception 'Количество указано неверно'; end if;
  insert into resident_counts(day, cnt, updated_at, updated_by) values (p_day, p_cnt, now(), auth.uid())
  on conflict (day) do update set cnt = excluded.cnt, updated_at = now(), updated_by = auth.uid();
end $$;
revoke all on function set_residents(date, int) from public;
grant execute on function set_residents(date, int) to authenticated;

-- =====================================================================
-- 3) Остаток замены в литрах считается без округления до тысячных (было round(..., 3))
-- =====================================================================
create or replace function chem_kg_to_l() returns trigger language plpgsql as $$
declare b numeric; k numeric;
begin
  if new.leftover_kg is not null and new.leftover_l is null then
    select bottle_l, bottle_kg into b, k from chemicals where id = new.chemical_id;
    if b is not null and k is not null and k > 0 then
      new.leftover_l := round(new.leftover_kg * b / k, 9);
    end if;
  end if;
  return new;
end $$;

-- =====================================================================
-- 4) Суперадмин добавляет в дозатор ЛЮБОЕ количество химии (не только целую бутыль)
--    Новый вид записи в chem_moves: kind = 'add' (приход). Он поднимает уровень выбранного дозатора на указанное
--    количество и учитывается в расходе как «залито»; запас бригадира он не трогает (в отличие от 'pour').
-- =====================================================================
do $$ declare c record; begin
  for c in select conname from pg_constraint
           where conrelid = 'public.chem_moves'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%take%' loop
    execute format('alter table chem_moves drop constraint %I', c.conname);
  end loop;
end $$;
alter table chem_moves add constraint chem_moves_kind_chk check (kind in ('take','pour','add'));

-- запас = остатки замен без подключения и списания + забрано − залито из запаса (приход 'add' запас не меняет)
create or replace function chem_stock_l(p_chemical bigint) returns numeric language sql stable security definer set search_path = public as $$
  select coalesce((select sum(case when coalesce(leftover_l,0) > 0 then leftover_l end) from chem_changes
                   where chemical_id = p_chemical and connect_id is null and written_off_at is null),0)
       + coalesce((select sum(case kind when 'take' then amount_l when 'pour' then -amount_l else 0 end)
                   from chem_moves where chemical_id = p_chemical),0) $$;

create or replace function chem_add(p_chemical bigint, p_group text, p_amount_l numeric, p_amount_kg numeric default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare ch chemicals%rowtype; al numeric; akg numeric; cid uuid;
begin
  if not is_super() then raise exception 'Добавлять химию может только суперадмин'; end if;
  if p_group not in ('1_10','11_12') then raise exception 'Выберите дозатор'; end if;
  select * into ch from chemicals where id = p_chemical;
  if not found then raise exception 'Химия не найдена'; end if;
  if p_amount_l is not null then
    al := p_amount_l;
    akg := case when ch.bottle_l > 0 and ch.bottle_kg > 0 then al * ch.bottle_kg / ch.bottle_l end;
  elsif p_amount_kg is not null then
    akg := p_amount_kg;
    if not (ch.bottle_l > 0 and ch.bottle_kg > 0) then raise exception 'Для этой химии не задана плотность: укажите литры'; end if;
    al := akg * ch.bottle_l / ch.bottle_kg;
  else
    raise exception 'Укажите количество';
  end if;
  if not (al > 0) then raise exception 'Количество должно быть больше нуля'; end if;
  if al > 100000 then raise exception 'Количество указано неверно'; end if;
  perform pg_advisory_xact_lock(hashtext('chem_stock:' || p_chemical::text));
  insert into chem_moves(chemical_id, machine_group, kind, amount_l, amount_kg)
  values (p_chemical, p_group, 'add', al, akg) returning id into cid;
  return cid;
end $$;
revoke all on function chem_add(bigint, text, numeric, numeric) from public;
grant execute on function chem_add(bigint, text, numeric, numeric) to authenticated;

-- сообщение «В запасе только …» без округления до десятых
create or replace function chem_move(p_chemical bigint, p_group text, p_kind text, p_amount_l numeric) returns uuid
language plpgsql security definer set search_path = public as $$
declare ch chemicals%rowtype; cid uuid;
begin
  if not can_fill_chem() then raise exception 'Нет прав'; end if;
  if p_group not in ('1_10','11_12') or p_kind not in ('take','pour') then raise exception 'Неверные параметры'; end if;
  if coalesce(p_amount_l,0) <= 0 then raise exception 'Укажите количество'; end if;
  perform pg_advisory_xact_lock(hashtext('chem_stock:' || p_chemical::text));
  select * into ch from chemicals where id = p_chemical; if not found then raise exception 'Химия не найдена'; end if;
  if p_kind = 'pour' and chem_stock_l(p_chemical) + 1e-9 < p_amount_l then
    raise exception 'В запасе только % л', trim_scale(round(chem_stock_l(p_chemical), 6));
  end if;
  insert into chem_moves(chemical_id, machine_group, kind, amount_l, amount_kg)
  values (p_chemical, p_group, p_kind, p_amount_l, case when ch.bottle_l > 0 and ch.bottle_kg > 0 then p_amount_l * ch.bottle_kg / ch.bottle_l end) returning id into cid;
  return cid;
end $$;
revoke all on function chem_move(bigint, text, text, numeric) from public;
grant execute on function chem_move(bigint, text, text, numeric) to authenticated;

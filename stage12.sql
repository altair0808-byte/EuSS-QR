-- Этап 12: «Сколько реально было в дозаторе» (уточнение уровня задним числом).
-- Выполнить в Supabase -> SQL Editor ПОСЛЕ stage11.sql. Можно запускать повторно.
--
-- Зачем: при замене бутыли система считает, что в дозатор влито 20 л. Если по факту там было меньше
-- и стирки уже прошли, уровень врал. Теперь можно указать: «на такой-то момент в дозаторе было X».
-- Все стирки после этого момента система вычтет сама, остаток и расход в отчёте станут реальными.
-- Последнее указанное значение для пары «химия × дозатор» заменяет прежнее.

create table if not exists chem_levels(
  id          uuid primary key default gen_random_uuid(),
  ts          timestamptz not null default now(),       -- когда внесли запись
  at_ts       timestamptz not null,                     -- на какой момент указан уровень (до стирок)
  shift_date  date,
  chemical_id bigint not null references chemicals(id),
  machine_group text not null check (machine_group in ('1_10','11_12')),
  amount_l    numeric not null check (amount_l >= 0),
  amount_kg   numeric check (amount_kg is null or amount_kg >= 0),
  created_by  uuid default auth.uid());
create index if not exists chem_levels_lookup_idx on chem_levels (chemical_id, machine_group, at_ts);
alter table chem_levels enable row level security;        -- напрямую не читается и не пишется, только через функции ниже

-- p_amount_l / p_amount_kg: передайте одно из значений (второе посчитается по плотности из настроек химии)
create or replace function set_dispenser_level(p_chemical bigint, p_group text, p_at timestamptz,
                                               p_amount_l numeric, p_amount_kg numeric default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare ch chemicals%rowtype; al numeric; akg numeric; cid uuid;
        tz int := coalesce((select value from settings where key='tz_offset'), 5);
        st int := coalesce((select value from settings where key='shift_start'), 6);
begin
  if not can_fill_chem() then raise exception 'Нет прав'; end if;
  if p_group not in ('1_10','11_12') then raise exception 'Выберите дозатор'; end if;
  select * into ch from chemicals where id = p_chemical;
  if not found then raise exception 'Химия не найдена'; end if;
  if p_at is null or p_at > now() + interval '5 minutes' then raise exception 'Момент не может быть в будущем'; end if;
  if p_at < now() - interval '60 days' then raise exception 'Слишком давно: не больше 60 дней назад'; end if;
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
  if al < 0 then raise exception 'Количество указано неверно'; end if;
  perform pg_advisory_xact_lock(hashtext('chem_levels:' || p_chemical::text));
  -- более поздние уточнения этой пары устарели: новое значение заменяет их
  delete from chem_levels where chemical_id = p_chemical and machine_group = p_group and at_ts >= p_at;
  insert into chem_levels(at_ts, shift_date, chemical_id, machine_group, amount_l, amount_kg)
  values (p_at, ((p_at at time zone 'UTC') + make_interval(hours => tz) - make_interval(hours => st))::date,
          p_chemical, p_group, al, akg)
  returning id into cid;
  return cid;
end $$;
revoke all on function set_dispenser_level(bigint, text, timestamptz, numeric, numeric) from public;
grant execute on function set_dispenser_level(bigint, text, timestamptz, numeric, numeric) to authenticated;

-- отчёт отдаёт момент уровня как ts, чтобы клиент обрабатывал его как обычное событие
drop function if exists report_levels(date, date);
create function report_levels(d1 date, d2 date)
returns table(id text, ts timestamptz, shift_date date, chemical_id bigint, machine_group text,
              amount_l numeric, amount_kg numeric, created_by uuid)
language sql stable security definer set search_path = public as
$$ select l.id::text, l.at_ts, l.shift_date, l.chemical_id, l.machine_group, l.amount_l, l.amount_kg, l.created_by
   from chem_levels l
   where can_report() and l.shift_date between d1 and d2
   order by l.at_ts $$;
revoke all on function report_levels(date, date) from public;
grant execute on function report_levels(date, date) to authenticated;

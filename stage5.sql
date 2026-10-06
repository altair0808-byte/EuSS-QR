-- Этап 5: фото химии, правка истории суперадмином, пометка «исправлено».
-- Выполнить в Supabase -> SQL Editor после stage4.sql. Можно запускать повторно.

-- 1) ссылка на фото химиката (карточки в «Замене химии»)
alter table chemicals add column if not exists image_url text;

-- 2) след правки: кто и когда исправил запись загрузки
alter table loads add column if not exists edited_at timestamptz;
alter table loads add column if not exists edited_by uuid;

-- 3) исправлять и удалять загрузки может только суперадмин
drop policy if exists l_upd_super on loads;
create policy l_upd_super on loads for update to authenticated
  using (is_super()) with check (is_super());
drop policy if exists l_del_super on loads;
create policy l_del_super on loads for delete to authenticated
  using (is_super());

-- 4) при смене времени заново считаются смена (shift_date) и день/ночь (part)
create or replace function loads_on_update() returns trigger language plpgsql as $$
declare tz int := (select value from settings where key='tz_offset');
        st int := (select value from settings where key='shift_start');
        loc timestamp;
begin
  if new.ts is distinct from old.ts then
    loc := (new.ts at time zone 'UTC') + make_interval(hours => tz);
    new.shift_date := (loc - make_interval(hours => st))::date;
    new.part := case when extract(hour from loc) >= st and extract(hour from loc) < st + 12 then 'day' else 'night' end;
  end if;
  -- пометка ставится только если изменили саму запись (кнопка «Постиралось» её не трогает)
  if (new.machine, new.wash_type_id, new.weight_kg, new.extras, new.ts)
     is distinct from (old.machine, old.wash_type_id, old.weight_kg, old.extras, old.ts) then
    new.edited_at := now();
    new.edited_by := auth.uid();
  end if;
  return new;
end $$;
drop trigger if exists t_loads_upd on loads;
create trigger t_loads_upd before update on loads for each row execute function loads_on_update();

-- 5) отчёт отдаёт пометку «исправлено» (меняется набор колонок, поэтому drop)
drop function if exists report_loads(date, date);
create function report_loads(d1 date, d2 date)
returns table(id uuid, ts timestamptz, shift_date date, part text, machine int,
              wash_type_id int, weight_kg numeric, extras jsonb, finished_at timestamptz, edited_at timestamptz)
language sql stable security definer set search_path = public as
$$ select l.id, l.ts, l.shift_date, l.part, l.machine, l.wash_type_id, l.weight_kg, l.extras, l.finished_at, l.edited_at
   from loads l
   where can_report() and l.shift_date between d1 and d2
   order by l.ts $$;
revoke all on function report_loads(date, date) from public;
grant execute on function report_loads(date, date) to authenticated;

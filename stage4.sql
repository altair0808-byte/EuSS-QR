-- Этап 4: кнопка «Постиралось» на панели смены.
-- Выполнить после report.sql. Можно запускать повторно.

alter table loads add column if not exists finished_at timestamptz;

-- отметить стирку завершённой: автор загрузки, бригадир или админ
create or replace function finish_load(p_id uuid) returns void
language sql security definer set search_path = public as
$$ update loads set finished_at = now()
   where id = p_id and finished_at is null and (user_id = auth.uid() or can_report()) $$;
revoke all on function finish_load(uuid) from public;
grant execute on function finish_load(uuid) to authenticated;

-- у report_loads добавляется колонка, поэтому сначала drop (иначе ошибка "cannot change return type")
drop function if exists report_loads(date, date);
create function report_loads(d1 date, d2 date)
returns table(id uuid, ts timestamptz, shift_date date, part text, machine int,
              wash_type_id int, weight_kg numeric, extras jsonb, finished_at timestamptz)
language sql stable security definer set search_path = public as
$$ select l.id, l.ts, l.shift_date, l.part, l.machine, l.wash_type_id, l.weight_kg, l.extras, l.finished_at
   from loads l
   where can_report() and l.shift_date between d1 and d2
   order by l.ts $$;
revoke all on function report_loads(date, date) from public;
grant execute on function report_loads(date, date) to authenticated;

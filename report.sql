-- Этап 1: отчёт по сменам. Выполнить в SQL Editor ПОСЛЕ supabase.sql и users.sql.
-- Бригадир и админ видят загрузки всех сотрудников (только чтение, через функцию).

create or replace function can_report() returns boolean
language sql stable security definer set search_path = public as
$$ select is_super() or exists (
     select 1 from form_access where user_id = auth.uid() and role in ('admin','foreman')) $$;

create or replace function report_loads(d1 date, d2 date)
returns table(id uuid, ts timestamptz, shift_date date, part text, machine int,
              wash_type_id int, weight_kg numeric, extras jsonb)
language sql stable security definer set search_path = public as
$$ select l.id, l.ts, l.shift_date, l.part, l.machine, l.wash_type_id, l.weight_kg, l.extras
   from loads l
   where can_report() and l.shift_date between d1 and d2
   order by l.ts $$;

revoke all on function can_report() from public;
revoke all on function report_loads(date, date) from public;
grant execute on function can_report() to authenticated;
grant execute on function report_loads(date, date) to authenticated;

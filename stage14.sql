-- Этап 14: статус машин для ВСЕХ сотрудников с доступом к бланкам (анимация стиралок и процесс стирки).
-- Раньше сотрудник видел в базе только свои загрузки, поэтому чужие стирки на его экране выглядели как «свободна».
-- Функция отдаёт только то, что нужно для статуса машины: без доп. химии и без записей прошлых смен.
-- Выполнить в Supabase -> SQL Editor. Можно запускать повторно. Порядок: сначала этот файл, потом новый index.html.
create or replace function machine_status(d date)
returns table(id uuid, ts timestamptz, machine int, wash_type_id int, weight_kg numeric,
              finished_at timestamptz, created_by uuid)
language sql stable security definer set search_path = public as
$$ select l.id, l.ts, l.machine, l.wash_type_id, l.weight_kg, l.finished_at, l.created_by
   from loads l
   where l.shift_date = d
     and (is_super() or exists (select 1 from form_access a where a.user_id = auth.uid()))
   order by l.ts $$;
revoke all on function machine_status(date) from public;
grant execute on function machine_status(date) to authenticated;

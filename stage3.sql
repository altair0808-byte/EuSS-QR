-- Этап 3: разделение двух дозаторов (машины 1-10 и 11-12).
-- Выполнять после supabase.sql, users.sql, report.sql и stage2.sql.
-- Можно запускать повторно.

alter table chem_changes
  add column if not exists machine_group text not null default '1_10';

-- ограничение значений (если его ещё нет)
do $$ begin
  if not exists (select 1 from pg_constraint where conrelid = 'chem_changes'::regclass and contype = 'c'
                 and pg_get_constraintdef(oid) like '%machine_group%') then
    alter table chem_changes add constraint chem_changes_machine_group_chk check (machine_group in ('1_10','11_12'));
  end if;
end $$;

-- ВАЖНО: у функции меняется набор возвращаемых колонок (добавлен machine_group),
-- поэтому create or replace без drop падает с ошибкой "cannot change return type".
drop function if exists report_changes(date, date);

create function report_changes(d1 date, d2 date)
returns table(
  id uuid, ts timestamptz, shift_date date, machine_group text,
  chemical_id int, leftover_l numeric, leftover_kg numeric
)
language sql stable security definer set search_path = public as
$$
  select c.id, c.ts, c.shift_date, c.machine_group,
         c.chemical_id, c.leftover_l, c.leftover_kg
  from chem_changes c
  where can_report() and c.shift_date between d1 and d2
  order by c.ts
$$;

revoke all on function report_changes(date, date) from public;
grant execute on function report_changes(date, date) to authenticated;

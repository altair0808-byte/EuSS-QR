-- Этап 3: разделение двух дозаторов.
-- Выполнить после report.sql и stage2.sql.

alter table chem_changes
  add column if not exists machine_group text not null default '1_10'
  check (machine_group in ('1_10','11_12'));

-- Старые записи считаем относящимися к основному дозатору 1-10.
update chem_changes set machine_group = '1_10' where machine_group is null;

create or replace function report_changes(d1 date, d2 date)
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

revoke all on function report_changes(date,date) from public;
grant execute on function report_changes(date,date) to authenticated;

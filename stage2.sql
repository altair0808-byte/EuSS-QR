-- Этап 2: факт расхода, вес бутылей, остаток в кг. Выполнить в SQL Editor после report.sql.

-- 1 штука = bottle_l литров = bottle_kg кг (задаёт суперадмин в Настройках)
alter table chemicals add column if not exists bottle_kg numeric;
-- для дополнительной химии: в чём измеряется расход на единицу (мл или г)
alter table chemicals add column if not exists per_unit_unit text not null default 'ml';
update chemicals set per_unit_unit = 'g' where name = 'Порошок';

-- остаток на дне, который бригадир вводит в кг
alter table chem_changes add column if not exists leftover_kg numeric;

-- литры по остатку считаются автоматически в момент записи
create or replace function chem_kg_to_l() returns trigger language plpgsql as $$
declare b numeric; k numeric;
begin
  if new.leftover_kg is not null and new.leftover_l is null then
    select bottle_l, bottle_kg into b, k from chemicals where id = new.chemical_id;
    if b is not null and k is not null and k > 0 then
      new.leftover_l := round(new.leftover_kg * b / k, 3);
    end if;
  end if;
  return new;
end $$;
drop trigger if exists t_chem_kg on chem_changes;
create trigger t_chem_kg before insert on chem_changes for each row execute function chem_kg_to_l();

-- замены химии за период для отчёта (бригадир и админ, только чтение)
create or replace function report_changes(d1 date, d2 date)
returns table(id uuid, ts timestamptz, shift_date date, chemical_id int, leftover_l numeric, leftover_kg numeric)
language sql stable security definer set search_path = public as
$$ select c.id, c.ts, c.shift_date, c.chemical_id, c.leftover_l, c.leftover_kg
   from chem_changes c
   where can_report() and c.shift_date between d1 and d2
   order by c.ts $$;
revoke all on function report_changes(date, date) from public;
grant execute on function report_changes(date, date) to authenticated;

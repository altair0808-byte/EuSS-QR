-- Этап 9: автопересчёт «подключения остатка» при правке или удалении замены химии.
-- Выполнить в Supabase -> SQL Editor ПОСЛЕ stage8.sql. Можно запускать повторно.
-- Сначала выполните этот файл, потом выложите новый report.html на сайт.
-- ЧЕРНОВИК: на живой базе не запускался, прогоните сначала на копии.

-- 1) пересчёт одного подключения по тем заменам, которые к нему сейчас привязаны
create or replace function recalc_connect(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare k chem_connects%rowtype; ch chemicals%rowtype; v_n int; al numeric; akg numeric;
begin
  select * into k from chem_connects where id = p_id;
  if not found then return; end if;
  select * into ch from chemicals where id = k.chemical_id;
  select count(*),
         sum(case when coalesce(leftover_l,0) > 0 then leftover_l
                  when coalesce(leftover_kg,0) > 0 and ch.bottle_kg > 0 and ch.bottle_l > 0 then leftover_kg * ch.bottle_l / ch.bottle_kg end),
         sum(case when coalesce(leftover_kg,0) > 0 then leftover_kg
                  when coalesce(leftover_l,0) > 0 and ch.bottle_kg > 0 and ch.bottle_l > 0 then leftover_l * ch.bottle_kg / ch.bottle_l end)
    into v_n, al, akg
  from chem_changes
  where connect_id = p_id and (coalesce(leftover_kg,0) > 0 or coalesce(leftover_l,0) > 0);
  if v_n = 0 then
    delete from chem_connects where id = p_id;          -- остатка не осталось: подключение исчезает
  else
    update chem_connects set amount_l = al, amount_kg = akg, n = v_n where id = p_id;
  end if;
end $$;
revoke all on function recalc_connect(uuid) from public;

-- 2) триггер: любая правка или удаление замены, уже привязанной к подключению, пересчитывает его
create or replace function chem_connect_sync() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.connect_id is not null then perform recalc_connect(old.connect_id); end if;
  return null;
end $$;
drop trigger if exists t_chem_sync on chem_changes;
create trigger t_chem_sync after update or delete on chem_changes
  for each row execute function chem_connect_sync();

-- 3) в журнал изменений попадают и пересчёты подключений
drop trigger if exists t_conn_audit on chem_connects;
create trigger t_conn_audit after insert or update or delete on chem_connects
  for each row execute function audit_row('connect');

-- 4) разовая сверка старых подключений с текущими данными
select recalc_connect(id) from chem_connects;

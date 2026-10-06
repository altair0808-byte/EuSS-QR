-- Этап 8 (Этап 1 плана): целостность данных. ЧЕРНОВИК, на живой базе не запускался.
-- Выполнять в Supabase -> SQL Editor после stage7.sql. Сначала прогнать на копии базы.
-- Ограничения и внешние ключи добавляются как NOT VALID: старые записи не проверяются, новые проверяются.

-- 1) Индексы под отчёты (фильтры по смене, времени, автору, замене химии)
create index if not exists loads_shift_idx      on loads (shift_date);
create index if not exists loads_ts_idx         on loads (ts);
create index if not exists loads_author_idx     on loads (created_by);
create index if not exists chem_shift_idx       on chem_changes (shift_date);
create index if not exists chem_lookup_idx      on chem_changes (chemical_id, machine_group, ts);
create index if not exists chem_unconnected_idx on chem_changes (chemical_id) where connect_id is null;
create index if not exists conn_shift_idx       on chem_connects (shift_date);
create index if not exists conn_lookup_idx      on chem_connects (chemical_id, machine_group, ts);

-- 2) Проверки значений
alter table loads add constraint loads_weight_chk check (weight_kg > 0 and weight_kg <= 500) not valid;
alter table recipes add constraint recipes_ml_chk check (ml_per_l >= 0) not valid;
alter table chem_changes add constraint chem_left_chk check (coalesce(leftover_l,0) >= 0 and coalesce(leftover_kg,0) >= 0) not valid;
alter table chem_connects add constraint conn_amount_chk check (coalesce(amount_l,0) >= 0 and coalesce(amount_kg,0) >= 0) not valid;

-- 3) Недостающие внешние ключи
alter table chem_connects add constraint conn_chem_fk foreign key (chemical_id) references chemicals(id) not valid;
alter table chem_changes  add constraint chem_connect_fk foreign key (connect_id) references chem_connects(id) on delete set null not valid;

-- 4) Названия видов стирки и химии не должны дублироваться
-- Если индекс не создаётся, в базе уже есть дубли: select lower(name), count(*) from chemicals group by 1 having count(*) > 1;
create unique index if not exists wash_types_name_uq on wash_types (lower(name));
create unique index if not exists chemicals_name_uq  on chemicals (lower(name));

-- 5) Время записи с телефона: нельзя ставить далёкое прошлое или будущее (суперадмин не ограничен).
-- Это же закрывает обход «отмены за 10 минут» записью с временем в будущем.
create or replace function check_ts() returns trigger language plpgsql as $$
begin
  if not is_super() and (new.ts > now() + interval '1 minute' or new.ts < now() - interval '36 hours') then
    raise exception 'Время записи вне допустимого диапазона';
  end if;
  return new;
end $$;
drop trigger if exists t_loads_ts on loads;
create trigger t_loads_ts before insert on loads for each row execute function check_ts();
drop trigger if exists t_chem_ts on chem_changes;
create trigger t_chem_ts before insert on chem_changes for each row execute function check_ts();

-- 6) «Подключили остаток»: блокировка от двойного нажатия (иначе два параллельных вызова создают два подключения)
create or replace function connect_leftovers(p_chemical bigint, p_group text) returns uuid
language plpgsql security definer set search_path = public as $$
declare ch chemicals%rowtype; tz int := (select value from settings where key='tz_offset');
        st int := (select value from settings where key='shift_start');
        n int; al numeric; akg numeric; cid uuid;
begin
  if not can_fill_chem() then raise exception 'Нет прав подключать остаток'; end if;
  if p_group not in ('1_10','11_12') then raise exception 'Выберите дозатор'; end if;
  perform pg_advisory_xact_lock(hashtext('connect_leftovers:' || p_chemical::text));
  select * into ch from chemicals where id = p_chemical;
  if not found then raise exception 'Химия не найдена'; end if;
  select count(*),
         sum(case when coalesce(leftover_l,0) > 0 then leftover_l
                  when coalesce(leftover_kg,0) > 0 and ch.bottle_kg > 0 and ch.bottle_l > 0 then leftover_kg * ch.bottle_l / ch.bottle_kg end),
         sum(case when coalesce(leftover_kg,0) > 0 then leftover_kg
                  when coalesce(leftover_l,0) > 0 and ch.bottle_kg > 0 and ch.bottle_l > 0 then leftover_l * ch.bottle_kg / ch.bottle_l end)
    into n, al, akg
  from chem_changes
  where chemical_id = p_chemical and connect_id is null and (coalesce(leftover_kg,0) > 0 or coalesce(leftover_l,0) > 0);
  if n = 0 then raise exception 'Остатка нет'; end if;
  insert into chem_connects(shift_date, chemical_id, machine_group, amount_l, amount_kg, n)
  values (((now() at time zone 'UTC') + make_interval(hours => tz) - make_interval(hours => st))::date, p_chemical, p_group, al, akg, n)
  returning id into cid;
  update chem_changes set connect_id = cid
  where chemical_id = p_chemical and connect_id is null and (coalesce(leftover_kg,0) > 0 or coalesce(leftover_l,0) > 0);
  return cid;
end $$;
revoke all on function connect_leftovers(bigint, text) from public;
grant execute on function connect_leftovers(bigint, text) to authenticated;

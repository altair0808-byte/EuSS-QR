-- Этап 10: «забрал остаток из дозатора» и «залил в дозатор» (вкладка «Химия», анимация хранилища).
-- Выполнить в Supabase -> SQL Editor ПОСЛЕ stage9.sql. Можно запускать повторно. ЧЕРНОВИК: на живой базе не запускался.
create table if not exists chem_moves(
  id uuid primary key default gen_random_uuid(), ts timestamptz not null default now(), shift_date date,
  chemical_id bigint not null references chemicals(id), machine_group text not null check (machine_group in ('1_10','11_12')),
  kind text not null check (kind in ('take','pour')), amount_l numeric check (amount_l > 0), amount_kg numeric, created_by uuid default auth.uid());
alter table chem_moves enable row level security;
drop policy if exists mv_sel on chem_moves; create policy mv_sel on chem_moves for select to authenticated using (can_report() or is_super());
drop trigger if exists t_mv_shift on chem_moves; create trigger t_mv_shift before insert on chem_moves for each row execute function set_shift();

-- запас химии = остатки замен без подключения + забрано − залито
create or replace function chem_stock_l(p_chemical bigint) returns numeric language sql stable security definer set search_path = public as $$
  select coalesce((select sum(case when coalesce(leftover_l,0) > 0 then leftover_l end) from chem_changes where chemical_id = p_chemical and connect_id is null),0)
       + coalesce((select sum(case kind when 'take' then amount_l else -amount_l end) from chem_moves where chemical_id = p_chemical),0) $$;

create or replace function chem_move(p_chemical bigint, p_group text, p_kind text, p_amount_l numeric) returns uuid
language plpgsql security definer set search_path = public as $$
declare ch chemicals%rowtype; cid uuid;
begin
  if not can_fill_chem() then raise exception 'Нет прав'; end if;
  if p_group not in ('1_10','11_12') or p_kind not in ('take','pour') then raise exception 'Неверные параметры'; end if;
  if coalesce(p_amount_l,0) <= 0 then raise exception 'Укажите количество'; end if;
  perform pg_advisory_xact_lock(hashtext('chem_stock:' || p_chemical::text));
  select * into ch from chemicals where id = p_chemical; if not found then raise exception 'Химия не найдена'; end if;
  if p_kind = 'pour' and chem_stock_l(p_chemical) + 1e-9 < p_amount_l then raise exception 'В запасе только % л', round(chem_stock_l(p_chemical),1); end if;
  insert into chem_moves(chemical_id, machine_group, kind, amount_l, amount_kg)
  values (p_chemical, p_group, p_kind, p_amount_l, case when ch.bottle_l > 0 and ch.bottle_kg > 0 then p_amount_l * ch.bottle_kg / ch.bottle_l end) returning id into cid;
  return cid;
end $$;
revoke all on function chem_move(bigint, text, text, numeric) from public; grant execute on function chem_move(bigint, text, text, numeric) to authenticated;

drop function if exists report_moves(date, date);
create function report_moves(d1 date, d2 date) returns table(id text, ts timestamptz, shift_date date, chemical_id bigint, machine_group text, kind text, amount_l numeric, amount_kg numeric, created_by uuid)
language sql stable security definer set search_path = public as $$
  select m.id::text, m.ts, m.shift_date, m.chemical_id, m.machine_group, m.kind, m.amount_l, m.amount_kg, m.created_by
  from chem_moves m where can_report() and m.shift_date between d1 and d2 order by m.ts $$;
revoke all on function report_moves(date, date) from public; grant execute on function report_moves(date, date) to authenticated;

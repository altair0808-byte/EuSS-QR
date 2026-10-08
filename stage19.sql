-- stage19.sql — Этап 2 «Учёт химикатов». ЧЕРНОВИК: на живой базе не запускался, СНАЧАЛА НА КОПИИ.
-- Выполнить в Supabase -> SQL Editor ПОСЛЕ stage18.sql. Можно запускать повторно.
-- Порядок выкладки: сначала этот файл, потом новые html/js (report-calc.js, storage-anim.js, chem-stats.js,
-- report.html, closing-xlsx.js).
--
-- Что делает файл:
--  1) ПОСТУПЛЕНИЕ химикатов попадает в ОБЩИЙ ЗАПАС: новый вид записи chem_moves.kind = 'receipt' (machine_group = 'stock').
--  2) Из запаса химию РАСПРЕДЕЛЯЮТ по дозаторам обычным «залить» (kind = 'pour', уже есть) или сразу при поступлении
--     (chem_receipt с p_pour_group). Поступление и заливка в этом случае записываются одной транзакцией.
--  3) «Добавить химию» суперадмина (chem_add) теперь тоже идёт через запас: поступление + заливка в выбранный дозатор.
--     Старые записи kind = 'add' остаются как есть и по-прежнему учитываются.
--  4) Списание из запаса (stock_writeoff, только суперадмин, с паролем) теперь хранит причину в самой записи.
--  5) Запас (chem_stock_l, closing_reserve_at) учитывает поступления: запас = остатки замен + забрано + поступило − залито − списано.
--  6) report_moves отдаёт примечание (note).

-- =====================================================================
-- 1) Колонки и ограничения
-- =====================================================================
alter table chem_moves add column if not exists note text;

do $$ declare c record; begin
  for c in select conname from pg_constraint
           where conrelid = 'public.chem_moves'::regclass and contype = 'c'
             and pg_get_constraintdef(oid) ilike '%kind%' loop
    execute format('alter table chem_moves drop constraint %I', c.conname);
  end loop;
end $$;
alter table chem_moves add constraint chem_moves_kind_chk check (kind in ('take','pour','add','writeoff','receipt'));

-- поступление и списание относятся к запасу, остальное к дозатору (старые записи не проверяются, новые проверяются)
alter table chem_moves drop constraint if exists chem_moves_stockgrp_chk;
alter table chem_moves add constraint chem_moves_stockgrp_chk
  check ((kind in ('receipt','writeoff') and machine_group = 'stock') or (kind in ('take','pour','add') and machine_group in ('1_10','11_12'))) not valid;

-- =====================================================================
-- 2) Запас, литры (общий, без привязки к дозатору)
--    остатки замен без подключения и списания + забрано из дозаторов + поступило − залито − списано
--    (kind = 'add' запас не меняет: это старые записи «в дозатор напрямую»)
-- =====================================================================
create or replace function chem_stock_l(p_chemical bigint) returns numeric language sql stable security definer set search_path = public as $$
  select coalesce((select sum(case when coalesce(leftover_l,0) > 0 then leftover_l end) from chem_changes
                   where chemical_id = p_chemical and connect_id is null and written_off_at is null),0)
       + coalesce((select sum(case kind when 'take' then amount_l when 'receipt' then amount_l when 'pour' then -amount_l when 'writeoff' then -amount_l else 0 end)
                   from chem_moves where chemical_id = p_chemical),0) $$;

-- =====================================================================
-- 3) Запас на момент времени, кг (по каждому химикату). Учитывает только то, что было ДО p_ts.
-- =====================================================================
create or replace function closing_reserve_at(p_ts timestamptz)
returns table(chemical_id bigint, kg numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Нет прав'; end if;
  return query
  select ch.id::bigint,
         round(coalesce(lo.kg, 0) + coalesce(mv.kg, 0), 6)
  from chemicals ch
  left join (
    select c.chemical_id as cid,
           sum(case when coalesce(c.leftover_kg,0) > 0 then c.leftover_kg
                    when coalesce(c.leftover_l,0) > 0 and h.bottle_l > 0 and h.bottle_kg > 0 then c.leftover_l * h.bottle_kg / h.bottle_l end) as kg
    from chem_changes c
    join chemicals h on h.id = c.chemical_id
    left join chem_connects cn on cn.id = c.connect_id
    where c.ts < p_ts
      and (c.connect_id is null or cn.ts >= p_ts)
      and (c.written_off_at is null or c.written_off_at >= p_ts)
    group by c.chemical_id
  ) lo on lo.cid = ch.id
  left join (
    select m.chemical_id as cid,
           sum(case m.kind when 'take' then 1 when 'receipt' then 1 when 'pour' then -1 when 'writeoff' then -1 else 0 end
               * coalesce(m.amount_kg, case when h.bottle_l > 0 and h.bottle_kg > 0 then m.amount_l * h.bottle_kg / h.bottle_l end, 0)) as kg
    from chem_moves m
    join chemicals h on h.id = m.chemical_id
    where m.ts < p_ts
    group by m.chemical_id
  ) mv on mv.cid = ch.id
  order by ch.sort, ch.id;
end $$;
revoke all on function closing_reserve_at(timestamptz) from public;
grant execute on function closing_reserve_at(timestamptz) to authenticated;

-- Запас сейчас (для экрана «Химия»): литры и кг по каждому химикату. Видят те, кто работает с химией, и отчёты.
create or replace function stock_now()
returns table(chemical_id bigint, stock_l numeric, stock_kg numeric)
language sql stable security definer set search_path = public as $$
  select ch.id::bigint, round(chem_stock_l(ch.id), 6),
         case when ch.bottle_l > 0 and ch.bottle_kg > 0 then round(chem_stock_l(ch.id) * ch.bottle_kg / ch.bottle_l, 6) end
  from chemicals ch
  where can_fill_chem() or can_report()
  order by ch.sort, ch.id $$;
revoke all on function stock_now() from public;
grant execute on function stock_now() to authenticated;

-- =====================================================================
-- 4) Поступление химии в общий запас
--    p_amount_l или p_amount_kg (второе считается по плотности из настроек химии).
--    p_pour_group ('1_10' | '11_12', необязательно): сразу залить всё поступившее в этот дозатор.
--    Права: суперадмин и те, кто работает с бланком «Замена химии» (как «залить» и «забрать»).
-- =====================================================================
create or replace function chem_receipt(p_chemical bigint, p_amount_l numeric, p_amount_kg numeric default null,
                                        p_note text default null, p_pour_group text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare ch chemicals%rowtype; al numeric; akg numeric; rid uuid; v_note text := nullif(trim(p_note), '');
begin
  if not can_fill_chem() then raise exception 'Нет прав принимать поступление'; end if;
  select * into ch from chemicals where id = p_chemical;
  if not found then raise exception 'Химия не найдена'; end if;
  if p_pour_group is not null and p_pour_group not in ('1_10','11_12') then raise exception 'Выберите дозатор'; end if;
  if p_amount_l is not null then
    al := p_amount_l;
    akg := case when ch.bottle_l > 0 and ch.bottle_kg > 0 then al * ch.bottle_kg / ch.bottle_l end;
  elsif p_amount_kg is not null then
    akg := p_amount_kg;
    if not (ch.bottle_l > 0 and ch.bottle_kg > 0) then raise exception 'Для этой химии не задана плотность: укажите литры'; end if;
    al := akg * ch.bottle_l / ch.bottle_kg;
  else
    raise exception 'Укажите количество';
  end if;
  if not (al > 0) then raise exception 'Количество должно быть больше нуля'; end if;
  if al > 100000 then raise exception 'Количество указано неверно'; end if;
  if v_note is not null and length(v_note) > 300 then raise exception 'Примечание длиннее 300 знаков'; end if;
  perform pg_advisory_xact_lock(hashtext('chem_stock:' || p_chemical::text));
  insert into chem_moves(chemical_id, machine_group, kind, amount_l, amount_kg, note)
  values (p_chemical, 'stock', 'receipt', al, akg, v_note) returning id into rid;
  if p_pour_group is not null then
    insert into chem_moves(chemical_id, machine_group, kind, amount_l, amount_kg, note)
    values (p_chemical, p_pour_group, 'pour', al, akg, 'Сразу при поступлении');
  end if;
  return rid;
end $$;
revoke all on function chem_receipt(bigint, numeric, numeric, text, text) from public;
grant execute on function chem_receipt(bigint, numeric, numeric, text, text) to authenticated;

-- «Добавить химию» суперадмина (кнопка у дозатора): теперь = поступление в запас + заливка в выбранный дозатор.
-- Запас при этом не меняется (пришло и сразу ушло в дозатор), но поступление видно в отчётах.
create or replace function chem_add(p_chemical bigint, p_group text, p_amount_l numeric, p_amount_kg numeric default null)
returns uuid language plpgsql security definer set search_path = public as $$
begin
  if not is_super() then raise exception 'Добавлять химию может только суперадмин'; end if;
  if p_group not in ('1_10','11_12') then raise exception 'Выберите дозатор'; end if;
  return chem_receipt(p_chemical, p_amount_l, p_amount_kg, 'Добавлено в дозатор (суперадмин)', p_group);
end $$;
revoke all on function chem_add(bigint, text, numeric, numeric) from public;
grant execute on function chem_add(bigint, text, numeric, numeric) to authenticated;

-- =====================================================================
-- 5) Заливка из запаса и забор из дозатора: прежние правила, плюс сообщение «В запасе только …» считает поступления
-- =====================================================================
create or replace function chem_move(p_chemical bigint, p_group text, p_kind text, p_amount_l numeric) returns uuid
language plpgsql security definer set search_path = public as $$
declare ch chemicals%rowtype; cid uuid;
begin
  if not can_fill_chem() then raise exception 'Нет прав'; end if;
  if p_group not in ('1_10','11_12') or p_kind not in ('take','pour') then raise exception 'Неверные параметры'; end if;
  if coalesce(p_amount_l,0) <= 0 then raise exception 'Укажите количество'; end if;
  perform pg_advisory_xact_lock(hashtext('chem_stock:' || p_chemical::text));
  select * into ch from chemicals where id = p_chemical; if not found then raise exception 'Химия не найдена'; end if;
  if p_kind = 'pour' and chem_stock_l(p_chemical) + 1e-9 < p_amount_l then
    raise exception 'В запасе только % л', trim_scale(round(chem_stock_l(p_chemical), 6));
  end if;
  insert into chem_moves(chemical_id, machine_group, kind, amount_l, amount_kg)
  values (p_chemical, p_group, p_kind, p_amount_l, case when ch.bottle_l > 0 and ch.bottle_kg > 0 then p_amount_l * ch.bottle_kg / ch.bottle_l end) returning id into cid;
  return cid;
end $$;
revoke all on function chem_move(bigint, text, text, numeric) from public;
grant execute on function chem_move(bigint, text, text, numeric) to authenticated;

-- =====================================================================
-- 6) Списание из запаса (только суперадмин, с паролем). Причина сохраняется в записи (note) и в журнале.
--    Списывать больше, чем есть в запасе, нельзя. Количество в кг (литры считаются по плотности из настроек).
-- =====================================================================
create or replace function stock_writeoff(p_chemical bigint, p_amount_kg numeric, p_pw text, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare ch chemicals%rowtype; v_have numeric; v_msg text; v_id uuid; v_note text := nullif(trim(p_note), '');
begin
  if not is_super() then raise exception 'Списывать из запаса может только суперадмин'; end if;
  select * into ch from chemicals where id = p_chemical;
  if not found then raise exception 'Химия не найдена'; end if;
  if coalesce(p_amount_kg, 0) <= 0 or p_amount_kg > 100000 then raise exception 'Укажите количество больше нуля'; end if;
  if v_note is not null and length(v_note) > 300 then raise exception 'Причина длиннее 300 знаков'; end if;
  perform pg_advisory_xact_lock(hashtext('chem_stock:' || p_chemical::text));
  select r.kg into v_have from closing_reserve_at(now() + interval '1 second') r where r.chemical_id = p_chemical;
  if coalesce(v_have, 0) + 1e-9 < p_amount_kg then
    raise exception 'В запасе только % кг', trim_scale(round(coalesce(v_have, 0), 3));
  end if;
  v_msg := check_my_password(p_pw);
  if v_msg is not null then return jsonb_build_object('ok', false, 'error', v_msg); end if;
  insert into chem_moves(chemical_id, machine_group, kind, amount_l, amount_kg, note)
  values (p_chemical, 'stock', 'writeoff',
          case when ch.bottle_l > 0 and ch.bottle_kg > 0 then p_amount_kg * ch.bottle_l / ch.bottle_kg end, p_amount_kg, v_note)
  returning id into v_id;
  insert into closing_log(actor, action, details)
  values (auth.uid(), 'writeoff', jsonb_build_object('chemical_id', p_chemical, 'amount_kg', p_amount_kg, 'note', v_note, 'move_id', v_id));
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;
revoke all on function stock_writeoff(bigint, numeric, text, text) from public;
grant execute on function stock_writeoff(bigint, numeric, text, text) to authenticated;

-- =====================================================================
-- 7) report_moves: + note (набор колонок меняется, поэтому drop)
-- =====================================================================
drop function if exists report_moves(date, date);
create function report_moves(d1 date, d2 date) returns table(id text, ts timestamptz, shift_date date, chemical_id bigint, machine_group text, kind text, amount_l numeric, amount_kg numeric, created_by uuid, closing_id uuid, note text)
language sql stable security definer set search_path = public as $$
  select m.id::text, m.ts, m.shift_date, m.chemical_id, m.machine_group, m.kind, m.amount_l, m.amount_kg, m.created_by, m.closing_id, m.note
  from chem_moves m where can_report() and m.shift_date between d1 and d2 order by m.ts $$;
revoke all on function report_moves(date, date) from public;
grant execute on function report_moves(date, date) to authenticated;

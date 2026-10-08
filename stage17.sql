-- stage17.sql — ЧЕРНОВИК: на живой базе не запускался, СНАЧАЛА НА КОПИИ.
-- Выполнить в Supabase -> SQL Editor ПОСЛЕ stage16.sql. Можно запускать повторно.
-- Порядок выкладки: сначала этот файл, потом новые html/js (closing.html, closings-report.html, closing-dash.js,
-- report-calc.js, closing-xlsx.js, xlsx-writer.js, chem-stats.js, storage-anim.js). Старые экраны закрытия после этого файла
-- работать перестанут (функция closing_create получила другую сигнатуру), поэтому выкладывайте всё вместе.
--
-- Что делает файл:
--  1) закрытие отчёта в ЛЮБУЮ минуту (раньше только в 06:00 выбранной даты). Статистика не обнуляется: закрытия идут одной цепочкой,
--     следующий период начинается ровно в момент предыдущего замера;
--  2) закрытие месяца в любое время, но только до первой стирки 1 числа нового месяца (позднее закрытие — только суперадмин, как раньше);
--  3) остаток, который взвесили в дозаторе при закрытии, уходит в запас отдельной записью (chem_moves, kind = 'take', closing_id);
--     дозатор после закрытия считается с нуля, дальше из запаса заливают обратно обычной кнопкой «залить» (kind = 'pour');
--  4) списание из запаса (kind = 'writeoff', только суперадмин, с паролем): учитывается в отчёте и вычитается из запаса;
--  5) отчёты читают запас на любой момент времени: closing_reserve_at(ts).

-- =====================================================================
-- 1) Колонки и ограничения
-- =====================================================================
alter table closings add column if not exists opens_month text;   -- месяц ('YYYY-MM'), к которому относится период, НАЧИНАЮЩИЙСЯ с этого замера
alter table closings add column if not exists reserve jsonb;       -- запас по химикатам, кг, сразу после этого закрытия: {"<id химии>": кг}
update closings set opens_month = to_char(boundary_date, 'YYYY-MM') where opens_month is null;

alter table chem_moves add column if not exists closing_id uuid references closings(id) on delete cascade;   -- забор остатка при закрытии
create index if not exists chem_moves_closing_idx on chem_moves (closing_id) where closing_id is not null;

-- kind: + 'writeoff' (списание из запаса); machine_group: + 'stock' (запас, без дозатора)
do $$ declare c record; begin
  for c in select conname from pg_constraint
           where conrelid = 'public.chem_moves'::regclass and contype = 'c'
             and (pg_get_constraintdef(oid) ilike '%kind%' or pg_get_constraintdef(oid) ilike '%machine_group%') loop
    execute format('alter table chem_moves drop constraint %I', c.conname);
  end loop;
end $$;
alter table chem_moves add constraint chem_moves_kind_chk  check (kind in ('take','pour','add','writeoff'));
alter table chem_moves add constraint chem_moves_group_chk check (machine_group in ('1_10','11_12','stock'));

-- запас химии, литры: остатки замен без подключения и списания + забрано (в т.ч. при закрытии) − залито − списано
-- (приход 'add' запас не меняет)
create or replace function chem_stock_l(p_chemical bigint) returns numeric language sql stable security definer set search_path = public as $$
  select coalesce((select sum(case when coalesce(leftover_l,0) > 0 then leftover_l end) from chem_changes
                   where chemical_id = p_chemical and connect_id is null and written_off_at is null),0)
       + coalesce((select sum(case kind when 'take' then amount_l when 'pour' then -amount_l when 'writeoff' then -amount_l else 0 end)
                   from chem_moves where chemical_id = p_chemical),0) $$;

-- =====================================================================
-- 2) Запас на момент времени, кг (по каждому химикату). Считает по записям, учитывает только то, что было ДО p_ts.
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
           sum(case m.kind when 'take' then 1 when 'pour' then -1 when 'writeoff' then -1 else 0 end
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

-- =====================================================================
-- 3) Правила времени закрытия (одно место для экрана и для самого закрытия)
--    Возвращает {ok, error, month_key, opens_month}.
--    start    — начальный замер: один раз, в любое время.
--    interval — отчёт за прошедшие смены: в любое время внутри месяца (не позже конца месяца).
--    month    — закрытие месяца: в любое время в последний день месяца или 1 числа, но ДО первой стирки 1 числа нового месяца
--               и после последней стирки старого месяца. Позднее закрытие (p_late) — только суперадмин, правила времени не действуют.
-- =====================================================================
create or replace function closing_check_time(p_kind text, p_at timestamptz, p_late boolean default false) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_last closings%rowtype; v_has boolean; v_tz int; v_loc timestamp; v_open text; v_first date; v_next date;
        v_new_before boolean; v_old_after boolean; v_late boolean := coalesce(p_late, false);
begin
  if not is_admin() then return jsonb_build_object('ok', false, 'error', 'Закрывать период могут админы и суперадмин'); end if;
  if p_kind is null or p_kind not in ('start','interval','month') then return jsonb_build_object('ok', false, 'error', 'Неверный вид закрытия'); end if;
  if p_at is null then return jsonb_build_object('ok', false, 'error', 'Не указано время замера'); end if;
  if p_at > now() + interval '1 minute' then return jsonb_build_object('ok', false, 'error', 'Замер не может быть в будущем'); end if;
  if v_late and not is_super() then return jsonb_build_object('ok', false, 'error', 'Позднее закрытие может сделать только суперадмин'); end if;
  if v_late and p_kind <> 'month' then return jsonb_build_object('ok', false, 'error', 'Позднее закрытие бывает только у месяца'); end if;
  v_tz  := coalesce((select value from settings where key = 'tz_offset'), 5)::int;
  v_loc := (p_at at time zone 'UTC') + make_interval(hours => v_tz);
  select * into v_last from closings order by at_ts desc limit 1;
  v_has := found;

  if p_kind = 'start' then
    if v_has then return jsonb_build_object('ok', false, 'error', 'Начальный замер уже есть. Дальше закрывайте месяц или отчёт за прошедшие смены'); end if;
    return jsonb_build_object('ok', true, 'month_key', to_char(v_loc, 'YYYY-MM'), 'opens_month', to_char(v_loc, 'YYYY-MM'));
  end if;

  if not v_has then return jsonb_build_object('ok', false, 'error', 'Сначала внесите начальный замер'); end if;
  if p_at <= v_last.at_ts then
    return jsonb_build_object('ok', false, 'error', 'Замер должен быть позже предыдущего (' ||
      to_char((v_last.at_ts at time zone 'UTC') + make_interval(hours => v_tz), 'DD.MM.YYYY HH24:MI') || ')');
  end if;

  v_open  := coalesce(v_last.opens_month, to_char(v_last.boundary_date, 'YYYY-MM'));   -- месяц текущего открытого периода
  v_first := (v_open || '-01')::date;
  v_next  := (v_first + interval '1 month')::date;                                      -- 1 число следующего месяца
  v_new_before := exists (select 1 from loads where shift_date >= v_next and ts < p_at);               -- уже была стирка нового месяца до этого времени
  v_old_after  := exists (select 1 from loads where shift_date >= v_first and shift_date < v_next and ts >= p_at);   -- после этого времени ещё есть стирки старого месяца

  if p_kind = 'interval' then
    if v_loc::date >= v_next then
      return jsonb_build_object('ok', false, 'error', 'Месяц закончился: закройте месяц (до первой стирки 1 числа), а не отчёт внутри месяца');
    end if;
    return jsonb_build_object('ok', true, 'month_key', v_open, 'opens_month', v_open);
  end if;

  -- month
  if not v_late then
    if v_loc::date < v_next - 1 or v_loc::date > v_next then
      return jsonb_build_object('ok', false, 'error', 'Месяц закрывается в последний день месяца или 1 числа, до первой стирки 1 числа');
    end if;
    if v_new_before then
      return jsonb_build_object('ok', false, 'error', 'Уже была стирка нового месяца до этого времени. Укажите время до первой стирки 1 числа. Если месяц пропущен, закрытие делает суперадмин (позднее закрытие)');
    end if;
    if v_old_after then
      return jsonb_build_object('ok', false, 'error', 'После этого времени есть стирки закрываемого месяца. Укажите время после последней стирки месяца');
    end if;
  end if;
  return jsonb_build_object('ok', true, 'month_key', v_open, 'opens_month', to_char(v_next, 'YYYY-MM'));
end $$;
revoke all on function closing_check_time(text, timestamptz, boolean) from public;
grant execute on function closing_check_time(text, timestamptz, boolean) to authenticated;

-- =====================================================================
-- 4) Закрыть период (новая сигнатура: время замера вместо даты)
--    p_kind:      'start' | 'interval' | 'month'
--    p_at:        момент замера (любая минута, не в будущем)
--    p_measures:  [{"chemical_id":1,"machine_group":"1_10","amount_kg":12.5}, ...] — все химикаты × оба дозатора
--    p_snapshot:  результат calcClosing (для start не нужен)
--    p_late:      только суперадмин: закрыть месяц после первой стирки 1 числа
--    Остаток каждого дозатора записывается в запас (chem_moves: take, closing_id) в момент замера.
--    Возвращает {ok:true,id} или {ok:false,error} при неверном пароле. Остальные ошибки — исключениями.
-- =====================================================================
drop function if exists closing_create(text, date, jsonb, jsonb, text, boolean, text);
create or replace function closing_create(p_kind text, p_at timestamptz, p_measures jsonb, p_snapshot jsonb, p_pw text,
                                          p_late boolean default false, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_last closings%rowtype; v_has boolean; v_at timestamptz; v_msg text; v_missing text; v_id uuid;
        v_chk jsonb; v_etalon boolean; v_late boolean := coalesce(p_late, false); v_res jsonb;
begin
  if not is_admin() then raise exception 'Закрывать период могут админы и суперадмин'; end if;
  if p_at is null then raise exception 'Не указано время замера'; end if;
  perform pg_advisory_xact_lock(hashtext('closings'));
  v_at := date_trunc('minute', p_at);
  v_chk := closing_check_time(p_kind, v_at, v_late);
  if not (v_chk ->> 'ok')::boolean then raise exception '%', v_chk ->> 'error'; end if;
  select * into v_last from closings order by at_ts desc limit 1;
  v_has := found;

  -- замеры: формат, значения, без повторов, ничего не пропущено
  if p_measures is null or jsonb_typeof(p_measures) <> 'array' then raise exception 'Нет замеров'; end if;
  if exists (select 1 from jsonb_to_recordset(p_measures) as x(chemical_id int, machine_group text, amount_kg numeric)
             where x.chemical_id is null or x.machine_group is null or x.machine_group not in ('1_10','11_12')
                or x.amount_kg is null or x.amount_kg < 0 or x.amount_kg > 100000
                or not exists (select 1 from chemicals c where c.id = x.chemical_id)) then
    raise exception 'Замеры указаны неверно (химикат, дозатор или количество)';
  end if;
  if exists (select 1 from jsonb_to_recordset(p_measures) as x(chemical_id int, machine_group text, amount_kg numeric)
             group by x.chemical_id, x.machine_group having count(*) > 1) then
    raise exception 'Один и тот же замер указан дважды';
  end if;
  select string_agg(c.name || ' (' || case g.grp when '1_10' then 'дозатор 1' else 'дозатор 2' end || ')', ', ' order by c.sort, c.id, g.grp)
    into v_missing
  from chemicals c cross join (values ('1_10'), ('11_12')) as g(grp)
  where (c.kind = 'main' or c.in_closing)
    and not exists (select 1 from jsonb_to_recordset(p_measures) as x(chemical_id int, machine_group text, amount_kg numeric)
                    where x.chemical_id = c.id and x.machine_group = g.grp);
  if v_missing is not null then raise exception 'Нет замера: %', v_missing; end if;
  if p_kind <> 'start' and (p_snapshot is null or jsonb_typeof(p_snapshot) <> 'object') then
    raise exception 'Нет расчёта периода';
  end if;

  v_msg := check_my_password(p_pw);
  if v_msg is not null then return jsonb_build_object('ok', false, 'error', v_msg); end if;

  -- первое закрытие с расчётом периода становится эталоном (суперадмин может выбрать другое)
  v_etalon := p_kind <> 'start' and not exists (select 1 from closings where is_etalon);
  insert into closings(kind, boundary_date, at_ts, prev_id, period_from, month_key, opens_month, late, is_etalon, snapshot, note)
  values (p_kind, closing_shift_date(v_at), v_at, case when v_has then v_last.id end, case when v_has then v_last.at_ts end,
          v_chk ->> 'month_key', v_chk ->> 'opens_month', v_late, v_etalon, case when p_kind = 'start' then null else p_snapshot end, nullif(trim(p_note), ''))
  returning id into v_id;
  insert into closing_measures(closing_id, chemical_id, machine_group, amount_kg)
  select v_id, x.chemical_id, x.machine_group, x.amount_kg
  from jsonb_to_recordset(p_measures) as x(chemical_id int, machine_group text, amount_kg numeric);

  -- остаток дозатора уходит в запас: забор в момент замера. Дальше дозатор считается с нуля, заливают из запаса кнопкой «залить»
  insert into chem_moves(chemical_id, machine_group, kind, amount_l, amount_kg, ts, closing_id)
  select x.chemical_id, x.machine_group, 'take',
         case when ch.bottle_l > 0 and ch.bottle_kg > 0 then x.amount_kg * ch.bottle_l / ch.bottle_kg end,
         x.amount_kg, v_at, v_id
  from jsonb_to_recordset(p_measures) as x(chemical_id int, machine_group text, amount_kg numeric)
  join chemicals ch on ch.id = x.chemical_id
  where x.amount_kg > 0;

  -- запас сразу после закрытия (для следующего отчёта)
  select coalesce(jsonb_object_agg(r.chemical_id::text, r.kg), '{}'::jsonb) into v_res from closing_reserve_at(v_at + interval '1 second') r;
  update closings set reserve = v_res where id = v_id;

  insert into closing_log(actor, action, closing_id, details)
  values (auth.uid(), 'create', v_id, jsonb_build_object('kind', p_kind, 'at', v_at, 'late', v_late, 'etalon', v_etalon, 'measures', p_measures, 'reserve', v_res));
  return jsonb_build_object('ok', true, 'id', v_id, 'etalon', v_etalon);
end $$;

-- дата смены (местная) для момента времени
create or replace function closing_shift_date(p_ts timestamptz) returns date language sql stable as $$
  select (((p_ts at time zone 'UTC') + make_interval(hours => coalesce((select value from settings where key = 'tz_offset'), 5)::int)
                                     - make_interval(hours => coalesce((select value from settings where key = 'shift_start'), 6)::int)))::date $$;
revoke all on function closing_shift_date(timestamptz) from public;
grant execute on function closing_shift_date(timestamptz) to authenticated;

revoke all on function closing_create(text, timestamptz, jsonb, jsonb, text, boolean, text) from public;
grant execute on function closing_create(text, timestamptz, jsonb, jsonb, text, boolean, text) to authenticated;

-- =====================================================================
-- 5) Отменить ПОСЛЕДНЕЕ закрытие: вместе с ним убираются заборы в запас, сделанные этим закрытием
-- =====================================================================
create or replace function closing_delete_last(p_id uuid, p_pw text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_row closings%rowtype; v_msg text; v_meas jsonb; v_mv jsonb;
begin
  if not is_super() then raise exception 'Отменить закрытие может только суперадмин'; end if;
  perform pg_advisory_xact_lock(hashtext('closings'));
  select * into v_row from closings where id = p_id;
  if not found then raise exception 'Закрытие не найдено'; end if;
  if exists (select 1 from closings where at_ts > v_row.at_ts) then raise exception 'Отменить можно только последнее закрытие'; end if;
  v_msg := check_my_password(p_pw);
  if v_msg is not null then return jsonb_build_object('ok', false, 'error', v_msg); end if;
  select coalesce(jsonb_agg(jsonb_build_object('chemical_id', chemical_id, 'machine_group', machine_group, 'amount_kg', amount_kg)), '[]'::jsonb)
    into v_meas from closing_measures where closing_id = p_id;
  select coalesce(jsonb_agg(to_jsonb(m)), '[]'::jsonb) into v_mv from chem_moves m where m.closing_id = p_id;
  insert into closing_log(actor, action, closing_id, details)
  values (auth.uid(), 'delete', p_id, jsonb_build_object('row', to_jsonb(v_row), 'measures', v_meas, 'moves', v_mv));
  delete from chem_moves where closing_id = p_id;
  delete from closings where id = p_id;      -- замеры удаляются каскадом
  return jsonb_build_object('ok', true);
end $$;
revoke all on function closing_delete_last(uuid, text) from public;
grant execute on function closing_delete_last(uuid, text) to authenticated;

-- =====================================================================
-- 6) Списание из запаса (только суперадмин, с паролем). Учитывается в отчёте и вычитается из запаса.
--    Списывать больше, чем есть в запасе, нельзя. Количество в кг (литры считаются по плотности из настроек).
-- =====================================================================
create or replace function stock_writeoff(p_chemical bigint, p_amount_kg numeric, p_pw text, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare ch chemicals%rowtype; v_have numeric; v_msg text; v_id uuid;
begin
  if not is_super() then raise exception 'Списывать из запаса может только суперадмин'; end if;
  select * into ch from chemicals where id = p_chemical;
  if not found then raise exception 'Химия не найдена'; end if;
  if coalesce(p_amount_kg, 0) <= 0 or p_amount_kg > 100000 then raise exception 'Укажите количество больше нуля'; end if;
  perform pg_advisory_xact_lock(hashtext('chem_stock:' || p_chemical::text));
  select r.kg into v_have from closing_reserve_at(now() + interval '1 second') r where r.chemical_id = p_chemical;
  if coalesce(v_have, 0) + 1e-9 < p_amount_kg then
    raise exception 'В запасе только % кг', trim_scale(round(coalesce(v_have, 0), 3));
  end if;
  v_msg := check_my_password(p_pw);
  if v_msg is not null then return jsonb_build_object('ok', false, 'error', v_msg); end if;
  insert into chem_moves(chemical_id, machine_group, kind, amount_l, amount_kg)
  values (p_chemical, 'stock', 'writeoff',
          case when ch.bottle_l > 0 and ch.bottle_kg > 0 then p_amount_kg * ch.bottle_l / ch.bottle_kg end, p_amount_kg)
  returning id into v_id;
  insert into closing_log(actor, action, details)
  values (auth.uid(), 'writeoff', jsonb_build_object('chemical_id', p_chemical, 'amount_kg', p_amount_kg, 'note', nullif(trim(p_note), ''), 'move_id', v_id));
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;
revoke all on function stock_writeoff(bigint, numeric, text, text) from public;
grant execute on function stock_writeoff(bigint, numeric, text, text) to authenticated;

-- =====================================================================
-- 7) report_moves: + closing_id (забор остатка при закрытии отличают от обычного «забрал из дозатора»)
-- =====================================================================
drop function if exists report_moves(date, date);
create function report_moves(d1 date, d2 date) returns table(id text, ts timestamptz, shift_date date, chemical_id bigint, machine_group text, kind text, amount_l numeric, amount_kg numeric, created_by uuid, closing_id uuid)
language sql stable security definer set search_path = public as $$
  select m.id::text, m.ts, m.shift_date, m.chemical_id, m.machine_group, m.kind, m.amount_l, m.amount_kg, m.created_by, m.closing_id
  from chem_moves m where can_report() and m.shift_date between d1 and d2 order by m.ts $$;
revoke all on function report_moves(date, date) from public;
grant execute on function report_moves(date, date) to authenticated;

-- =====================================================================
-- 8) Журнал закрытий: новое действие 'writeoff' (списание из запаса). Таблица closing_log уже принимает любой текст в action.
-- =====================================================================

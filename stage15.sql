-- Этап 15: закрытие периода по замерам остатков в дозаторах (кг). ЧЕРНОВИК: на живой базе не запускался, СНАЧАЛА НА КОПИИ.
-- Выполнить в Supabase -> SQL Editor ПОСЛЕ stage14.sql. Можно запускать повторно.
-- Порядок выкладки: сначала этот файл, потом (на следующих этапах) новые html/js. Текущие экраны от этого файла не меняются.
--
-- Что делает файл:
--  1) таблицы closings (закрытия), closing_measures (замеры), closing_log (журнал закрытий);
--  2) функции: закрыть период, сменить эталон, отменить последнее закрытие, пересчитать снимок после правки;
--  3) защита: записи внутри закрытого отрезка (загрузки, замены, подключения, перемещения, уровни) менять нельзя;
--     суперадмин может с паролем, тогда закрытие помечается «нужен пересчёт» и это пишется в журнал.
--
-- Модель. Замер = момент boundary_date 06:00 (settings: shift_start, tz_offset). Закрытие k покрывает полуинтервал
-- [at_ts предыдущего закрытия, at_ts этого). Замеры идут одной цепочкой: без разрывов и без пересечений.
--   start    — начальный замер (точка отсчёта; расчёта периода нет). Он один.
--   interval — «закрыть отчёт за прошедшие смены» (любой день, кроме 1 числа)
--   month    — «закрыть месяц» (1 числа). Замер этого дня = начальный остаток нового месяца.
-- Расчёт расхода (теория, приход, расход, показатели на кг/стирку/жителя) делает клиент (report-calc.js, calcClosing) и
-- сохраняет результат в closings.snapshot. База проверяет права, пароль, цепочку, полноту замеров и защищает записи от правок.

-- =====================================================================
-- 1) Настройки
-- =====================================================================
-- «ведётся на дозаторе»: основная химия закрывается всегда, доп. средство — только если отмечено
alter table chemicals add column if not exists in_closing boolean not null default false;
-- порог предупреждения «расход больше теории», % (меняется на экране «Настройки» на этапе 2)
insert into settings(key, value) values ('close_warn_pct', 25) on conflict (key) do nothing;

-- =====================================================================
-- 2) Таблицы
-- =====================================================================
create table if not exists closings (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null check (kind in ('start','interval','month')),
  boundary_date date not null,                 -- дата смены, с которой начинается замер (замер в 06:00 этого дня)
  at_ts         timestamptz not null,          -- момент замера
  prev_id       uuid references closings(id),  -- предыдущее закрытие (цепочка)
  period_from   timestamptz,                   -- = at_ts предыдущего закрытия; у start пусто
  month_key     text not null,                 -- 'YYYY-MM' месяца, в котором период НАЧАЛСЯ (к нему же относится в отчёте)
  late          boolean not null default false,-- позднее закрытие суперадмином (пропущено 1 число)
  is_etalon     boolean not null default false,
  needs_recalc  boolean not null default false,-- после закрытия суперадмин с паролем поправил запись внутри периода
  snapshot      jsonb,                         -- результат расчёта на момент закрытия (calcClosing)
  note          text,
  closed_by     uuid default auth.uid(),
  closed_at     timestamptz not null default now()
);
create unique index if not exists closings_at_uq    on closings (at_ts);
create unique index if not exists closings_prev_uq  on closings (prev_id) where prev_id is not null;   -- цепочка без развилок
create unique index if not exists closings_one_etalon on closings ((true)) where is_etalon;            -- эталон один
create unique index if not exists closings_one_start  on closings ((true)) where kind = 'start';       -- начальный замер один
create index if not exists closings_month_idx on closings (month_key);

create table if not exists closing_measures (
  id          uuid primary key default gen_random_uuid(),
  closing_id  uuid not null references closings(id) on delete cascade,
  chemical_id int  not null references chemicals(id),
  machine_group text not null check (machine_group in ('1_10','11_12')),   -- 1_10 = дозатор 1 (машины 1–10), 11_12 = дозатор 2
  amount_kg   numeric not null check (amount_kg >= 0 and amount_kg <= 100000),
  unique (closing_id, chemical_id, machine_group)
);
create index if not exists closing_measures_closing_idx on closing_measures (closing_id);

-- журнал закрытий: только дописывается. Отдельно от audit_log, потому что журнал на экране journal.html
-- показывает любую «не загрузку и не замену» как «Остаток подключён» — новые виды записей его бы испортили.
create table if not exists closing_log (
  id         bigserial primary key,
  ts         timestamptz not null default now(),
  actor      uuid,
  action     text not null,         -- create | etalon | delete | recalc | closed_edit
  closing_id uuid,
  details    jsonb
);
create index if not exists closing_log_ts on closing_log (ts desc);

-- Права: читают те, у кого сейчас есть доступ к отчётам. Писать напрямую нельзя никому, только через функции ниже.
alter table closings         enable row level security;
alter table closing_measures enable row level security;
alter table closing_log      enable row level security;
drop policy if exists closings_sel on closings;
create policy closings_sel on closings for select to authenticated using (can_report());
drop policy if exists closing_measures_sel on closing_measures;
create policy closing_measures_sel on closing_measures for select to authenticated using (can_report());
drop policy if exists closing_log_sel on closing_log;
create policy closing_log_sel on closing_log for select to authenticated using (can_report());
revoke insert, update, delete on closings, closing_measures, closing_log from anon, authenticated;

-- =====================================================================
-- 3) Вспомогательные функции
-- =====================================================================
-- момент замера: дата смены + shift_start по местному времени → timestamptz (для tz=5, shift_start=6: 06:00 = 01:00 UTC)
create or replace function closing_boundary_ts(p_date date) returns timestamptz language sql stable as $$
  select ((p_date::timestamp + make_interval(hours => coalesce((select value from settings where key = 'shift_start'), 6)::int
                                                    - coalesce((select value from settings where key = 'tz_offset'), 5)::int)) at time zone 'UTC') $$;

-- дата текущей смены (как shift_date)
create or replace function closing_today() returns date language sql stable as $$
  select ((now() at time zone 'UTC') + make_interval(hours => coalesce((select value from settings where key = 'tz_offset'), 5)::int)
                                     - make_interval(hours => coalesce((select value from settings where key = 'shift_start'), 6)::int))::date $$;

revoke all on function closing_boundary_ts(date) from public;
revoke all on function closing_today() from public;
grant execute on function closing_boundary_ts(date) to authenticated;
grant execute on function closing_today() to authenticated;

-- Проверка пароля теперь ещё и помечает транзакцию «пароль подтверждён» (app.pw_ok). Это нужно защите закрытых периодов:
-- правка записи внутри закрытого отрезка проходит только у суперадмина и только в той же операции, где пароль уже проверен
-- (edit_load, delete_load, edit_chem, delete_chem). Флаг живёт до конца транзакции. Остальное в функции без изменений (stage11.sql).
create or replace function check_my_password(p_pw text) returns text
language plpgsql security definer set search_path = public, extensions, auth as $$
declare h text; fails int;
begin
  if auth.uid() is null then return 'Нужно войти'; end if;
  select count(*) into fails from pw_attempts where user_id = auth.uid() and ts > now() - interval '10 minutes';
  if fails >= 5 then return 'Слишком много неверных паролей. Подождите 10 минут'; end if;
  select encrypted_password into h from auth.users where id = auth.uid();
  if h is null or coalesce(p_pw,'') = '' or h <> crypt(p_pw, h) then
    insert into pw_attempts(user_id) values (auth.uid());
    return 'Неверный пароль';
  end if;
  delete from pw_attempts where user_id = auth.uid();
  perform set_config('app.pw_ok', 'on', true);
  return null;
end $$;
revoke all on function check_my_password(text) from public, anon, authenticated;

-- =====================================================================
-- 4) Закрыть период
--    p_kind:      'start' | 'interval' | 'month'
--    p_boundary:  дата смены, с 06:00 которой сделан замер (не в будущем)
--    p_measures:  [{"chemical_id":1,"machine_group":"1_10","amount_kg":12.5}, ...] — все химикаты × оба дозатора
--    p_snapshot:  результат calcClosing (для start не нужен)
--    p_late:      только суперадмин: закрыть не 1 числа / период через границу месяца (пропущено 1 число)
--    Возвращает {ok:true,id} или {ok:false,error} при неверном пароле. Остальные ошибки — исключениями.
-- =====================================================================
create or replace function closing_create(p_kind text, p_boundary date, p_measures jsonb, p_snapshot jsonb, p_pw text,
                                          p_late boolean default false, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_last closings%rowtype; v_has boolean; v_at timestamptz; v_msg text; v_missing text; v_id uuid;
        v_month text; v_etalon boolean; v_late boolean := coalesce(p_late, false);
begin
  if not is_admin() then raise exception 'Закрывать период могут админы и суперадмин'; end if;
  if p_kind is null or p_kind not in ('start','interval','month') then raise exception 'Неверный вид закрытия'; end if;
  if p_boundary is null then raise exception 'Не указана дата замера'; end if;
  if v_late and not is_super() then raise exception 'Позднее закрытие может сделать только суперадмин'; end if;
  perform pg_advisory_xact_lock(hashtext('closings'));
  if p_boundary > closing_today() then raise exception 'Замер не может быть в будущем'; end if;
  v_at := closing_boundary_ts(p_boundary);

  select * into v_last from closings order by at_ts desc limit 1;
  v_has := found;
  if p_kind = 'start' then
    if v_has then raise exception 'Начальный замер уже есть. Дальше закрывайте месяц или отчёт за прошедшие смены'; end if;
    v_month := to_char(p_boundary, 'YYYY-MM');
  else
    if not v_has then raise exception 'Сначала внесите начальный замер'; end if;
    if v_at <= v_last.at_ts then
      raise exception 'Замер должен быть позже предыдущего (%)', to_char(v_last.boundary_date, 'DD.MM.YYYY');
    end if;
    if p_kind = 'month' and extract(day from p_boundary) <> 1 and not v_late then
      raise exception 'Месяц закрывается 1 числа. Если 1 число пропущено, закрытие делает суперадмин (позднее закрытие)';
    end if;
    if p_kind = 'interval' and extract(day from p_boundary) = 1 then
      raise exception '1 числа закрывается месяц, а не отчёт внутри месяца';
    end if;
    -- период не должен пересекать границу месяца: смены от прошлого замера до дня перед этим замером — один месяц
    if not v_late and to_char(v_last.boundary_date, 'YYYY-MM') <> to_char(p_boundary - 1, 'YYYY-MM') then
      raise exception 'Период пересекает границу месяца: сначала нужно закрыть месяц на 1 число';
    end if;
    v_month := to_char(v_last.boundary_date, 'YYYY-MM');
  end if;

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
  insert into closings(kind, boundary_date, at_ts, prev_id, period_from, month_key, late, is_etalon, snapshot, note)
  values (p_kind, p_boundary, v_at, case when v_has then v_last.id end, case when v_has then v_last.at_ts end,
          v_month, v_late, v_etalon, case when p_kind = 'start' then null else p_snapshot end, nullif(trim(p_note), ''))
  returning id into v_id;
  insert into closing_measures(closing_id, chemical_id, machine_group, amount_kg)
  select v_id, x.chemical_id, x.machine_group, x.amount_kg
  from jsonb_to_recordset(p_measures) as x(chemical_id int, machine_group text, amount_kg numeric);
  insert into closing_log(actor, action, closing_id, details)
  values (auth.uid(), 'create', v_id, jsonb_build_object('kind', p_kind, 'boundary', p_boundary, 'late', v_late, 'etalon', v_etalon, 'measures', p_measures));
  return jsonb_build_object('ok', true, 'id', v_id, 'etalon', v_etalon);
end $$;

-- =====================================================================
-- 5) Сменить эталон (только суперадмин, с паролем)
-- =====================================================================
create or replace function closing_set_etalon(p_id uuid, p_pw text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_row closings%rowtype; v_msg text; v_old uuid;
begin
  if not is_super() then raise exception 'Эталон меняет только суперадмин'; end if;
  select * into v_row from closings where id = p_id;
  if not found then raise exception 'Закрытие не найдено'; end if;
  if v_row.kind = 'start' then raise exception 'Начальный замер не может быть эталоном: у него нет расчёта периода'; end if;
  v_msg := check_my_password(p_pw);
  if v_msg is not null then return jsonb_build_object('ok', false, 'error', v_msg); end if;
  select id into v_old from closings where is_etalon;
  update closings set is_etalon = false where is_etalon and id <> p_id;
  update closings set is_etalon = true where id = p_id;
  insert into closing_log(actor, action, closing_id, details) values (auth.uid(), 'etalon', p_id, jsonb_build_object('was', v_old));
  return jsonb_build_object('ok', true);
end $$;

-- =====================================================================
-- 6) Отменить ПОСЛЕДНЕЕ закрытие (только суперадмин, с паролем; ошибся в замере и т.п.)
--    Старые закрытия не трогаются. Полная запись об отменённом (замеры и расчёт) остаётся в closing_log.
-- =====================================================================
create or replace function closing_delete_last(p_id uuid, p_pw text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_row closings%rowtype; v_msg text; v_meas jsonb;
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
  insert into closing_log(actor, action, closing_id, details)
  values (auth.uid(), 'delete', p_id, jsonb_build_object('row', to_jsonb(v_row), 'measures', v_meas));
  delete from closings where id = p_id;      -- замеры удаляются каскадом
  return jsonb_build_object('ok', true);
end $$;

-- =====================================================================
-- 7) Обновить расчёт закрытия после правки записи внутри периода (суперадмин, с паролем)
-- =====================================================================
create or replace function closing_recalc(p_id uuid, p_snapshot jsonb, p_pw text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_row closings%rowtype; v_msg text;
begin
  if not is_super() then raise exception 'Пересчитать закрытие может только суперадмин'; end if;
  select * into v_row from closings where id = p_id;
  if not found then raise exception 'Закрытие не найдено'; end if;
  if v_row.kind = 'start' then raise exception 'У начального замера нет расчёта'; end if;
  if p_snapshot is null or jsonb_typeof(p_snapshot) <> 'object' then raise exception 'Нет расчёта периода'; end if;
  v_msg := check_my_password(p_pw);
  if v_msg is not null then return jsonb_build_object('ok', false, 'error', v_msg); end if;
  insert into closing_log(actor, action, closing_id, details) values (auth.uid(), 'recalc', p_id, jsonb_build_object('old_snapshot', v_row.snapshot));
  update closings set snapshot = p_snapshot, needs_recalc = false where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function closing_create(text, date, jsonb, jsonb, text, boolean, text) from public;
revoke all on function closing_set_etalon(uuid, text) from public;
revoke all on function closing_delete_last(uuid, text) from public;
revoke all on function closing_recalc(uuid, jsonb, text) from public;
grant execute on function closing_create(text, date, jsonb, jsonb, text, boolean, text) to authenticated;
grant execute on function closing_set_etalon(uuid, text) to authenticated;
grant execute on function closing_delete_last(uuid, text) to authenticated;
grant execute on function closing_recalc(uuid, jsonb, text) to authenticated;

-- =====================================================================
-- 8) Защита закрытых периодов
--    Запись, чьё время попало внутрь закрытого отрезка [первый замер, последний замер), нельзя добавить, изменить или удалить.
--    Исключение: суперадмин в операции, где только что проверен пароль (edit_load, delete_load, edit_chem, delete_chem).
--    Тогда закрытие получает пометку needs_recalc, а запись о правке остаётся в closing_log и (как раньше) в audit_log.
--    Записи ДО начального замера никого не касаются. Не считаются правкой служебные поля: «Постиралось», подключение
--    остатка к замене, списание остатка (они не меняют ни время, ни количества).
--    Проживающие (resident_counts) намеренно не блокируются: расчёт закрытия хранит их в снимке.
-- =====================================================================
create or replace function guard_closed() returns trigger language plpgsql security definer set search_path = public as $$
declare v_first timestamptz; v_last timestamptz; v_col text := coalesce(tg_argv[0], 'ts');
        v_skip text[] := string_to_array(coalesce(tg_argv[1], ''), ',');
        t_old timestamptz; t_new timestamptz; v_date date; v_row jsonb;
begin
  select min(at_ts), max(at_ts) into v_first, v_last from closings;
  if v_last is null then return coalesce(new, old); end if;
  if tg_op = 'UPDATE' and (to_jsonb(old) - v_skip) is not distinct from (to_jsonb(new) - v_skip) then return new; end if;
  if tg_op in ('UPDATE', 'DELETE') then t_old := (to_jsonb(old) ->> v_col)::timestamptz; end if;
  if tg_op in ('INSERT', 'UPDATE') then t_new := (to_jsonb(new) ->> v_col)::timestamptz; end if;
  if not ((t_old is not null and t_old >= v_first and t_old < v_last) or (t_new is not null and t_new >= v_first and t_new < v_last)) then
    return coalesce(new, old);
  end if;
  if is_super() and coalesce(current_setting('app.pw_ok', true), '') = 'on' then
    v_row := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
    update closings set needs_recalc = true
    where period_from is not null and not needs_recalc
      and ((t_old >= period_from and t_old < at_ts) or (t_new >= period_from and t_new < at_ts));
    insert into closing_log(actor, action, details)
    values (auth.uid(), 'closed_edit', jsonb_build_object('table', tg_table_name, 'op', tg_op, 'row_id', v_row ->> 'id', 'ts_old', t_old, 'ts_new', t_new));
    return coalesce(new, old);
  end if;
  select boundary_date into v_date from closings order by at_ts desc limit 1;
  raise exception 'Период закрыт замером от %. Записи за него менять нельзя; правку может сделать только суперадмин с паролем', to_char(v_date, 'DD.MM.YYYY');
end $$;
revoke all on function guard_closed() from public;

drop trigger if exists t_closed_guard on loads;
create trigger t_closed_guard before insert or update or delete on loads
  for each row execute function guard_closed('ts', 'finished_at,edited_at,edited_by');
drop trigger if exists t_closed_guard on chem_changes;
create trigger t_closed_guard before insert or update or delete on chem_changes
  for each row execute function guard_closed('ts', 'connect_id,written_off_at,written_off_by,edited_at,edited_by');
drop trigger if exists t_closed_guard on chem_connects;
create trigger t_closed_guard before insert or update or delete on chem_connects
  for each row execute function guard_closed('ts', '');
do $$ begin
  if to_regclass('public.chem_moves') is not null then
    execute 'drop trigger if exists t_closed_guard on chem_moves';
    execute 'create trigger t_closed_guard before insert or update or delete on chem_moves for each row execute function guard_closed(''ts'', '''')';
  end if;
  if to_regclass('public.chem_levels') is not null then
    execute 'drop trigger if exists t_closed_guard on chem_levels';
    execute 'create trigger t_closed_guard before insert or update or delete on chem_levels for each row execute function guard_closed(''at_ts'', '''')';
  end if;
end $$;

-- Проверка stage15.sql. ЗАПУСКАТЬ ТОЛЬКО НА КОПИИ БАЗЫ, после stage15.sql. В конце всё откатывается (rollback), данные не остаются.
-- Supabase -> SQL Editor: вставить файл целиком и выполнить. Если всё хорошо, в конце появится уведомление «ВСЕ ПРОВЕРКИ ПРОШЛИ».
-- При ошибке скрипт останавливается на первом провале и пишет, какая проверка не прошла.
-- Нужен суперадмин в profiles. Его пароль на время скрипта подменяется на test1234 (после rollback возвращается прежний).
-- Все даты проверок в 2020 году, поэтому настоящие записи (2026) защита закрытых периодов не затрагивает.

begin;

select set_config('request.jwt.claim.sub', (select id::text from profiles where role = 'superadmin'), true);
select set_config('request.jwt.claims', json_build_object('sub', (select id::text from profiles where role = 'superadmin'))::text, true);
update auth.users set encrypted_password = extensions.crypt('test1234', extensions.gen_salt('bf'))
where id = (select id from profiles where role = 'superadmin');

-- замеры по всем нужным химикатам и обоим дозаторам, по p_kg кг
create function pg_temp.meas(p_kg numeric) returns jsonb language sql as $$
  select coalesce(jsonb_agg(jsonb_build_object('chemical_id', c.id, 'machine_group', g.grp, 'amount_kg', p_kg)), '[]'::jsonb)
  from chemicals c cross join (values ('1_10'), ('11_12')) as g(grp) where c.kind = 'main' or c.in_closing $$;
-- ждём ошибку, в тексте которой есть p_frag
create function pg_temp.expect_err(p_sql text, p_frag text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'ОЖИДАЛАСЬ ОШИБКА «%», но её не было', p_frag;
exception when others then
  if sqlerrm like 'ОЖИДАЛАСЬ ОШИБКА%' or position(p_frag in sqlerrm) = 0 then
    raise exception 'Ожидали ошибку «%», получили: %', p_frag, sqlerrm;
  end if;
end $$;
create function pg_temp.expect_true(p_cond boolean, p_what text) returns void language plpgsql as $$
begin if p_cond is distinct from true then raise exception 'НЕ ПРОШЛО: %', p_what; end if; end $$;

do $$
declare r jsonb; v_jan uuid; v_feb uuid; v_form uuid := (select id from forms where type = 'laundry_load' limit 1);
        v_wash int := (select id from wash_types order by id limit 1);
begin
  if v_form is null or v_wash is null then raise exception 'В базе нет бланка загрузки или вида стирки: проверку не провести'; end if;

  -- цепочка закрытий
  r := closing_create('start', '2020-01-10', pg_temp.meas(50), null, 'test1234');
  perform pg_temp.expect_true((r ->> 'ok')::boolean, '1. начальный замер принят');
  perform pg_temp.expect_err($q$select closing_create('start', '2020-01-12', pg_temp.meas(50), null, 'test1234')$q$, 'Начальный замер уже есть');
  perform pg_temp.expect_err($q$select closing_create('interval', '2020-01-20', pg_temp.meas(40) - 0, '{"rows":[]}', 'test1234')$q$, 'Нет замера');
  r := closing_create('interval', '2020-01-20', pg_temp.meas(40), '{"rows":[]}', 'wrong');
  perform pg_temp.expect_true((r ->> 'ok')::boolean = false and r ->> 'error' = 'Неверный пароль', '4. неверный пароль не закрывает период');
  perform pg_temp.expect_true(not exists (select 1 from closings where boundary_date = '2020-01-20'), '4b. после неверного пароля закрытия нет');
  r := closing_create('interval', '2020-01-20', pg_temp.meas(40), '{"rows":[]}', 'test1234');
  perform pg_temp.expect_true((r ->> 'ok')::boolean, '5. закрытие внутри месяца принято');
  v_jan := (r ->> 'id')::uuid;
  perform pg_temp.expect_true((select is_etalon from closings where id = v_jan), '5b. первое закрытие с расчётом стало эталоном');
  perform pg_temp.expect_err($q$select closing_create('interval', '2020-01-15', pg_temp.meas(40), '{"rows":[]}', 'test1234')$q$, 'позже предыдущего');
  perform pg_temp.expect_err($q$select closing_create('interval', '2020-02-01', pg_temp.meas(30), '{"rows":[]}', 'test1234')$q$, 'закрывается месяц');
  perform pg_temp.expect_err($q$select closing_create('month', '2020-01-25', pg_temp.meas(30), '{"rows":[]}', 'test1234')$q$, 'Месяц закрывается 1 числа');
  r := closing_create('month', '2020-02-01', pg_temp.meas(30), '{"rows":[]}', 'test1234');
  perform pg_temp.expect_true((r ->> 'ok')::boolean, '9. закрытие месяца принято');
  v_feb := (r ->> 'id')::uuid;
  perform pg_temp.expect_true(not (select is_etalon from closings where id = v_feb), '9b. эталон остался у первого');
  perform pg_temp.expect_true((select prev_id from closings where id = v_feb) = v_jan and (select period_from from closings where id = v_feb) = (select at_ts from closings where id = v_jan), '9c. замеры стыкуются: начало = конец предыдущего');
  perform pg_temp.expect_true((select month_key from closings where id = v_feb) = '2020-01', '9d. период 1 января–31 января относится к январю');
  perform pg_temp.expect_err($q$select closing_create('interval', '2020-03-10', pg_temp.meas(20), '{"rows":[]}', 'test1234')$q$, 'пересекает границу месяца');
  r := closing_create('interval', '2020-03-10', pg_temp.meas(20), '{"rows":[]}', 'test1234', true);
  perform pg_temp.expect_true((r ->> 'ok')::boolean and (select late from closings where id = (r ->> 'id')::uuid), '11. суперадмин может закрыть позже (пропущено 1 число)');
  perform closing_delete_last((r ->> 'id')::uuid, 'test1234');
  perform pg_temp.expect_true(not exists (select 1 from closings where boundary_date = '2020-03-10'), '11b. последнее закрытие отменено');

  -- эталон
  r := closing_set_etalon(v_feb, 'test1234');
  perform pg_temp.expect_true((r ->> 'ok')::boolean and (select is_etalon from closings where id = v_feb) and not (select is_etalon from closings where id = v_jan), '12. эталон переключён');
  perform closing_set_etalon(v_jan, 'test1234');

  -- защита закрытых периодов (в продакшене каждая операция — отдельная транзакция, здесь флаг пароля сбрасываем вручную)
  perform set_config('app.pw_ok', 'off', true);
  perform pg_temp.expect_err(format($q$insert into loads(form_id, ts, machine, wash_type_id, weight_kg) values (%L, '2020-01-12 12:00+00', 1, %s, 25)$q$, v_form, v_wash), 'Период закрыт');
  insert into loads(form_id, ts, machine, wash_type_id, weight_kg) values (v_form, '2019-12-01 12:00+00', 1, v_wash, 25);   -- до начального замера: можно
  insert into loads(form_id, ts, machine, wash_type_id, weight_kg) values (v_form, now(), 1, v_wash, 25);                    -- после последнего замера: можно
  perform pg_temp.expect_true(not (select needs_recalc from closings where id = v_jan), '13. обычные записи вне закрытых отрезков не трогают закрытие');
  -- суперадмин с проверенным паролем: можно, закрытие помечается, пишется журнал
  perform set_config('app.pw_ok', 'on', true);
  insert into loads(form_id, ts, machine, wash_type_id, weight_kg) values (v_form, '2020-01-12 12:00+00', 1, v_wash, 25);
  perform pg_temp.expect_true((select needs_recalc from closings where id = v_jan), '14. правка суперадмина с паролем пометила закрытие «нужен пересчёт»');
  perform pg_temp.expect_true(exists (select 1 from closing_log where action = 'closed_edit'), '14b. правка записана в closing_log');
  perform pg_temp.expect_true(not (select needs_recalc from closings where id = v_feb), '14c. соседнее закрытие не помечено');
  r := closing_recalc(v_jan, '{"rows":[],"v":2}', 'test1234');
  perform pg_temp.expect_true((r ->> 'ok')::boolean and not (select needs_recalc from closings where id = v_jan), '15. пересчёт снимает пометку');

  -- «Постиралось» и подключение остатка закрытый период не блокируют (служебные поля)
  perform set_config('app.pw_ok', 'off', true);
  update loads set finished_at = now() where ts = '2020-01-12 12:00+00' and form_id = v_form;
  raise notice 'ВСЕ ПРОВЕРКИ ПРОШЛИ';
end $$;

rollback;

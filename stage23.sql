-- Этап 23: исправление дозатора у уже записанного подключения («Перелить в дозатор»).
-- Выполнить в Supabase (SQL Editor) ПОСЛЕ stage22.sql. Можно запускать повторно.
-- СНАЧАЛА НА КОПИИ БАЗЫ.
--
-- Зачем. Раньше окно подключения само ставило дозатор-источник последнего остатка. Если сотрудник просто нажимал
-- «Подтвердить», запись уходила в источник, а не туда, куда налили: получатель терял плюс (давал отрицательный факт),
-- а источник получал лишний плюс. Окно теперь без выбора по умолчанию (leftover.js), а уже сделанные записи исправляет
-- эта функция.
--
-- Что делает файл: добавляет ТОЛЬКО функцию connect_set_group(p_id, p_group, p_pw) и права на неё.
-- Таблицы (в том числе chem_connects), другие функции и триггеры не меняются, прежние данные не пересчитываются.
--
-- connect_set_group (только суперадмин, с паролем, как closing_set_etalon / closing_recalc):
--   * меняет machine_group у одной записи chem_connects (количество, время и остальное не трогает);
--   * пароль проверяется через check_my_password; она же ставит пометку app.pw_ok, с которой защита закрытых периодов
--     (t_closed_guard → guard_closed, stage15) пропускает правку суперадмина. Защита НЕ обходится и не отключается:
--     если запись внутри закрытого периода, закрытие получает needs_recalc, а в closing_log пишется closed_edit.
--     Дальше суперадмин нажимает «Пересчитать» в closings-report.html (closing_recalc);
--   * журнал: audit_log (update, старая и новая запись целиком: триггер t_conn_audit, stage9) и closing_log
--     (action = 'connect_set_group': старый и новый дозатор, химия, количество, время подключения);
--   * без пароля, с неверным паролем, не суперадмином, с неизвестным дозатором или записью ничего не меняется.
-- Возвращает jsonb: { ok, old_group, new_group, closed_period } или { ok:false, error } при неверном пароле.

create or replace function connect_set_group(p_id uuid, p_group text, p_pw text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare k chem_connects%rowtype; v_msg text; v_closed boolean;
begin
  if not is_super() then raise exception 'Исправить дозатор у подключения может только суперадмин'; end if;
  if p_group is null or p_group not in ('1_10','11_12') then raise exception 'Выберите дозатор'; end if;
  select * into k from chem_connects where id = p_id;
  if not found then raise exception 'Подключение не найдено'; end if;
  perform pg_advisory_xact_lock(hashtext('connect_leftovers:' || k.chemical_id::text));   -- тот же замок, что у «Перелить в дозатор»
  select * into k from chem_connects where id = p_id for update;                          -- перечитали уже под замком
  if not found then raise exception 'Подключение не найдено'; end if;
  if k.machine_group = p_group then raise exception 'Эта запись уже записана в этот дозатор'; end if;

  v_msg := check_my_password(p_pw);                       -- до правки: она же ставит app.pw_ok для защиты закрытых периодов
  if v_msg is not null then return jsonb_build_object('ok', false, 'error', v_msg); end if;

  v_closed := exists (select 1 from closings c where c.period_from is not null and k.ts >= c.period_from and k.ts < c.at_ts);

  update chem_connects set machine_group = p_group where id = p_id;   -- t_closed_guard сам пометит закрытие needs_recalc, если нужно

  insert into closing_log(actor, action, closing_id, details)
  values (auth.uid(), 'connect_set_group', null,
          jsonb_build_object('connect_id', p_id, 'chemical_id', k.chemical_id, 'old_group', k.machine_group, 'new_group', p_group,
                             'amount_kg', k.amount_kg, 'amount_l', k.amount_l, 'connect_ts', k.ts, 'closed_period', v_closed));
  return jsonb_build_object('ok', true, 'old_group', k.machine_group, 'new_group', p_group, 'closed_period', v_closed);
end $$;
revoke all on function connect_set_group(uuid, text, text) from public;
grant execute on function connect_set_group(uuid, text, text) to authenticated;

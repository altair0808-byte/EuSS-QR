-- stage18.sql — ЧЕРНОВИК: на живой базе не запускался, СНАЧАЛА НА КОПИИ.
-- Выполнить в Supabase -> SQL Editor ПОСЛЕ stage17.sql. Можно запускать повторно.
--
-- Этап 1 «Закрытие отчётов». Что делает файл:
--  После закрытия данные отчёта зафиксированы и сами не пересчитываются. Снимок (closings.snapshot) лежит в базе и менять его напрямую
--  нельзя (прямой записи в таблицу нет). Единственный путь — «пересчитать закрытие», и он теперь разрешён только тогда, когда
--  суперадмин с паролем поправил запись внутри закрытого периода (закрытие помечено needs_recalc). Просто «обновить цифры» нельзя.
--  Остальное (закрытие в любую минуту, закрытие месяца до первой стирки нового месяца, защита записей закрытого периода) уже в stage15–17.

create or replace function closing_recalc(p_id uuid, p_snapshot jsonb, p_pw text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_row closings%rowtype; v_msg text;
begin
  if not is_super() then raise exception 'Пересчитать закрытие может только суперадмин'; end if;
  select * into v_row from closings where id = p_id;
  if not found then raise exception 'Закрытие не найдено'; end if;
  if v_row.kind = 'start' then raise exception 'У начального замера нет расчёта'; end if;
  if not v_row.needs_recalc then
    raise exception 'Закрытие зафиксировано: данные отчёта не пересчитываются. Пересчёт возможен только после правки записи внутри периода (суперадмином, с паролем)';
  end if;
  if p_snapshot is null or jsonb_typeof(p_snapshot) <> 'object' then raise exception 'Нет расчёта периода'; end if;
  v_msg := check_my_password(p_pw);
  if v_msg is not null then return jsonb_build_object('ok', false, 'error', v_msg); end if;
  insert into closing_log(actor, action, closing_id, details) values (auth.uid(), 'recalc', p_id, jsonb_build_object('old_snapshot', v_row.snapshot));
  update closings set snapshot = p_snapshot, needs_recalc = false where id = p_id;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function closing_recalc(uuid, jsonb, text) from public;
grant execute on function closing_recalc(uuid, jsonb, text) to authenticated;

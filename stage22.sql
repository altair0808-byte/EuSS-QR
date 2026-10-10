-- Этап 22: единое правило подключения остатка бутыли и пересчёт прежних закрытий.
-- Выполнить в Supabase (SQL Editor) ПОСЛЕ stage21.sql. Можно запускать повторно.
-- СНАЧАЛА НА КОПИИ БАЗЫ.
--
-- Правило (одно для всех записей, старых и новых): подключённый остаток только ДОБАВЛЯЕТСЯ к содержимому дозатора
-- и новую бутыль не заменяет. Строка «бутыль, вместо которой подключили остаток» в балансе всегда 0.
--   приход нетто = новые бутыли − остатки замен + подключённые остатки + залито из запаса + добавлено суперадмином
--                  − забрано из дозатора ± поправка по уровню
-- Признака «вместо бутыли» в таблице подключений НЕТ и не нужен: chem_connects не меняется.
--
-- Что делает файл:
--  1) Копирует текущие снимки закрытий в closings_backup_stage22 (один раз, повторный запуск ничего не затирает).
--  2) Помечает все закрытия с расчётом как «нужен пересчёт» (needs_recalc). Дальше суперадмин на странице отчёта по закрытиям
--     нажимает «Пересчитать все закрытия по новому правилу»: сайт пересчитает каждое закрытие в браузере (calcClosing),
--     покажет «было → стало» и сохранит с паролем через существующую closing_recalc. Старый снимок при этом ещё и пишется в closing_log.
--  3) Даёт функцию отката closings_restore_stage22() — вернуть снимки как были до пересчёта.
-- Замеры (closing_measures), записи химии, запас и журнал не меняются.

create table if not exists closings_backup_stage22 (
  closing_id uuid primary key,
  snapshot   jsonb,
  needs_recalc boolean,
  saved_at   timestamptz not null default now()
);
alter table closings_backup_stage22 enable row level security;      -- напрямую не читается и не пишется

insert into closings_backup_stage22 (closing_id, snapshot, needs_recalc)
select c.id, c.snapshot, c.needs_recalc
from closings c
where c.kind <> 'start' and c.snapshot is not null
on conflict (closing_id) do nothing;

update closings set needs_recalc = true
where kind <> 'start' and snapshot is not null and not needs_recalc;

insert into closing_log(actor, action, closing_id, details)
select null, 'mark_recalc_stage22', c.id, jsonb_build_object('reason', 'новое правило подключения остатка (stage22)')
from closings c
where c.kind <> 'start' and c.snapshot is not null
  and not exists (select 1 from closing_log l where l.closing_id = c.id and l.action = 'mark_recalc_stage22');

-- Откат: вернуть снимки закрытий, какими они были до stage22 (только суперадмин). Возвращает число восстановленных закрытий.
create or replace function closings_restore_stage22() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not is_super() then raise exception 'Откатить пересчёт может только суперадмин'; end if;
  update closings c set snapshot = b.snapshot, needs_recalc = coalesce(b.needs_recalc, false)
  from closings_backup_stage22 b where b.closing_id = c.id;
  get diagnostics n = row_count;
  insert into closing_log(actor, action, closing_id, details)
  values (auth.uid(), 'restore_stage22', null, jsonb_build_object('restored', n));
  return n;
end $$;
revoke all on function closings_restore_stage22() from public;
grant execute on function closings_restore_stage22() to authenticated;

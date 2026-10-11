-- Этап 24: скрытие вида стирки и три этапа стирки (заполнение, стирка, сушка).
-- Выполнить в Supabase (SQL Editor) ПОСЛЕ stage23.sql. Можно запускать повторно.
-- СНАЧАЛА НА КОПИИ БАЗЫ.
--
-- Что делает файл: добавляет в wash_types четыре колонки. Ничего не удаляет и не пересчитывает.
--   hidden    - вид стирки скрыт из выбора при загрузке белья (старые записи, отчёты и статистика его по-прежнему видят);
--   fill_min  - минут на заполнение водой;
--   wash_min  - минут на саму стирку (мытьё);
--   dry_min   - минут на сушку.
-- Колонка minutes остаётся ОБЩИМ временем и равна fill_min + wash_min + dry_min: на ней держатся бланк, отчёты, Blanc.xlsx
-- и расчёт «осталось минут», поэтому они продолжают работать без изменений.
-- У существующих видов: заполнение 0, сушка 0, стирка = прежние minutes (общее время не меняется).

alter table wash_types add column if not exists hidden   boolean not null default false;
alter table wash_types add column if not exists fill_min int check (fill_min is null or fill_min >= 0);
alter table wash_types add column if not exists wash_min int check (wash_min is null or wash_min >= 0);
alter table wash_types add column if not exists dry_min  int check (dry_min  is null or dry_min  >= 0);

update wash_types
   set fill_min = coalesce(fill_min, 0),
       wash_min = coalesce(wash_min, minutes, 0),
       dry_min  = coalesce(dry_min, 0)
 where fill_min is null or wash_min is null or dry_min is null;

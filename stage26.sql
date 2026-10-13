-- Этап 26 (ЧЕРНОВИК, сначала на копии базы): режим стирки «Порошок» с авто-набором доп химии.
-- Выполнить в Supabase (SQL Editor) ПОСЛЕ stage24.sql. Можно запускать повторно, ничего не удаляет и не пересчитывает.
--
-- Что делает:
--   1. wash_types.auto_extras - набор доп химии по умолчанию для режима: {"<id химиката>": штук}.
--      Когда режим выбирают на главном экране или в бланке, числа подставляются сами, остальная доп химия = 0.
--      Пустой набор {} - режим ничего не подставляет (так у всех старых режимов).
--   2. wash_types.color и wash_types.icon - цвет и значок режима (если их ещё нет; настройки их уже умеют).
--   3. Создаёт режим «Порошок» (если такого нет): основная химия по рецепту = 0 мл/л для всех дозаторных химикатов.
--      Время по умолчанию 45 мин (одна стирка, без заполнения и сушки). Поменяйте в «Настройках» под реальное.
--   4. Прописывает ему авто-набор: 1 порошок и 2 Ленора (Ваниш = 0). Химикаты ищутся по названию: «порош…» и «ленор…».
--      Если у режима набор уже задан, он не перезаписывается.

alter table wash_types add column if not exists auto_extras jsonb not null default '{}'::jsonb;
alter table wash_types add column if not exists color text;
alter table wash_types add column if not exists icon  text;

do $$
declare v_id int; v_p int; v_l int;
begin
  select id into v_id from wash_types where lower(name) = 'порошок' limit 1;
  if v_id is null then
    insert into wash_types(name, minutes, sort, fill_min, wash_min, dry_min)
    values ('Порошок', 45, (select coalesce(max(sort), 0) + 1 from wash_types), 0, 45, 0)
    returning id into v_id;
  end if;

  -- основная химия по рецепту: везде 0 (уже заданные значения не трогаем)
  insert into recipes(wash_type_id, chemical_id, ml_per_l)
  select v_id, c.id, 0 from chemicals c where c.kind = 'main'
  on conflict (wash_type_id, chemical_id) do nothing;

  select id into v_p from chemicals where kind = 'extra' and lower(name) like '%порош%' order by sort limit 1;
  select id into v_l from chemicals where kind = 'extra' and lower(name) like 'ленор%'  order by sort limit 1;
  if v_p is null or v_l is null then
    raise notice 'Не нашёл доп химикат Порошок или Ленор: авто-набор не задан. Задайте его в Настройках, режим Порошок.';
  else
    update wash_types set auto_extras = jsonb_build_object(v_p::text, 1, v_l::text, 2)
     where id = v_id and auto_extras = '{}'::jsonb;
  end if;
end $$;

-- проверка
select w.id, w.name, w.minutes, w.auto_extras from wash_types w where lower(w.name) = 'порошок';

-- Вход по личному QR-коду (бейджу). Выполнить в Supabase -> SQL Editor.
-- В QR записан случайный код (не логин и не пароль). Код привязан к сотруднику, потерянный бейдж отзывается удалением строки.
create table if not exists badges(
  user_id      uuid primary key references auth.users on delete cascade,
  code         text unique not null check (length(code) between 20 and 64),
  created_at   timestamptz not null default now(),
  last_used_at timestamptz
);
alter table badges enable row level security;
drop policy if exists bg_all on badges;
-- читать и менять коды может только суперадмин (функция badge-login работает с сервисным ключом и RLS обходит)
create policy bg_all on badges for all to authenticated using (is_super()) with check (is_super());

-- Запустить в SQL Editor ПОСЛЕ supabase.sql.
-- Суперадмин может быть только один:
create unique index if not exists one_superadmin on profiles(role) where role = 'superadmin';

-- Список сотрудников для страницы «Пользователи»:
create table if not exists people(
  id uuid primary key references auth.users on delete cascade,
  email text not null, full_name text, created_at timestamptz default now());
alter table people enable row level security;
create policy pe_sel on people for select to authenticated using (is_super());
insert into people(id, email) select id, email from auth.users on conflict do nothing;

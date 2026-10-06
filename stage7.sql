-- Этап 7: имена сотрудников в журнале и отчётах, вход по логину.
-- Выполнить в Supabase -> SQL Editor после stage6.sql. Можно запускать повторно.

-- Раньше имя бралось только из метаданных входа, а «Фамилия Имя» из страницы «Пользователи»
-- хранится в таблице people. Из-за этого в журнале и в «внёс: …» показывался логин вместо имени.
-- Теперь сначала берётся имя из people, затем из метаданных, затем логин (часть до «@»).
create or replace function staff_names() returns table(id uuid, name text)
language sql stable security definer set search_path = public as $$
  select u.id,
         coalesce(nullif(trim(p.full_name),''), nullif(u.raw_user_meta_data->>'full_name',''),
                  nullif(u.raw_user_meta_data->>'name',''), split_part(u.email,'@',1))::text
  from auth.users u left join people p on p.id = u.id
  where can_report() or is_super() or u.id = auth.uid() $$;
revoke all on function staff_names() from public;
grant execute on function staff_names() to authenticated;

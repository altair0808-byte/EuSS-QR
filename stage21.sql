-- Этап 21: сотрудники и бригадиры только вносят данные, отчёты смотрят админы и суперадмин.
-- Выполнить в Supabase (SQL Editor) после stage20.sql. Можно запускать повторно.
--
-- Раньше can_report() пускала бригадиров (foreman). Через неё закрыты: отчёт по сменам, бланк за смену, журнал,
-- выгрузки report_loads / report_changes / report_connects / report_levels / report_moves, чтение chem_moves и audit_log.
-- Теперь функция пускает только суперадмина и админов, поэтому всё перечисленное закрывается сразу и на уровне базы,
-- а не только скрытием кнопок на сайте.
create or replace function can_report() returns boolean
language sql stable security definer set search_path = public as
$$ select is_super() or exists (
     select 1 from form_access where user_id = auth.uid() and role = 'admin') $$;
revoke all on function can_report() from public;
grant execute on function can_report() to authenticated;

-- Имена сотрудников («внёс: …») нужны бригадирам на экране химии, поэтому оставляем их тем, кто работает с химией.
create or replace function staff_names() returns table(id uuid, name text)
language sql stable security definer set search_path = public as $$
  select u.id,
         coalesce(nullif(trim(p.full_name),''), nullif(u.raw_user_meta_data->>'full_name',''),
                  nullif(u.raw_user_meta_data->>'name',''), split_part(u.email,'@',1))::text
  from auth.users u left join people p on p.id = u.id
  where can_report() or is_super() or can_fill_chem() or u.id = auth.uid() $$;
revoke all on function staff_names() from public;
grant execute on function staff_names() to authenticated;

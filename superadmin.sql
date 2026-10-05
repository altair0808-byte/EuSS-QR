-- Выполнить один раз в Supabase -> SQL Editor после создания аккаунта (Authentication -> Users -> Add user).
-- Замените почту на свою.
insert into profiles(id, role)
select id, 'superadmin' from auth.users where email = 'ВАША_ПОЧТА'
on conflict (id) do update set role = 'superadmin';

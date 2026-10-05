# Прачечная: QR-формы

Файлы лежат в корне: `index.html`, `form.html`, `qr.html`, `app.js`, `config.js`, `style.css`, `supabase.sql`.
Дашборды, итоги и Excel подключаются следующим этапом.

## Запуск
1. **Supabase**: создайте проект, откройте SQL Editor, вставьте `supabase.sql`, нажмите Run.
2. **Ключи**: Project Settings, API. Впишите Project URL и anon key в `config.js`.
3. **Пользователи**: Authentication, Users, Add user (почта и пароль, отметьте Auto Confirm).
   Затем Authentication, Sign In / Providers: выключите Allow new users to sign up.
4. **Суперадмин** (один): создайте его в Authentication, Users, затем в SQL Editor выполните `users.sql`, потом:
```sql
insert into profiles(id, role) select id, 'superadmin' from auth.users where email = 'you@mail.com';
insert into people(id, email) select id, email from auth.users where email = 'you@mail.com' on conflict do nothing;
```
   Остальных сотрудников суперадмин создаёт сам на странице **Пользователи** (карточка на главной). Для этого один раз разверните функцию: Supabase, Edge Functions, Create function, имя `admin-users`, вставьте код из `admin-users.ts`, Deploy.
5. **Роли через SQL** (необязательно, если пользуетесь страницей «Пользователи»):
```sql
-- суперадмин
insert into profiles(id, role) select id, 'superadmin' from auth.users where email = 'you@mail.com';
-- сотрудник прачечной (загрузки)
insert into form_access select id, (select id from forms where slug='laundry-load'), 'worker' from auth.users where email = 'worker@mail.com';
-- бригадир (замена химии)
insert into form_access select id, (select id from forms where slug='laundry-chem'), 'foreman' from auth.users where email = 'foreman@mail.com';
-- админ бланка
insert into form_access select id, (select id from forms where slug='laundry-load'), 'admin' from auth.users where email = 'admin@mail.com';
```
6. **Объёмы бутылей** (литры): `update chemicals set bottle_l = 20 where name = 'ALKALINE';`
7. **Часовой пояс**: `update settings set value = 5 where key = 'tz_offset';` (часы от UTC).
8. **GitHub и Render**: загрузите файлы в репозиторий, на Render создайте Static Site, Build Command пустой, Publish Directory `.`
9. **QR**: войдите как суперадмин, на главной нажмите QR у бланка и распечатайте.

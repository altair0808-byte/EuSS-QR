# Прачечная: QR-формы

Файлы лежат в корне: `index.html`, `form.html`, `qr.html`, `app.js`, `config.js`, `style.css`, `supabase.sql`, `users.sql`, `admin.html`, `settings.html`, `admin-users.ts`.
Этап 1: отчёт по сменам со счётом стирок и теоретическим расходом химии. Этап 2: факт расхода, сравнение с теорией, остаток в кг. Дальше: ввод и правка админом, Excel в формате бланка.

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
6. **Настройки**: объёмы бутылей, часовой пояс, начало смены, виды стирки с рецептами и бланки суперадмин меняет на странице **Настройки** (карточка на главной). Через SQL это делать не нужно.
7. **Суперадмин** на странице **Пользователи** может менять имя и пароль себе и сотрудникам. Для смены имён выполните обновлённый `users.sql` (добавлена политика `pe_upd`) и заново разверните `admin-users.ts`.
8. **GitHub и Render**: загрузите файлы в репозиторий, на Render создайте Static Site, Build Command пустой, Publish Directory `.`
9. **QR**: войдите как суперадмин, на главной нажмите QR у бланка и распечатайте.

10. **Отчёт по сменам (этап 1)**: в SQL Editor выполните `report.sql` (после `supabase.sql` и `users.sql`). Страница `report.html` доступна бригадиру, админу и суперадмину, карточка «Отчёт по сменам» появляется на главной.

11. **Факт расхода (этап 2)**: выполните `stage2.sql` (после `report.sql`). Затем в **Настройках** для каждой химии задайте «1 шт = литров = кг». Бригадир вводит остаток в кг, в отчёте появляются теория, факт и разница.

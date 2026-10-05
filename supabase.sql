-- Прачечная: схема. Выполнить целиком в Supabase -> SQL Editor.

create table settings(key text primary key, value numeric not null);
insert into settings values ('water_l',55),('tz_offset',5),('shift_start',6);

create table profiles(id uuid primary key references auth.users on delete cascade,
  role text not null default 'user' check (role in ('user','superadmin')));
create table forms(id uuid primary key default gen_random_uuid(), slug text unique not null,
  name text not null, type text not null, icon text, sort_order int default 0, archived boolean default false);
create table form_access(user_id uuid references auth.users on delete cascade,
  form_id uuid references forms on delete cascade,
  role text not null check (role in ('admin','foreman','worker')), primary key (user_id, form_id));

create table wash_types(id serial primary key, name text not null, minutes int, sort int);
create table chemicals(id serial primary key, name text not null,
  kind text not null default 'main' check (kind in ('main','extra')),
  bottle_l numeric,      -- объём бутыли, л (задаёт суперадмин)
  per_unit numeric,      -- для kind='extra': расход на единицу
  sort int);
create table recipes(wash_type_id int references wash_types on delete cascade,
  chemical_id int references chemicals on delete cascade,
  ml_per_l numeric not null, primary key (wash_type_id, chemical_id));

create table loads(id uuid primary key default gen_random_uuid(),
  form_id uuid not null references forms, ts timestamptz not null default now(),
  shift_date date, part text,
  machine int not null check (machine between 1 and 12),
  wash_type_id int not null references wash_types,
  weight_kg numeric not null default 25, extras jsonb not null default '{}',
  user_id uuid default auth.uid());
create table chem_changes(id uuid primary key default gen_random_uuid(),
  form_id uuid not null references forms, ts timestamptz not null default now(),
  shift_date date, chemical_id int not null references chemicals,
  leftover_l numeric, machine_group text not null default '1_10' check (machine_group in ('1_10','11_12')), user_id uuid default auth.uid());
create table residents(day date not null, form_id uuid references forms,
  cnt int not null, primary key (day, form_id));

-- Смена 06:00-06:00: shift_date и день/ночь ставятся автоматически
create function set_shift() returns trigger language plpgsql as $$
declare tz int := (select value from settings where key='tz_offset');
        st int := (select value from settings where key='shift_start');
        loc timestamp;
begin
  loc := (new.ts at time zone 'UTC') + make_interval(hours => tz);
  new.shift_date := (loc - make_interval(hours => st))::date;
  if tg_table_name = 'loads' then
    new.part := case when extract(hour from loc) >= st and extract(hour from loc) < st + 12 then 'day' else 'night' end;
  end if;
  return new;
end $$;
create trigger t_loads before insert on loads for each row execute function set_shift();
create trigger t_chem before insert on chem_changes for each row execute function set_shift();

-- Права
create function is_super() returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from profiles where id = auth.uid() and role = 'superadmin') $$;
create function form_role(f uuid) returns text language sql stable security definer set search_path = public as
$$ select case when is_super() then 'admin'
   else (select role from form_access where user_id = auth.uid() and form_id = f) end $$;

do $$ declare t text; begin
  foreach t in array array['settings','wash_types','chemicals','recipes'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for select to authenticated using (true)', t||'_read', t);
    execute format('create policy %I on %I for all to authenticated using (is_super()) with check (is_super())', t||'_write', t);
  end loop;
end $$;

alter table profiles enable row level security;
create policy p_sel on profiles for select to authenticated using (id = auth.uid() or is_super());
create policy p_all on profiles for all to authenticated using (is_super()) with check (is_super());

alter table forms enable row level security;
create policy f_sel on forms for select to authenticated
  using (is_super() or exists (select 1 from form_access a where a.form_id = forms.id and a.user_id = auth.uid()));
create policy f_all on forms for all to authenticated using (is_super()) with check (is_super());

alter table form_access enable row level security;
create policy a_sel on form_access for select to authenticated using (user_id = auth.uid() or is_super());
create policy a_all on form_access for all to authenticated using (is_super()) with check (is_super());

alter table loads enable row level security;
create policy l_ins on loads for insert to authenticated
  with check (form_role(form_id) in ('worker','admin') and user_id = auth.uid());
create policy l_sel on loads for select to authenticated using (user_id = auth.uid() or form_role(form_id) = 'admin');
create policy l_del on loads for delete to authenticated
  using (user_id = auth.uid() and ts > now() - interval '10 minutes');

alter table chem_changes enable row level security;
create policy c_ins on chem_changes for insert to authenticated
  with check (form_role(form_id) in ('foreman','admin') and user_id = auth.uid());
create policy c_sel on chem_changes for select to authenticated using (user_id = auth.uid() or form_role(form_id) = 'admin');
create policy c_del on chem_changes for delete to authenticated
  using (user_id = auth.uid() and ts > now() - interval '10 minutes');

alter table residents enable row level security;
create policy r_all on residents for all to authenticated
  using (form_role(form_id) = 'admin') with check (form_role(form_id) = 'admin');

-- Начальные данные (из Blanc.xlsx)
insert into wash_types(name, minutes, sort) values
 ('Постель белая',57,1),('Махра белая',51,2),('Униформа белая',55,3),('Униформа тёмная',45,4),
 ('Синтетика',38,5),('Деликатная',50,6),('Спецодежда',42,7);
insert into chemicals(name, kind, sort) values
 ('EMULSIFIER','main',1),('ALKALINE','main',2),('BLEACH','main',3),('SOFTENER','main',4),('NEUTRALIZER','main',5);
insert into chemicals(name, kind, per_unit, sort) values ('Ваниш','extra',5,6),('Ленор','extra',50,7),('Порошок','extra',175,8);

-- мл на литр воды: EMULSIFIER, ALKALINE, BLEACH, SOFTENER, NEUTRALIZER
insert into recipes(wash_type_id, chemical_id, ml_per_l)
select w.id, c.id, d.v
from (values ('Постель белая','{3,8,6,4,1}'::int[]),('Махра белая','{3,8,6,5,1}'),('Униформа белая','{3,8,5,3,1}'),
             ('Униформа тёмная','{2,6,0,3,1}'),('Синтетика','{3,5,0,3,1}'),('Деликатная','{2,4,0,3,1}'),
             ('Спецодежда','{3,10,0,3,1}')) t(n, a)
join wash_types w on w.name = t.n
cross join lateral unnest(t.a) with ordinality d(v, i)
join chemicals c on c.sort = d.i and c.kind = 'main';

insert into forms(slug, name, type, sort_order) values
 ('laundry-load','Прачечная: загрузка белья','laundry_load',1),
 ('laundry-chem','Прачечная: замена химии','laundry_chem',2);

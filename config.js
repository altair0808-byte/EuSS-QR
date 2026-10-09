// Project Settings -> API в Supabase
window.CFG = {
  SUPABASE_URL: 'https://mqbqmacniphqngkwrltu.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1xYnFtYWNuaXBocW5na3dybHR1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTExOTc5ODYsImV4cCI6MjEwNjc3Mzk4Nn0.aldUSwkK5HIOxC1zfGYOGsq0D9YS1NCtd0-IG3H5yN8',
  // Сотрудники входят по логину. В Supabase он хранится как логин@LOGIN_DOMAIN (письма на этот адрес не отправляются).
  // Значение должно совпадать с LOGIN_DOMAIN в функции admin-users.
  LOGIN_DOMAIN: 'euss.local',
  // Дополняет пароль короче 6 знаков (Supabase требует минимум 6). Должно совпадать с PW_PAD в функции admin-users.
  PW_PAD: 'euss-pin',
  // Автовыход при бездействии (минуты) для всех, кроме админов и суперадмина
  IDLE_MINUTES: 5
};

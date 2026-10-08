-- stage16.sql — ЧЕРНОВИК, сначала на копии базы.
-- Закрытия, замеры и журнал закрытий видят только админ и суперадмин (is_admin() уже включает суперадмина).
-- Бригадир и сотрудник больше не читают эти таблицы, даже если знают прямую ссылку.
-- Запускать после stage15.sql. Можно запускать повторно.

drop policy if exists closings_sel on closings;
create policy closings_sel on closings for select to authenticated using (is_admin());

drop policy if exists closing_measures_sel on closing_measures;
create policy closing_measures_sel on closing_measures for select to authenticated using (is_admin());

drop policy if exists closing_log_sel on closing_log;
create policy closing_log_sel on closing_log for select to authenticated using (is_admin());

-- =============================================================
-- 港口门座式起重机仿真平台 · 统计表结构
-- 在 Supabase 控制台 → SQL Editor 里整段执行即可
-- =============================================================

-- 1. 访问记录（每次打开页面插一条，心跳每 2 分钟一条）
create table if not exists visits (
  id         bigserial primary key,
  created_at timestamptz not null default now(),
  sid        text,
  ua         text,
  path       text
);
create index if not exists visits_created_idx on visits (created_at desc);
create index if not exists visits_sid_idx     on visits (sid);

-- 2. 功能使用事件
create table if not exists events (
  id         bigserial primary key,
  created_at timestamptz not null default now(),
  sid        text,
  feature    text,
  detail     text
);
create index if not exists events_feature_idx on events (feature);
create index if not exists events_created_idx on events (created_at desc);

-- 3. 实训成绩
create table if not exists scores (
  id         bigserial primary key,
  created_at timestamptz not null default now(),
  sid        text,
  name       text,
  no         text,
  total      int,
  detail     jsonb
);
create index if not exists scores_created_idx on scores (created_at desc);

-- 4. 开放匿名读写（教学场景）
alter table visits enable row level security;
alter table events enable row level security;
alter table scores enable row level security;

drop policy if exists anon_all_visits on visits;
drop policy if exists anon_all_events on events;
drop policy if exists anon_all_scores on scores;

create policy anon_all_visits on visits for all to anon using (true) with check (true);
create policy anon_all_events on events for all to anon using (true) with check (true);
create policy anon_all_scores on scores for all to anon using (true) with check (true);

-- 5. 可选：清理 90 天前的访问记录（在 SQL Editor 手动跑，或配 cron）
-- delete from visits where created_at < now() - interval '90 days';

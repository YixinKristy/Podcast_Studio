-- 支撑 docs/07 A1（60s 重发/连续 3 次提示换邮箱）与 A2（5 次失败锁 10 分钟）。
-- 纯服务端表：只有 service role 能读写，没有给 anon/authenticated 开任何策略。
create table public.auth_email_challenges (
  email text primary key,
  attempt_count integer not null default 0,
  window_started_at timestamptz not null default now(),
  last_sent_at timestamptz,
  locked_until timestamptz
);

alter table public.auth_email_challenges enable row level security;

-- 播客后期分发助手：初始 schema
-- 对应 docs/05 第七节数据模型 + docs/07 状态机（修订版）
-- 五张表：users / shows / episodes / materials / quota_ledger，全部开 RLS

-- ============================================================
-- users：public.users 是 auth.users 的应用侧扩展（email/phone 冗余存一份方便查询）
-- ============================================================
create table public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  phone text,
  created_at timestamptz not null default now()
);

alter table public.users enable row level security;

create policy "users can view own row" on public.users for select using (auth.uid () = id);

create policy "users can update own row" on public.users for
update using (auth.uid () = id);

-- 新用户注册时自动在 public.users 建一行，跟 auth.users 保持同步
create function public.handle_new_user () returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.users (id, email)
  values (new.id, new.email);
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users for each row
execute function public.handle_new_user ();

-- ============================================================
-- shows：一个用户可以有多个节目
-- ============================================================
create table public.shows (
  id uuid primary key default gen_random_uuid (),
  user_id uuid not null references public.users (id) on delete cascade,
  name text not null,
  intro text,
  visual_config jsonb not null default '{}'::jsonb,
  footer_text text,
  default_speakers jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index shows_user_id_idx on public.shows (user_id);

alter table public.shows enable row level security;

create policy "users manage own shows" on public.shows for all using (auth.uid () = user_id)
with
  check (auth.uid () = user_id);

-- ============================================================
-- episodes：状态机见 docs/07 —— draft -> uploaded -> transcribing
-- -> transcribe_failed(可重入) -> generating -> ready <-> published
-- ============================================================
create type episode_status as enum(
  'draft',
  'uploaded',
  'transcribing',
  'transcribe_failed',
  'generating',
  'ready',
  'published'
);

create type episode_source_type as enum('file', 'link');

create table public.episodes (
  id uuid primary key default gen_random_uuid (),
  show_id uuid not null references public.shows (id) on delete cascade,
  source_type episode_source_type not null,
  audio_url text,
  duration_seconds integer,
  status episode_status not null default 'draft',
  episode_no integer,
  -- 句级转写：[{ text, speaker, start, end, confidence }, ...]
  transcript jsonb,
  created_at timestamptz not null default now(),
  published_at timestamptz
);

create index episodes_show_id_idx on public.episodes (show_id);

create index episodes_status_idx on public.episodes (status);

alter table public.episodes enable row level security;

create policy "users manage own episodes" on public.episodes for all using (
  exists (
    select
      1
    from
      public.shows
    where
      shows.id = episodes.show_id
      and shows.user_id = auth.uid ()
  )
)
with
  check (
    exists (
      select
        1
      from
        public.shows
      where
        shows.id = episodes.show_id
        and shows.user_id = auth.uid ()
    )
  );

-- ============================================================
-- materials：七件套物料，每个 episode 每种 type 一行，version 原地递增
-- ============================================================
create type material_type as enum(
  'title',
  'cover',
  'shownotes',
  'chapters',
  'quotes',
  'clips',
  'note'
);

create type material_status as enum('pending', 'generating', 'ready', 'failed');

create table public.materials (
  id uuid primary key default gen_random_uuid (),
  episode_id uuid not null references public.episodes (id) on delete cascade,
  type material_type not null,
  content jsonb not null default '{}'::jsonb,
  version integer not null default 1,
  status material_status not null default 'pending',
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (episode_id, type)
);

create index materials_episode_id_idx on public.materials (episode_id);

alter table public.materials enable row level security;

create policy "users manage own materials" on public.materials for all using (
  exists (
    select
      1
    from
      public.episodes
      join public.shows on shows.id = episodes.show_id
    where
      episodes.id = materials.episode_id
      and shows.user_id = auth.uid ()
  )
)
with
  check (
    exists (
      select
        1
      from
        public.episodes
        join public.shows on shows.id = episodes.show_id
      where
        episodes.id = materials.episode_id
        and shows.user_id = auth.uid ()
    )
  );

-- ============================================================
-- quota_ledger：追加式流水，不是可变计数器 —— 幂等靠 (episode_id, reason) 唯一约束，
-- 重试同一个扣减/冲正事件不会重复入账（架构铁律 #6）。
-- used = 该用户当月 delta 之和，由 lib/services/quota.ts 汇总，不在表里存冗余计数字段。
-- 客户端不能直接写这张表，只能读自己的；扣减/冲正只能由服务端用 service role 写。
-- ============================================================
create table public.quota_ledger (
  id uuid primary key default gen_random_uuid (),
  user_id uuid not null references public.users (id) on delete cascade,
  -- 存当月第一天，例如 2026-07-01，方便按月分组
  month date not null,
  -- +1 = 扣减一次生成额度，-1 = 冲正
  delta integer not null,
  episode_id uuid not null references public.episodes (id) on delete cascade,
  reason text not null,
  created_at timestamptz not null default now(),
  unique (episode_id, reason)
);

create index quota_ledger_user_month_idx on public.quota_ledger (user_id, month);

alter table public.quota_ledger enable row level security;

create policy "users view own quota ledger" on public.quota_ledger for select using (auth.uid () = user_id);

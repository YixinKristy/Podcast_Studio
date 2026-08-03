-- 任务 1.6 上传链路：episodes 加 hash 字段做秒传（C5），
-- 加 upload_sessions/upload_parts 支撑分片断点续传（C3，分片保留 24h）。

alter table public.episodes
add column content_hash text;

create index episodes_show_hash_idx on public.episodes (show_id, content_hash);

create table public.upload_sessions (
  id uuid primary key default gen_random_uuid (),
  show_id uuid not null references public.shows (id) on delete cascade,
  content_hash text not null,
  file_name text not null,
  file_size bigint not null,
  mime_type text,
  chunk_size integer not null,
  total_chunks integer not null,
  oss_object_key text not null,
  oss_upload_id text not null,
  status text not null default 'uploading' check (status in ('uploading', 'completed', 'aborted')),
  created_at timestamptz not null default now(),
  -- C3：分片保留 24h，超时清理
  expires_at timestamptz not null default (now() + interval '24 hours')
);

create index upload_sessions_show_hash_idx on public.upload_sessions (show_id, content_hash);

alter table public.upload_sessions enable row level security;

create policy "users manage own upload sessions" on public.upload_sessions for all using (
  exists (
    select
      1
    from
      public.shows
    where
      shows.id = upload_sessions.show_id
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
        shows.id = upload_sessions.show_id
        and shows.user_id = auth.uid ()
    )
  );

create table public.upload_parts (
  upload_session_id uuid not null references public.upload_sessions (id) on delete cascade,
  part_no integer not null,
  etag text not null,
  created_at timestamptz not null default now(),
  primary key (upload_session_id, part_no)
);

alter table public.upload_parts enable row level security;

create policy "users manage own upload parts" on public.upload_parts for all using (
  exists (
    select
      1
    from
      public.upload_sessions
      join public.shows on shows.id = upload_sessions.show_id
    where
      upload_sessions.id = upload_parts.upload_session_id
      and shows.user_id = auth.uid ()
  )
)
with
  check (
    exists (
      select
        1
      from
        public.upload_sessions
        join public.shows on shows.id = upload_sessions.show_id
      where
        upload_sessions.id = upload_parts.upload_session_id
        and shows.user_id = auth.uid ()
    )
  );

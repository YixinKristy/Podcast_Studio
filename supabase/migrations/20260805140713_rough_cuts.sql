-- docs/04 Stage 1 剪辑台"第一步·导出优先"：AI 给剪辑建议（填充词/长停顿/冗余表达/跑题等），
-- 用户勾选采纳后真实剪出一版粗剪音频，供用户带去剪映等工具继续精修——不是发布物料，
-- 是发布台（Stage 2 materials）之前的一个独立编辑阶段，所以单独建表，不塞进 materials 表
-- 的 type 枚举（会污染"七件套"的语义）。复用跟 materials 完全一样的 status 枚举和 RLS 写法。
create table public.rough_cuts (
  id uuid primary key default gen_random_uuid (),
  episode_id uuid not null unique references public.episodes (id) on delete cascade,
  status material_status not null default 'pending',
  -- 建议列表：[{id, layer('L1'|'L2'|'L3'), type, startSeconds, endSeconds, reason, confidence, selected}]
  -- L3 是纯文字建议（不给可勾选的删除区间），不在这个数组里，存在 outline_markdown 里
  suggestions jsonb not null default '[]'::jsonb,
  outline_markdown text,
  audio_url text,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index rough_cuts_episode_id_idx on public.rough_cuts (episode_id);

alter table public.rough_cuts enable row level security;

create policy "users manage own rough cuts" on public.rough_cuts for all using (
  exists (
    select
      1
    from
      public.episodes
      join public.shows on shows.id = episodes.show_id
    where
      episodes.id = rough_cuts.episode_id
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
        episodes.id = rough_cuts.episode_id
        and shows.user_id = auth.uid ()
    )
  );

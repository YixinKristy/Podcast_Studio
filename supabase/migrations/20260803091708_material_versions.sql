-- W2 文本物料四件套：版本历史表。materials.content/version 一直是"当前版本"的冗余副本
-- （读的时候不用 join），完整历史存这张表，最多保留 5 版由应用层控制。
create table public.material_versions (
  id uuid primary key default gen_random_uuid (),
  material_id uuid not null references public.materials (id) on delete cascade,
  version integer not null,
  content jsonb not null,
  source text not null check (source in ('generated', 'edited', 'reroll')),
  instruction text,
  created_at timestamptz not null default now(),
  unique (material_id, version)
);

create index material_versions_material_id_idx on public.material_versions (material_id);

alter table public.material_versions enable row level security;

create policy "users manage own material versions" on public.material_versions for all using (
  exists (
    select
      1
    from
      public.materials
      join public.episodes on episodes.id = materials.episode_id
      join public.shows on shows.id = episodes.show_id
    where
      materials.id = material_versions.material_id
      and shows.user_id = auth.uid ()
  )
)
with
  check (
    exists (
      select
        1
      from
        public.materials
        join public.episodes on episodes.id = materials.episode_id
        join public.shows on shows.id = episodes.show_id
      where
        materials.id = material_versions.material_id
        and shows.user_id = auth.uid ()
    )
  );

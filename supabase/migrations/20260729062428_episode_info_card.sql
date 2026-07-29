-- P2 上传页"本期信息卡"的字段：核心主输入 + 折叠区，任务 1.7 生成物料时会读这些。
alter table public.episodes
add column promote_note text,
add column guests jsonb not null default '[]'::jsonb,
add column generate_materials jsonb not null default '["title", "cover", "shownotes", "chapters", "quotes", "clips", "note"]'::jsonb;

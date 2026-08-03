-- 任务 1.7 转写任务：D3（低置信标记）+ D6（单说话人自动适配）需要的字段。
alter table public.episodes
add column low_confidence boolean not null default false,
add column speaker_count integer;

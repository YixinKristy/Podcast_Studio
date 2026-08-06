-- 建议生成（LLM，同步）和音频渲染（ffmpeg，异步 Trigger.dev 任务）是两个独立的操作，
-- 不能共用一个 status 字段——渲染开始时建议早就是 ready 了，不能把整行的 status 拽回
-- generating，不然 UI 会误以为建议本身又要重新生成一遍。
alter table public.rough_cuts add column render_status material_status not null default 'pending';

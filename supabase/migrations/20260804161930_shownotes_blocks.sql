-- Shownotes 按产品设计（docs/04/05）改成分块结构：简介/提及清单/嘉宾介绍各自独立
-- 生成、独立 reroll、独立版本历史——复用统一物料生成器契约（materials + material_versions），
-- 不是新架构，只是把 shownotes 从"一个 type"拆成"三个 type"。
-- 时间轴章节继续用已有的 chapters 类型（Shownotes 里只读引用，不重复存储）；
-- 固定尾部依赖还没做的节目设置页，先不做。
alter type material_type add value 'shownotes_intro';
alter type material_type add value 'shownotes_guest_intro';
alter type material_type add value 'shownotes_mentions';

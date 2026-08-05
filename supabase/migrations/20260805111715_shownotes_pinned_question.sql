-- docs/13 三：Shownotes 多了一个"置顶互动问题"块，05 号 PRD 原来的 5 块（简介/章节引用/
-- 提及清单/嘉宾介绍/固定尾部）没有——跟你确认过，按 13 号文档加为第 6 个独立块，
-- 复用跟其它 shownotes 分块一样的物料生成器契约。
alter type material_type add value 'shownotes_pinned_question';

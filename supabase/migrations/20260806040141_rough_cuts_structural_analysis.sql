-- docs/04 §1.2 v2 重写 + docs/13 §九：粗剪引擎新增 Pass 1（结构理解）+ Pass 2（依主线取舍），
-- 在原有 Pass 3（填充词/长停顿/口误重说等微观清理，即 suggestions 字段）之上叠加一层
-- 段落级的主线取舍决策。单独一列存，不复用 suggestions 的 shape——
-- 结构分析是"主线陈述 + 段落地图 + 每段决策"的树状结构，跟一个扁平建议数组语义不同。
alter table public.rough_cuts
add column structural_analysis jsonb;

# Bug：额度扣减静默失败（任务 1.7）

日期：2026-08-03

## 现象

端到端测试真实转写流程时，转写本身完全成功（770 句真实内容，4分8秒完成），
但转写完之后查 `quota_ledger`，是空的——额度根本没扣。

## 根因

`app/api/episodes/[episodeId]/start/route.ts` 里调用 `deductQuotaForGeneration` 时，
传的是 `@/lib/db/supabase/server` 那个 RLS 受限的 client（跟当前登录用户的权限一样）。

但 `quota_ledger` 表的 RLS 策略（任务 1.4 建的）只给 owner 开了 **SELECT**，
故意不给 INSERT/UPDATE 权限——设计意图就是"扣减/冲正只能服务端用 service role 写"
（迁移文件里原话）。

用受限 client 去 `upsert` 这张表，Postgres RLS 直接拒绝这行 INSERT，但因为原来的代码
没检查 `upsert()` 返回的 `error`，这个失败被完全吞掉了——函数照样返回 `{ ok: true }`，
上层完全不知道扣额度这一步其实什么都没发生。

## 是怎么发现的

不是靠代码审查发现的，是端到端测试完之后**专门去查了 `quota_ledger` 表**才看到是空的。
如果只测"转写有没有成功"，这个 bug 会被完全放过——这也是为什么"验证结果"要包含检查
业务规则的副作用（额度、状态流转），不能只看主流程的输出对不对。

## 修复

1. `lib/services/quota.ts`：`upsert` 调用现在会检查 `error` 并抛出，不再静默失败
2. `app/api/episodes/[episodeId]/start/route.ts`：扣额度改用 `createAdminClient()`（service role），
   不再用 RLS 受限的 client
3. `trigger/transcribe-episode.ts` 里的冲正逻辑本来就用的是 admin client（整个 Trigger.dev
   任务都是拿 service role 跑的），这条路径没有这个问题

## 教训

任何写 `quota_ledger` 这类"只给 service role 写"的表的代码，都要显式用 admin client，
并且 upsert/insert 的返回值一定要检查 error，不能假设"没抛异常就是成功"——RLS 拒绝
不会抛异常，只会让这一行 `error` 字段非空。

-- 登录方式从邮箱魔法链接改成邮箱+密码，这张表的用途从"发信限流"变成"登录失败限流"，改名更贴切。
-- docs/07 A2：密码连续输错 5 次锁 10 分钟。A1（验证码重发）不再适用——密码登录没有"发信"这一步。
alter table public.auth_email_challenges
rename to auth_login_attempts;

alter table public.auth_login_attempts
rename column last_sent_at to last_attempt_at;

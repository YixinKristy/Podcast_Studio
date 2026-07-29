"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface LoginModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  next?: string;
}

type Mode = "login" | "register";
type Status = "idle" | "submitting";

export function LoginModal({ open, onOpenChange, next }: LoginModalProps) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [lockedSeconds, setLockedSeconds] = useState(0);

  useEffect(() => {
    if (lockedSeconds <= 0) return;
    const timer = setTimeout(() => setLockedSeconds((s) => Math.max(0, s - 1)), 1000);
    return () => clearTimeout(timer);
  }, [lockedSeconds]);

  async function submit() {
    setStatus("submitting");
    setMessage(null);
    try {
      const res = await fetch(`/api/auth/${mode === "login" ? "sign-in" : "sign-up"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const json = await res.json();

      if (!res.ok) {
        setStatus("idle");
        setMessage(json.error ?? "出错了，稍后再试");
        if (typeof json.retryAfterSeconds === "number") {
          setLockedSeconds(json.retryAfterSeconds);
        }
        return;
      }

      // 注册接口内部也是 supabase.auth.signUp，project 开了 autoconfirm，
      // 注册成功即已建立 session，跟登录成功一样直接跳转，不用再多登录一次
      onOpenChange(false);
      router.push(next ?? "/new");
      router.refresh();
    } catch {
      setStatus("idle");
      setMessage("网络好像有问题，稍后再试");
    }
  }

  const canSubmit =
    email.includes("@") && password.length >= 6 && status !== "submitting" && lockedSeconds === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[360px]">
        <DialogHeader>
          <DialogTitle>{mode === "login" ? "登录" : "注册"}</DialogTitle>
        </DialogHeader>
        <div className="mt-1 space-y-3">
          <div className="space-y-2">
            <Label htmlFor="login-email">邮箱</Label>
            <Input
              id="login-email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="login-password">密码</Label>
            <Input
              id="login-password"
              type="password"
              placeholder="至少 6 位"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
        </div>
        <Button className="mt-4 w-full" disabled={!canSubmit} onClick={submit}>
          {lockedSeconds > 0
            ? `已锁定，${Math.ceil(lockedSeconds / 60)} 分钟后再试`
            : status === "submitting"
              ? "处理中..."
              : mode === "login"
                ? "登录"
                : "注册"}
        </Button>
        <button
          type="button"
          className="text-muted-foreground mt-2 text-sm underline"
          onClick={() => {
            setMode(mode === "login" ? "register" : "login");
            setMessage(null);
          }}
        >
          {mode === "login" ? "没有账号？注册一个" : "已有账号？去登录"}
        </button>
        {message && <p className="text-destructive mt-2 text-sm">{message}</p>}
      </DialogContent>
    </Dialog>
  );
}

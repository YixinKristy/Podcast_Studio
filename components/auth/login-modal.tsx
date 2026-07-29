"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface LoginModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  next?: string;
}

type Status = "idle" | "sending" | "sent" | "error";

export function LoginModal({ open, onOpenChange, next }: LoginModalProps) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  function startCooldown(seconds: number) {
    setCooldown(seconds);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setCooldown((s) => {
        if (s <= 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
  }

  async function sendLink() {
    setStatus("sending");
    setMessage(null);
    try {
      const res = await fetch("/api/auth/send-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, next }),
      });
      const json = await res.json();

      if (!res.ok) {
        setStatus("error");
        setMessage(json.error ?? "发送失败，稍后再试");
        if (typeof json.retryAfterSeconds === "number") {
          startCooldown(json.retryAfterSeconds);
        }
        return;
      }

      setStatus("sent");
      setMessage(
        json.hintSwitchEmail
          ? "邮件发送成功，查收一下（含垃圾箱）。如果多次没收到，换个邮箱试试"
          : "邮件发送成功，去邮箱里点登录链接吧（含垃圾箱）",
      );
      startCooldown(60);
    } catch {
      setStatus("error");
      setMessage("网络好像有问题，稍后再试");
    }
  }

  const canSend = email.includes("@") && cooldown === 0 && status !== "sending";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[360px]">
        <DialogHeader>
          <DialogTitle>登录 / 注册</DialogTitle>
        </DialogHeader>
        <p className="text-muted-foreground text-sm">邮箱登录，无密码，输入邮箱即可注册</p>
        <div className="mt-3 space-y-2">
          <Label htmlFor="login-email">邮箱</Label>
          <Input
            id="login-email"
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <Button className="mt-4 w-full" disabled={!canSend} onClick={sendLink}>
          {cooldown > 0
            ? `重新发送(${cooldown}s)`
            : status === "sending"
              ? "发送中..."
              : "发送登录链接"}
        </Button>
        {message && (
          <p
            className={`mt-3 text-sm ${status === "error" ? "text-destructive" : "text-muted-foreground"}`}
          >
            {message}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

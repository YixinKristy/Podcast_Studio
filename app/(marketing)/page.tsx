"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { LoginModal } from "@/components/auth/login-modal";

function MarketingContent() {
  const searchParams = useSearchParams();
  const next = searchParams.get("next") ?? undefined;
  const [open, setOpen] = useState(Boolean(next));

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-3xl font-semibold">播客后期分发助手</h1>
      <p className="text-muted-foreground max-w-md">
        上传成品音频，AI 生成标题、封面、Shownotes、章节、金句卡、切片与宣传笔记七件套发布物料。
      </p>
      <Button onClick={() => setOpen(true)}>免费开始</Button>
      <LoginModal open={open} onOpenChange={setOpen} next={next} />
    </main>
  );
}

export default function MarketingPage() {
  return (
    <Suspense>
      <MarketingContent />
    </Suspense>
  );
}

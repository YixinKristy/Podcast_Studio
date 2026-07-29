"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createShowAction } from "./actions";

interface ActionState {
  error?: string;
}

async function action(_prevState: ActionState, formData: FormData): Promise<ActionState> {
  const result = await createShowAction(formData);
  return result ?? {};
}

export default function OnboardingPage() {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, {});

  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <form action={formAction} className="w-full max-w-sm space-y-5">
        <div>
          <h1 className="text-2xl font-semibold">建一个节目</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            这是后面一切物料的前提，只需要现在填一次
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="name">节目名（必填）</Label>
          <Input id="name" name="name" required placeholder="比如：慢慢来电台" />
        </div>

        <div className="space-y-2">
          <Label htmlFor="defaultSpeaker">常驻说话人（选填）</Label>
          <Input id="defaultSpeaker" name="defaultSpeaker" placeholder="比如你自己的称呼" />
        </div>

        <p className="text-muted-foreground text-sm">主视觉可以稍后再设置</p>

        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? "创建中..." : "完成，开始上传"}
        </Button>

        {state.error && <p className="text-destructive text-sm">{state.error}</p>}
      </form>
    </main>
  );
}

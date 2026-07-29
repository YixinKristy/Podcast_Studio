import { createClient } from "@/lib/db/supabase/server";
import { Button } from "@/components/ui/button";
import { signOutAction } from "./actions";

export default async function UploadPlaceholderPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: show } = await supabase.from("shows").select("name").limit(1).maybeSingle();

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 p-8 text-center">
      <h1 className="text-2xl font-semibold">上传页开发中</h1>
      <p className="text-muted-foreground">
        {show?.name} · 登录邮箱：{user?.email}
      </p>
      <form action={signOutAction}>
        <Button type="submit" variant="outline">
          退出登录
        </Button>
      </form>
    </main>
  );
}

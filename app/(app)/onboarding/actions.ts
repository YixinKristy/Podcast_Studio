"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/db/supabase/server";
import { createShow } from "@/lib/services/show";

export async function createShowAction(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const defaultSpeaker = String(formData.get("defaultSpeaker") ?? "").trim();

  if (!name) {
    return { error: "节目名不能为空" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/");
  }

  const { error } = await createShow(supabase, {
    userId: user.id,
    name,
    defaultSpeaker: defaultSpeaker || undefined,
  });

  if (error) {
    return { error: "建节目失败，稍后再试" };
  }

  redirect("/new");
}

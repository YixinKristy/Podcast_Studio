import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/lib/db/database.types";

// (app) 路由组：需要登录，登录了但还没建节目则强制进 onboarding（docs/07 A6，不可绕过）
const APP_ROUTE_PREFIXES = ["/onboarding", "/new", "/e", "/episodes", "/settings"];

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;
  const isAppRoute = APP_ROUTE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );

  if (!isAppRoute) {
    return response;
  }

  if (!user) {
    const loginUrl = new URL("/", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (pathname === "/onboarding") {
    return response;
  }

  const { data: shows } = await supabase.from("shows").select("id").limit(1);
  if (!shows || shows.length === 0) {
    return NextResponse.redirect(new URL("/onboarding", request.url));
  }

  return response;
}

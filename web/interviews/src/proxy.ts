import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { isAdmin, unauthorized } from "@/lib/auth";

export function proxy(req: NextRequest) {
  if (!isAdmin(req.headers.get("authorization"))) return unauthorized();
  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*"],
};

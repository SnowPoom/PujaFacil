import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getUserFromCookieHeader, type SessionUser } from "@/lib/auth/session";

export async function getCurrentUser(): Promise<SessionUser | null> {
  return getUserFromCookieHeader((await cookies()).toString());
}
export async function requireCurrentUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/iniciar-sesion");
  return user;
}

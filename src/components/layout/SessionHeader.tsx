import Header from "./Header";
import { getCurrentUser } from "@/lib/auth/server";

export default async function SessionHeader() {
  const user = await getCurrentUser().catch(() => null);
  return <Header initialUser={user} />;
}

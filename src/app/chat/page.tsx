import { Suspense } from "react";
import { requireCurrentUser } from "@/lib/auth/server";
import ChatRoom from "@/components/chat/ChatRoom";

export default function ChatPage() {
  return (
    <main className="pf-page w-full">
      <Suspense fallback={<p role="status">Cargando sala de chat…</p>}>
        <AuthenticatedChat />
      </Suspense>
    </main>
  );
}

async function AuthenticatedChat() {
  await requireCurrentUser();
  return <ChatRoom />;
}

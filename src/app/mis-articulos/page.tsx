import { Suspense } from "react";
import { requireCurrentUser } from "@/lib/auth/server";
import { listOwnArticles } from "@/modules/articles/article-service";
import ArticlesClient from "./ArticlesClient";
export default function ArticlesPage() {
 return <Suspense fallback={<main className="pf-page"><p role="status">Cargando tus artículos…</p></main>}><Articles /></Suspense>;
}
async function Articles() {
 const user = await requireCurrentUser();
 if (user.status !== "ACTIVA" || !user.roles.includes("VENDEDOR")) return <ArticlesClient initialItems={[]} initialPages={1} initialStatus={403} />;
 const data = await listOwnArticles(user.id, { page: 1, pageSize: 8 });
 return <ArticlesClient initialItems={data.items} initialPages={data.pages} initialStatus={null} />;
}

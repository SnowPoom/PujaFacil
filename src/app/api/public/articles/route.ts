import { NextResponse } from "next/server";
import { getPublicCatalog } from "@/modules/articles/public-catalog";
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const page = Number(params.get("page") ?? 1), size = Number(params.get("pageSize") ?? 8);
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(size) || size < 1 || size > 50) {
    return NextResponse.json({ ok: false, error: { code: "VALIDATION_ERROR", message: "La página y el tamaño de página deben ser enteros positivos (máximo 50 artículos)." } }, { status: 400 });
  }
  try { return NextResponse.json({ ok: true, data: await getPublicCatalog(params) }); }
  catch { return NextResponse.json({ ok: false, error: { code: "CATALOGO_NO_DISPONIBLE", message: "No se pudo cargar el catálogo. Inténtalo de nuevo." } }, { status: 500 }); }
}

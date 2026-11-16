import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const PUBLIC_STATUSES = ["APROBADO", "ASOCIADO_SUBASTA"] as const;

export async function GET(request: Request): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim() ?? "";
  const category = searchParams.get("category")?.trim() ?? "";
  const rawPage = searchParams.get("page");
  const rawPageSize = searchParams.get("pageSize");
  const page = rawPage === null ? 1 : Number(rawPage);
  const pageSize = rawPageSize === null ? 8 : Number(rawPageSize);

  if (
    !Number.isInteger(page) || page < 1 ||
    !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 50
  ) {
    return NextResponse.json(
      { ok: false, error: { code: "VALIDATION_ERROR", message: "page debe ser un entero positivo y pageSize un entero entre 1 y 50." } },
      { status: 400 },
    );
  }

  const where = {
    status: { in: [...PUBLIC_STATUSES] },
    ...(q ? { OR: [
      { title: { contains: q, mode: "insensitive" as const } },
      { description: { contains: q, mode: "insensitive" as const } },
    ] } : {}),
    ...(category && category !== "ALL" && category !== "Todas"
      ? { category: { equals: category, mode: "insensitive" as const } }
      : {}),
  };

  const [articles, total] = await Promise.all([
    prisma.article.findMany({
      where,
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        title: true,
        description: true,
        category: true,
        condition: true,
        provenance: true,
        initialPrice: true,
        status: true,
        createdAt: true,
        files: {
          where: { kind: "FOTO" },
          orderBy: { createdAt: "asc" },
          take: 1,
          select: { id: true },
        },
        auctions: {
          where: { status: { notIn: ["BORRADOR", "CANCELADA"] } },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { id: true, status: true, startingPrice: true, closesAt: true },
        },
      },
    }),
    prisma.article.count({ where }),
  ]);

  const items = articles.map((article) => {
    const photo = article.files[0];
    const auction = article.auctions[0];
    return {
      id: article.id,
      title: article.title,
      description: article.description,
      category: article.category,
      condition: article.condition,
      provenance: article.provenance,
      initialPrice: article.initialPrice.toFixed(2),
      status: article.status,
      createdAt: article.createdAt.toISOString(),
      photoUrl: photo ? `/api/files/${photo.id}` : null,
      auction: auction ? {
        id: auction.id,
        status: auction.status,
        startingPrice: auction.startingPrice.toFixed(2),
        closesAt: auction.closesAt.toISOString(),
      } : null,
    };
  });

  return NextResponse.json({
    ok: true,
    data: { items, page, pageSize, total, pages: Math.max(1, Math.ceil(total / pageSize)) },
  });
}

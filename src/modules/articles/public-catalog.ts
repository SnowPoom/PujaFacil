import { prisma } from "@/lib/prisma";

const PUBLIC_STATUSES = ["APROBADO", "ASOCIADO_SUBASTA"] as const;

export async function getPublicCatalog(searchParams = new URLSearchParams()) {
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
    throw new Error("La página y el tamaño de página deben ser enteros positivos (máximo 50 artículos).");
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

  const [articles, total, categoryRows] = await Promise.all([
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
    prisma.article.findMany({ where: { status: { in: [...PUBLIC_STATUSES] } }, distinct: ["category"], select: { category: true }, orderBy: { category: "asc" } }),
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

  return { items, page, pageSize, total, pages: Math.max(1, Math.ceil(total / pageSize)), categories: categoryRows.map((row) => row.category) };
}

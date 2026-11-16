import { z } from "zod";
import { prisma } from "@/lib/prisma";

export const usersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(1000000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(10),
  status: z.enum(["PENDIENTE", "ACTIVA"]).optional(),
});

export async function listAccounts(input: z.input<typeof usersQuerySchema>) {
  const { page, pageSize, status } = usersQuerySchema.parse(input);
  const where = { status: status ? { equals: status } : { in: ["PENDIENTE", "ACTIVA"] as ("PENDIENTE" | "ACTIVA")[] } };
  const [users, total] = await prisma.$transaction([
    prisma.user.findMany({ where, skip: (page - 1) * pageSize, take: pageSize,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { id: true, status: true, createdAt: true, roles: { select: { role: true } },
        _count: { select: { files: { where: { kind: "IDENTIDAD" } } } } },
    }),
    prisma.user.count({ where }),
  ], { isolationLevel: "RepeatableRead" });
  return { items: users.map(({ roles, _count, ...user }) => ({ ...user, roles: roles.map(({ role }) => role), hasIdentity: _count.files > 0 })),
    page, pageSize, total, pages: Math.max(1, Math.ceil(total / pageSize)) };
}

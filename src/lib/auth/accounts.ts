import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export const usersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(1000000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(10),
  status: z.enum(["PENDIENTE", "ACTIVA"]).optional(),
});

export async function listAccounts(input: z.input<typeof usersQuerySchema>) {
  const { page, pageSize, status } = usersQuerySchema.parse(input);
  const where: Prisma.UserWhereInput = {
    status: status ? { equals: status } : { in: ["PENDIENTE", "ACTIVA"] },
    roles: { some: { role: { in: ["COMPRADOR", "VENDEDOR"] } }, none: { role: { in: ["ADMIN_SUBASTAS", "VERIFICADOR", "AUDITOR"] } } },
  };
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

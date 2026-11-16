import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma, type AccountStatus, type Role } from "@prisma/client";

type MockUserRecord = {
  id: string;
  nombreCompleto: string;
  email: string;
  status: AccountStatus;
  roles: Array<{ role: Role }>;
};

const db = vi.hoisted(() => ({
  $queryRaw: vi.fn(),
  $transaction: vi.fn(),
  user: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
  },
  session: {
    findUnique: vi.fn(),
  },
  article: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
  },
  review: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  auditEvent: {
    create: vi.fn(),
  },
  notification: {
    create: vi.fn(),
  },
}));

vi.mock("@/lib/prisma", () => ({ prisma: db }));

import { hashToken } from "@/lib/auth/session";
import {
  assignReviewSchema,
  decideReviewSchema,
  validateReviewAssignmentRules,
  validateReviewDecisionRules,
} from "@/modules/reviews/review-schema";
import {
  assignReview,
  decideReview,
  getAssignedReviewById,
  listAssignedReviews,
  ReviewServiceError,
} from "@/modules/reviews/review-service";
import {
  createAuctionSchema,
  isWithinServerAuctionWindow,
  suspendAuctionSchema,
  usdAmountSchema,
  validateStartingPriceAgainstArticle,
} from "@/modules/auctions/auction-schema";
import { POST as postAssignReviewRoute } from "@/app/api/admin/reviews/assign/route";
import { GET as getVerificationRoute } from "@/app/api/verification/route";
import { POST as postDecisionRoute } from "@/app/api/verification/[id]/decision/route";

const ADMIN_TOKEN = "1".repeat(64);
const VERIFIER_1_TOKEN = "2".repeat(64);
const VERIFIER_2_TOKEN = "3".repeat(64);
const SELLER_TOKEN = "4".repeat(64);

const USERS: Record<"admin" | "verifier1" | "verifier2" | "seller", MockUserRecord> = {
  admin: {
    id: "usr_admin_01",
    nombreCompleto: "Admin Subastas",
    email: "admin@pujafacil.test",
    status: "ACTIVA",
    roles: [{ role: "ADMIN_SUBASTAS" }],
  },
  verifier1: {
    id: "usr_verif_01",
    nombreCompleto: "Verificador Principal",
    email: "verificador1@pujafacil.test",
    status: "ACTIVA",
    roles: [{ role: "VERIFICADOR" }],
  },
  verifier2: {
    id: "usr_verif_02",
    nombreCompleto: "Verificador Secundario",
    email: "verificador2@pujafacil.test",
    status: "ACTIVA",
    roles: [{ role: "VERIFICADOR" }],
  },
  seller: {
    id: "usr_seller_01",
    nombreCompleto: "Vendedor Titular",
    email: "vendedor@pujafacil.test",
    status: "ACTIVA",
    roles: [{ role: "VENDEDOR" }],
  },
};

function buildApiRequest(
  method: string,
  url: string,
  options: { token?: string; body?: unknown; origin?: string } = {},
): Request {
  const headers = new Headers();
  if (options.token) {
    headers.set("cookie", `pf_session=${options.token}`);
  }
  if (method !== "GET") {
    headers.set("origin", options.origin ?? "http://localhost:3000");
    headers.set("content-type", "application/json");
  }
  return new Request(url, {
    method,
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
}

beforeEach(() => {
  vi.clearAllMocks();

  db.$queryRaw.mockResolvedValue([{ id: "locked" }]);
  db.$transaction.mockImplementation(async (fn: (tx: typeof db) => Promise<unknown>) => fn(db));

  const tokenToUser = new Map([
    [hashToken(ADMIN_TOKEN), USERS.admin],
    [hashToken(VERIFIER_1_TOKEN), USERS.verifier1],
    [hashToken(VERIFIER_2_TOKEN), USERS.verifier2],
    [hashToken(SELLER_TOKEN), USERS.seller],
  ]);

  db.session.findUnique.mockImplementation(
    async ({ where }: { where: { tokenHash: string } }) => {
      const user = tokenToUser.get(where.tokenHash);
      if (!user) return null;
      return {
        expiresAt: new Date(Date.now() + 3600_000),
        user,
      };
    },
  );

  const idToUser = new Map([
    [USERS.admin.id, USERS.admin],
    [USERS.verifier1.id, USERS.verifier1],
    [USERS.verifier2.id, USERS.verifier2],
    [USERS.seller.id, USERS.seller],
  ]);

  db.user.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => {
    return idToUser.get(where.id) ?? null;
  });

  db.auditEvent.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: "aud_01",
    createdAt: new Date("2026-11-15T12:00:00Z"),
    ...data,
  }));

  db.notification.create.mockImplementation(
    async ({ data }: { data: Record<string, unknown> }) => ({
      id: "notif_01",
      createdAt: new Date("2026-11-15T12:00:00Z"),
      readAt: null,
      ...data,
    }),
  );
});

describe("Antony — Validación de Revisiones (review-schema)", () => {
  it("acepta una asignación válida con articleId y verifierId", () => {
    const result = assignReviewSchema.safeParse({
      articleId: "art_12345",
      verifierId: "verif_67890",
    });
    expect(result.success).toBe(true);
  });

  it("rechaza asignación si faltan identificadores o están vacíos", () => {
    expect(assignReviewSchema.safeParse({ articleId: "", verifierId: "v1" }).success).toBe(false);
    expect(assignReviewSchema.safeParse({ articleId: "a1", verifierId: "   " }).success).toBe(false);
    expect(assignReviewSchema.safeParse({}).success).toBe(false);
  });

  it("acepta decisiones válidas (APROBADO, RECHAZADO, REQUIERE_CORRECCIONES) con observaciones entre 5 y 1000 caracteres", () => {
    for (const decision of ["APROBADO", "RECHAZADO", "REQUIERE_CORRECCIONES"] as const) {
      const parsed = decideReviewSchema.safeParse({
        decision,
        comments: "Documentación verificada conforme al certificado adjunto.",
      });
      expect(parsed.success).toBe(true);
    }
  });

  it("rechaza decisiones con observaciones menores a 5 caracteres o mayores a 1000", () => {
    const tooShort = decideReviewSchema.safeParse({
      decision: "APROBADO",
      comments: "Ok",
    });
    expect(tooShort.success).toBe(false);

    const tooLong = decideReviewSchema.safeParse({
      decision: "RECHAZADO",
      comments: "x".repeat(1001),
    });
    expect(tooLong.success).toBe(false);
  });

  it("impide que quien no sea ADMIN_SUBASTAS asigne verificadores o que el propietario sea su propio verificador", () => {
    const nonAdmin = validateReviewAssignmentRules({
      actorRoles: ["VENDEDOR"],
      verifierId: "user-verif",
      articleOwnerId: "user-owner",
    });
    expect(nonAdmin.ok).toBe(false);

    const ownerConflict = validateReviewAssignmentRules({
      actorRoles: ["ADMIN_SUBASTAS"],
      verifierId: "user-same",
      articleOwnerId: "user-same",
    });
    expect(ownerConflict.ok).toBe(false);

    const validAssign = validateReviewAssignmentRules({
      actorRoles: ["ADMIN_SUBASTAS"],
      verifierId: "user-verif",
      articleOwnerId: "user-owner",
    });
    expect(validAssign.ok).toBe(true);
  });

  it("impide que un verificador no asignado o el propietario emitan dictamen sobre el artículo", () => {
    const byOwner = validateReviewDecisionRules({
      actorId: "owner-1",
      assignedVerifierId: "owner-1",
      articleOwnerId: "owner-1",
    });
    expect(byOwner.ok).toBe(false);

    const byOtherVerifier = validateReviewDecisionRules({
      actorId: "verif-2",
      assignedVerifierId: "verif-1",
      articleOwnerId: "owner-1",
    });
    expect(byOtherVerifier.ok).toBe(false);

    const byAssignedVerifier = validateReviewDecisionRules({
      actorId: "verif-1",
      assignedVerifierId: "verif-1",
      articleOwnerId: "owner-1",
    });
    expect(byAssignedVerifier.ok).toBe(true);
  });
});

describe("Antony — Flujo Real de Verificación y Endpoints (Domingo 15/11)", () => {
  it("rechaza asignar un artículo en estado BORRADOR (409 ESTADO_ARTICULO_INVALIDO)", async () => {
    db.article.findUnique.mockResolvedValue({
      id: "art_borrador_01",
      ownerId: USERS.seller.id,
      title: "Artículo en Borrador",
      status: "BORRADOR",
    });

    const req = buildApiRequest("POST", "http://localhost:3000/api/admin/reviews/assign", {
      token: ADMIN_TOKEN,
      body: { articleId: "art_borrador_01", verifierId: USERS.verifier1.id },
    });

    const res = await postAssignReviewRoute(req);
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe("ESTADO_ARTICULO_INVALIDO");
    expect(db.review.create).not.toHaveBeenCalled();
  });

  it("permite a ADMIN_SUBASTAS asignar un artículo PENDIENTE_REVISION a un VERIFICADOR activo y audita sin PII (201)", async () => {
    db.article.findUnique.mockResolvedValue({
      id: "art_pendiente_01",
      ownerId: USERS.seller.id,
      title: "Reloj Suizo de Colección",
      status: "PENDIENTE_REVISION",
    });
    db.review.findFirst.mockResolvedValue(null);
    db.review.create.mockResolvedValue({
      id: "rev_001",
      articleId: "art_pendiente_01",
      verifierId: USERS.verifier1.id,
      status: null,
      comments: null,
      assignedAt: new Date("2026-11-15T14:00:00Z"),
      decidedAt: null,
    });

    const req = buildApiRequest("POST", "http://localhost:3000/api/admin/reviews/assign", {
      token: ADMIN_TOKEN,
      body: { articleId: "art_pendiente_01", verifierId: USERS.verifier1.id },
    });

    const res = await postAssignReviewRoute(req);
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.ok).toBe(true);
    expect(json.data.review.id).toBe("rev_001");
    expect(db.auditEvent.create).toHaveBeenCalledOnce();
    expect(db.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: USERS.verifier1.id,
          type: "REVISION_ASIGNADA",
        }),
      }),
    );
  });

  it("impide que un usuario sin rol ADMIN_SUBASTAS asigne revisiones (403) o que exista doble asignación abierta (409)", async () => {
    const sellerReq = buildApiRequest("POST", "http://localhost:3000/api/admin/reviews/assign", {
      token: SELLER_TOKEN,
      body: { articleId: "art_pendiente_01", verifierId: USERS.verifier1.id },
    });
    const sellerRes = await postAssignReviewRoute(sellerReq);
    expect(sellerRes.status).toBe(403);

    db.article.findUnique.mockResolvedValue({
      id: "art_pendiente_01",
      ownerId: USERS.seller.id,
      title: "Reloj Suizo de Colección",
      status: "PENDIENTE_REVISION",
    });
    db.review.findFirst.mockResolvedValue({ id: "rev_abierta_existente" });

    await expect(
      assignReview(USERS.admin.id, {
        articleId: "art_pendiente_01",
        verifierId: USERS.verifier1.id,
      }),
    ).rejects.toMatchObject({
      status: 409,
      code: "REVISION_YA_ABIERTA",
    });
  });

  it("impide que un verificador ajeno vea expedientes de otro verificador o consulte su ficha (403)", async () => {
    db.review.findMany.mockResolvedValue([]);

    const getReq = buildApiRequest("GET", "http://localhost:3000/api/verification", {
      token: VERIFIER_2_TOKEN,
    });
    const getRes = await getVerificationRoute(getReq);
    const getJson = await getRes.json();

    expect(getRes.status).toBe(200);
    expect(getJson.ok).toBe(true);
    expect(getJson.data.items).toHaveLength(0);
    expect(db.review.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { verifierId: USERS.verifier2.id },
      }),
    );

    db.review.findUnique.mockResolvedValue({
      id: "rev_asignada_v1",
      articleId: "art_pendiente_01",
      verifierId: USERS.verifier1.id,
      status: null,
      comments: null,
      assignedAt: new Date("2026-11-15T14:00:00Z"),
      decidedAt: null,
      article: {
        id: "art_pendiente_01",
        ownerId: USERS.seller.id,
        title: "Reloj Suizo",
        description: "Descripción reservada",
        category: "Relojes",
        condition: "Excelente",
        provenance: "Colección privada",
        initialPrice: new Prisma.Decimal("500.00"),
        status: "PENDIENTE_REVISION",
        files: [],
      },
    });

    await expect(
      getAssignedReviewById(USERS.verifier2.id, "rev_asignada_v1"),
    ).rejects.toMatchObject({
      status: 403,
      code: "VERIFICADOR_NO_ASIGNADO",
    } satisfies Partial<ReviewServiceError>);

    const wrongVerifierDecisionReq = buildApiRequest(
      "POST",
      "http://localhost:3000/api/verification/rev_asignada_v1/decision",
      {
        token: VERIFIER_2_TOKEN,
        body: {
          decision: "APROBADO",
          comments: "Intento de aprobar expediente asignado a otro verificador.",
        },
      },
    );
    const wrongVerifierRes = await postDecisionRoute(wrongVerifierDecisionReq, {
      params: Promise.resolve({ id: "rev_asignada_v1" }),
    });
    expect(wrongVerifierRes.status).toBe(403);
  });

  it("listAssignedReviews devuelve la bandeja del verificador sin exponer datos personales del vendedor", async () => {
    db.review.findMany.mockResolvedValue([
      {
        id: "rev_001",
        articleId: "art_pendiente_01",
        status: null,
        comments: null,
        assignedAt: new Date("2026-11-15T14:00:00Z"),
        decidedAt: null,
        article: {
          id: "art_pendiente_01",
          title: "Pintura Colonial",
          category: "Arte",
          condition: "Buen estado",
          provenance: "Galería quiteña",
          initialPrice: new Prisma.Decimal("950.00"),
          status: "PENDIENTE_REVISION",
          files: [
            {
              id: "file_foto_1",
              kind: "FOTO",
              mimeType: "image/jpeg",
              originalName: "archivo.jpg",
              size: 20480,
              createdAt: new Date("2026-11-15T13:50:00Z"),
            },
          ],
        },
      },
    ]);

    const list = await listAssignedReviews(USERS.verifier1.id);
    expect(list).toHaveLength(1);
    expect(list[0].initialPrice).toBe("950.00");
    expect(list[0].photosCount).toBe(1);
    expect(JSON.stringify(list[0])).not.toContain("ownerId");
    expect(JSON.stringify(list[0])).not.toContain("vendedor@pujafacil.test");
  });

  it("el dictamen APROBADO actualiza Article.status a APROBADO (habilitando publicación) e impide volver a decidir la misma tarea (409)", async () => {
    db.review.findUnique.mockResolvedValueOnce({
      id: "rev_001",
      articleId: "art_pendiente_01",
      verifierId: USERS.verifier1.id,
      status: null,
      decidedAt: null,
      article: {
        id: "art_pendiente_01",
        ownerId: USERS.seller.id,
        title: "Reloj Suizo de Colección",
        status: "PENDIENTE_REVISION",
      },
    });
    db.article.findUnique.mockResolvedValueOnce({
      id: "art_pendiente_01",
      ownerId: USERS.seller.id,
      title: "Reloj Suizo de Colección",
      status: "PENDIENTE_REVISION",
    });
    db.review.update.mockResolvedValueOnce({
      id: "rev_001",
      articleId: "art_pendiente_01",
      verifierId: USERS.verifier1.id,
      status: "APROBADO",
      comments: "Fotografías nítidas y certificado de autenticidad verificado.",
      assignedAt: new Date("2026-11-15T14:00:00Z"),
      decidedAt: new Date("2026-11-15T15:00:00Z"),
    });
    db.article.update.mockResolvedValueOnce({
      id: "art_pendiente_01",
      status: "APROBADO",
    });

    const req = buildApiRequest(
      "POST",
      "http://localhost:3000/api/verification/rev_001/decision",
      {
        token: VERIFIER_1_TOKEN,
        body: {
          decision: "APROBADO",
          comments: "Fotografías nítidas y certificado de autenticidad verificado.",
        },
      },
    );

    const res = await postDecisionRoute(req, { params: Promise.resolve({ id: "rev_001" }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.data.articleStatus).toBe("APROBADO");
    expect(db.article.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "art_pendiente_01" },
        data: { status: "APROBADO" },
      }),
    );
    expect(db.auditEvent.create).toHaveBeenCalledOnce();

    // Segundo intento sobre la misma revisión ya decidida debe fallar con 409
    db.review.findUnique.mockResolvedValueOnce({
      id: "rev_001",
      articleId: "art_pendiente_01",
      verifierId: USERS.verifier1.id,
      status: "APROBADO",
      decidedAt: new Date("2026-11-15T15:00:00Z"),
      article: {
        id: "art_pendiente_01",
        ownerId: USERS.seller.id,
        title: "Reloj Suizo de Colección",
        status: "APROBADO",
      },
    });

    const secondRes = await postDecisionRoute(
      buildApiRequest("POST", "http://localhost:3000/api/verification/rev_001/decision", {
        token: VERIFIER_1_TOKEN,
        body: {
          decision: "RECHAZADO",
          comments: "Intento de modificar dictamen ya cerrado.",
        },
      }),
      { params: Promise.resolve({ id: "rev_001" }) },
    );
    const secondJson = await secondRes.json();

    expect(secondRes.status).toBe(409);
    expect(secondJson.error.code).toBe("REVISION_YA_DECIDIDA");
  });

  it("el dictamen REQUIERE_CORRECCIONES cambia el artículo a REQUIERE_CORRECCIONES y permite nueva asignación tras corrección del vendedor", async () => {
    db.review.findUnique.mockResolvedValueOnce({
      id: "rev_corr_01",
      articleId: "art_corr_01",
      verifierId: USERS.verifier1.id,
      status: null,
      decidedAt: null,
      article: {
        id: "art_corr_01",
        ownerId: USERS.seller.id,
        title: "Violín Antiguo",
        status: "PENDIENTE_REVISION",
      },
    });
    db.article.findUnique.mockResolvedValueOnce({
      id: "art_corr_01",
      ownerId: USERS.seller.id,
      title: "Violín Antiguo",
      status: "PENDIENTE_REVISION",
    });
    db.review.update.mockResolvedValueOnce({
      id: "rev_corr_01",
      articleId: "art_corr_01",
      verifierId: USERS.verifier1.id,
      status: "REQUIERE_CORRECCIONES",
      comments: "Por favor adjuntar fotografía del sello interior del luthier.",
      assignedAt: new Date("2026-11-15T14:00:00Z"),
      decidedAt: new Date("2026-11-15T15:10:00Z"),
    });
    db.article.update.mockResolvedValueOnce({
      id: "art_corr_01",
      status: "REQUIERE_CORRECCIONES",
    });

    const result = await decideReview(USERS.verifier1.id, "rev_corr_01", {
      decision: "REQUIERE_CORRECCIONES",
      comments: "Por favor adjuntar fotografía del sello interior del luthier.",
    });

    expect(result.articleStatus).toBe("REQUIERE_CORRECCIONES");
    expect(result.review.status).toBe("REQUIERE_CORRECCIONES");

    // Cuando el vendedor corrige y reenvía el artículo a PENDIENTE_REVISION, se puede asignar nueva revisión
    db.article.findUnique.mockResolvedValueOnce({
      id: "art_corr_01",
      ownerId: USERS.seller.id,
      title: "Violín Antiguo Corregido",
      status: "PENDIENTE_REVISION",
    });
    db.review.findFirst.mockResolvedValueOnce(null);
    db.review.create.mockResolvedValueOnce({
      id: "rev_corr_02",
      articleId: "art_corr_01",
      verifierId: USERS.verifier1.id,
      status: null,
      comments: null,
      assignedAt: new Date("2026-11-15T16:00:00Z"),
      decidedAt: null,
    });

    const reassigned = await assignReview(USERS.admin.id, {
      articleId: "art_corr_01",
      verifierId: USERS.verifier1.id,
    });
    expect(reassigned.id).toBe("rev_corr_02");
  });
});

describe("Antony — Validación de Subastas (auction-schema)", () => {
  it("valida importes en USD como string con exactamente dos decimales y mayores que 0.00", () => {
    expect(usdAmountSchema.safeParse("120.00").success).toBe(true);
    expect(usdAmountSchema.safeParse("0.50").success).toBe(true);
    expect(usdAmountSchema.safeParse("0.00").success).toBe(false);
    expect(usdAmountSchema.safeParse("-10.00").success).toBe(false);
    expect(usdAmountSchema.safeParse("120").success).toBe(false);
    expect(usdAmountSchema.safeParse("120.5").success).toBe(false);
    expect(usdAmountSchema.safeParse("120.555").success).toBe(false);
  });

  it("acepta programación de subasta con fechas ISO coherentes (opensAt < closesAt)", () => {
    const valid = createAuctionSchema.safeParse({
      articleId: "art-aprob-001",
      startingPrice: "1250.00",
      minIncrement: "50.00",
      opensAt: "2026-11-16T10:00:00Z",
      closesAt: "2026-11-17T18:00:00Z",
    });
    expect(valid.success).toBe(true);
  });

  it("rechaza programación de subasta cuando opensAt es igual o posterior a closesAt", () => {
    const sameDate = createAuctionSchema.safeParse({
      articleId: "art-aprob-001",
      startingPrice: "1250.00",
      minIncrement: "50.00",
      opensAt: "2026-11-16T10:00:00Z",
      closesAt: "2026-11-16T10:00:00Z",
    });
    expect(sameDate.success).toBe(false);

    const inverted = createAuctionSchema.safeParse({
      articleId: "art-aprob-001",
      startingPrice: "1250.00",
      minIncrement: "50.00",
      opensAt: "2026-11-18T10:00:00Z",
      closesAt: "2026-11-17T18:00:00Z",
    });
    expect(inverted.success).toBe(false);
  });

  it("verifica que el precio inicial de la subasta no sea menor al initialPrice aprobado del artículo", () => {
    const lower = validateStartingPriceAgainstArticle("119.99", "120.00");
    expect(lower.ok).toBe(false);

    const equal = validateStartingPriceAgainstArticle("120.00", "120.00");
    expect(equal.ok).toBe(true);

    const higher = validateStartingPriceAgainstArticle("150.00", "120.00");
    expect(higher.ok).toBe(true);
  });

  it("exige motivo de al menos 5 caracteres para suspender una subasta", () => {
    expect(suspendAuctionSchema.safeParse({ reason: "No" }).success).toBe(false);
    expect(
      suspendAuctionSchema.safeParse({ reason: "Inconsistencia detectada en anexo documental." })
        .success,
    ).toBe(true);
  });

  it("determina si una subasta está en ventana activa usando la hora del servidor", () => {
    const opensAt = new Date("2026-11-16T10:00:00Z");
    const closesAt = new Date("2026-11-16T18:00:00Z");

    expect(
      isWithinServerAuctionWindow(opensAt, closesAt, new Date("2026-11-16T09:59:59Z")),
    ).toBe(false);
    expect(
      isWithinServerAuctionWindow(opensAt, closesAt, new Date("2026-11-16T12:00:00Z")),
    ).toBe(true);
    expect(
      isWithinServerAuctionWindow(opensAt, closesAt, new Date("2026-11-16T18:00:00Z")),
    ).toBe(false);
  });
});

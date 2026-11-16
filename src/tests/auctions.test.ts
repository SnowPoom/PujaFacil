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
    count: vi.fn(),
  },
  review: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  auction: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  bid: {
    count: vi.fn(),
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
import {
  activateAuction,
  AuctionServiceError,
  createAuction,
  getAdminDashboardSummary,
  getPublicAuction,
  listSellerAuctions,
} from "@/modules/auctions/auction-service";
import { POST as postAssignReviewRoute } from "@/app/api/admin/reviews/assign/route";
import { GET as getVerificationRoute } from "@/app/api/verification/route";
import { POST as postDecisionRoute } from "@/app/api/verification/[id]/decision/route";
import {
  GET as getAuctionsRoute,
  POST as postCreateAuctionRoute,
} from "@/app/api/auctions/route";
import { GET as getAuctionDetailRoute } from "@/app/api/auctions/[id]/route";
import { POST as postActivateAuctionRoute } from "@/app/api/admin/auctions/[id]/activate/route";
import { POST as postSuspendAuctionRoute } from "@/app/api/admin/auctions/[id]/suspend/route";

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

describe("Antony — Flujo Comercial de Subastas, Supervisión y Contratos Públicos (auction-service + API)", () => {
  const SERVER_REF_NOW = new Date("2026-11-16T08:00:00Z");

  it("no permite programar un artículo que no esté en estado APROBADO (BORRADOR / PENDIENTE_REVISION)", async () => {
    db.article.findUnique.mockResolvedValueOnce({
      id: "art_unapproved_01",
      ownerId: USERS.seller.id,
      title: "Escultura en Borrador",
      category: "Escultura",
      initialPrice: new Prisma.Decimal("500.00"),
      status: "PENDIENTE_REVISION",
    });

    await expect(
      createAuction(
        USERS.admin.id,
        {
          articleId: "art_unapproved_01",
          startingPrice: "550.00",
          minIncrement: "25.00",
          opensAt: "2026-11-16T12:00:00Z",
          closesAt: "2026-11-17T18:00:00Z",
        },
        SERVER_REF_NOW,
      ),
    ).rejects.toMatchObject({
      status: 409,
      code: "ARTICULO_NO_APROBADO",
    } satisfies Partial<AuctionServiceError>);

    expect(db.auction.create).not.toHaveBeenCalled();
  });

  it("no permite programar una segunda subasta simultánea para el mismo artículo", async () => {
    db.article.findUnique.mockResolvedValueOnce({
      id: "art_approved_sim",
      ownerId: USERS.seller.id,
      title: "Reloj de Bolsillo",
      category: "Relojería",
      initialPrice: new Prisma.Decimal("400.00"),
      status: "APROBADO",
    });
    db.auction.findFirst.mockResolvedValueOnce({
      id: "auc_existing_01",
      status: "PROGRAMADA",
    });

    await expect(
      createAuction(
        USERS.admin.id,
        {
          articleId: "art_approved_sim",
          startingPrice: "400.00",
          minIncrement: "20.00",
          opensAt: "2026-11-16T12:00:00Z",
          closesAt: "2026-11-17T18:00:00Z",
        },
        SERVER_REF_NOW,
      ),
    ).rejects.toMatchObject({
      status: 409,
      code: "SUBASTA_SIMULTANEA_EXISTENTE",
    } satisfies Partial<AuctionServiceError>);
  });

  it("rechaza programación con fecha inválida, incremento cero o precio inicial menor al aprobado", async () => {
    // 1. Incremento cero
    await expect(
      createAuction(
        USERS.admin.id,
        {
          articleId: "art_aprob_01",
          startingPrice: "500.00",
          minIncrement: "0.00",
          opensAt: "2026-11-16T12:00:00Z",
          closesAt: "2026-11-17T18:00:00Z",
        },
        SERVER_REF_NOW,
      ),
    ).rejects.toThrow();

    // 2. Fecha inválida (opensAt >= closesAt)
    await expect(
      createAuction(
        USERS.admin.id,
        {
          articleId: "art_aprob_01",
          startingPrice: "500.00",
          minIncrement: "10.00",
          opensAt: "2026-11-17T18:00:00Z",
          closesAt: "2026-11-16T12:00:00Z",
        },
        SERVER_REF_NOW,
      ),
    ).rejects.toThrow();

    // 3. Precio de salida menor al initialPrice aprobado del artículo
    db.article.findUnique.mockResolvedValueOnce({
      id: "art_aprob_01",
      ownerId: USERS.seller.id,
      title: "Pintura Colonial",
      category: "Arte",
      initialPrice: new Prisma.Decimal("800.00"),
      status: "APROBADO",
    });
    db.auction.findFirst.mockResolvedValueOnce(null);

    await expect(
      createAuction(
        USERS.admin.id,
        {
          articleId: "art_aprob_01",
          startingPrice: "750.00",
          minIncrement: "25.00",
          opensAt: "2026-11-16T12:00:00Z",
          closesAt: "2026-11-17T18:00:00Z",
        },
        SERVER_REF_NOW,
      ),
    ).rejects.toMatchObject({
      status: 400,
      code: "PRECIO_INICIAL_MENOR_AL_APROBADO",
    } satisfies Partial<AuctionServiceError>);
  });

  it("rechaza que el propietario (VENDEDOR) o un VERIFICADOR programen, activen o suspendan subastas", async () => {
    await expect(
      createAuction(
        USERS.seller.id,
        {
          articleId: "art_aprob_01",
          startingPrice: "800.00",
          minIncrement: "25.00",
          opensAt: "2026-11-16T12:00:00Z",
          closesAt: "2026-11-17T18:00:00Z",
        },
        SERVER_REF_NOW,
      ),
    ).rejects.toMatchObject({
      status: 403,
      code: "ROL_NO_PERMITIDO",
    } satisfies Partial<AuctionServiceError>);

    const sellerCreateRes = await postCreateAuctionRoute(
      buildApiRequest("POST", "http://localhost:3000/api/auctions", {
        token: SELLER_TOKEN,
        body: {
          articleId: "art_aprob_01",
          startingPrice: "800.00",
          minIncrement: "25.00",
          opensAt: "2026-11-16T12:00:00Z",
          closesAt: "2026-11-17T18:00:00Z",
        },
      }),
    );
    expect(sellerCreateRes.status).toBe(403);

    const verifierActivateRes = await postActivateAuctionRoute(
      buildApiRequest("POST", "http://localhost:3000/api/admin/auctions/auc_01/activate", {
        token: VERIFIER_1_TOKEN,
      }),
      { params: Promise.resolve({ id: "auc_01" }) },
    );
    expect(verifierActivateRes.status).toBe(403);
  });

  it("nunca admite buyerId, status='ADJUDICADA' ni winnerBidId procedentes del cliente en POST /api/auctions", async () => {
    for (const forbiddenPayload of [
      {
        articleId: "art_aprob_01",
        startingPrice: "800.00",
        minIncrement: "25.00",
        opensAt: "2026-11-16T12:00:00Z",
        closesAt: "2026-11-17T18:00:00Z",
        buyerId: "usr_buyer_hacked",
      },
      {
        articleId: "art_aprob_01",
        startingPrice: "800.00",
        minIncrement: "25.00",
        opensAt: "2026-11-16T12:00:00Z",
        closesAt: "2026-11-17T18:00:00Z",
        status: "ADJUDICADA",
      },
      {
        articleId: "art_aprob_01",
        startingPrice: "800.00",
        minIncrement: "25.00",
        opensAt: "2026-11-16T12:00:00Z",
        closesAt: "2026-11-17T18:00:00Z",
        winnerBidId: "bid_hacked_01",
      },
    ]) {
      const res = await postCreateAuctionRoute(
        buildApiRequest("POST", "http://localhost:3000/api/auctions", {
          token: ADMIN_TOKEN,
          body: forbiddenPayload,
        }),
      );
      const json = await res.json();
      expect(res.status).toBe(400);
      expect(json.ok).toBe(false);
      expect(json.error.code).toBe("CAMPOS_PROHIBIDOS_CLIENTE");
    }
  });

  it("permite a ADMIN_SUBASTAS programar subasta de artículo APROBADO, marcando Article.status=ASOCIADO_SUBASTA y auditando sin PII", async () => {
    db.article.findUnique.mockResolvedValueOnce({
      id: "art_aprob_ok",
      ownerId: USERS.seller.id,
      title: "Astrolabio de Latón Grabado",
      category: "Instrumentos Científicos",
      initialPrice: new Prisma.Decimal("950.00"),
      status: "APROBADO",
    });
    db.auction.findFirst.mockResolvedValueOnce(null);
    db.auction.create.mockResolvedValueOnce({
      id: "auc_created_01",
      articleId: "art_aprob_ok",
      startingPrice: new Prisma.Decimal("1000.00"),
      minIncrement: new Prisma.Decimal("50.00"),
      opensAt: new Date("2026-11-20T12:00:00Z"),
      closesAt: new Date("2026-11-22T18:00:00Z"),
      status: "PROGRAMADA",
      createdAt: new Date("2026-11-16T08:00:00Z"),
    });
    db.article.update.mockResolvedValueOnce({
      id: "art_aprob_ok",
      status: "ASOCIADO_SUBASTA",
    });

    const response = await postCreateAuctionRoute(
      buildApiRequest("POST", "http://localhost:3000/api/auctions", {
        token: ADMIN_TOKEN,
        body: {
          articleId: "art_aprob_ok",
          startingPrice: "1000.00",
          minIncrement: "50.00",
          opensAt: "2026-11-20T12:00:00Z",
          closesAt: "2026-11-22T18:00:00Z",
        },
      }),
    );

    const body = await response.json();
    expect(response.status).toBe(201);
    expect(body.ok).toBe(true);
    expect(body.data.id).toBe("auc_created_01");
    expect(body.data.status).toBe("PROGRAMADA");
    expect(body.data.startingPrice).toBe("1000.00");
    expect(body.data.minIncrement).toBe("50.00");

    expect(db.article.update).toHaveBeenCalledWith({
      where: { id: "art_aprob_ok" },
      data: { status: "ASOCIADO_SUBASTA" },
    });
    expect(db.auditEvent.create).toHaveBeenCalledTimes(1);
    const auditSerialized = JSON.stringify(db.auditEvent.create.mock.calls[0]?.[0]);
    expect(auditSerialized).not.toContain(USERS.seller.email);
    expect(auditSerialized).not.toContain(USERS.seller.nombreCompleto);
  });

  it("valida la activación con el reloj del servidor y suspende con motivo obligatorio", async () => {
    const opensAt = new Date("2026-11-16T14:00:00Z");
    const closesAt = new Date("2026-11-17T14:00:00Z");

    // 1. Intento de activar ANTES de opensAt -> 409 APERTURA_NO_ALCANZADA
    db.auction.findUnique.mockResolvedValueOnce({
      id: "auc_prog_01",
      articleId: "art_aprob_ok",
      startingPrice: new Prisma.Decimal("1000.00"),
      minIncrement: new Prisma.Decimal("50.00"),
      opensAt,
      closesAt,
      status: "PROGRAMADA",
      article: {
        id: "art_aprob_ok",
        title: "Astrolabio de Latón Grabado",
        category: "Instrumentos Científicos",
        status: "ASOCIADO_SUBASTA",
      },
      bids: [],
      _count: { bids: 0 },
    });

    await expect(
      activateAuction(USERS.admin.id, "auc_prog_01", new Date("2026-11-16T13:59:00Z")),
    ).rejects.toMatchObject({
      status: 409,
      code: "APERTURA_NO_ALCANZADA",
    } satisfies Partial<AuctionServiceError>);

    // 2. Activación dentro de la ventana oficial -> 200 ACTIVA
    db.auction.findUnique.mockResolvedValueOnce({
      id: "auc_prog_01",
      articleId: "art_aprob_ok",
      startingPrice: new Prisma.Decimal("1000.00"),
      minIncrement: new Prisma.Decimal("50.00"),
      opensAt,
      closesAt,
      status: "PROGRAMADA",
      article: {
        id: "art_aprob_ok",
        title: "Astrolabio de Latón Grabado",
        category: "Instrumentos Científicos",
        status: "ASOCIADO_SUBASTA",
      },
      bids: [],
      _count: { bids: 0 },
    });
    db.auction.update.mockResolvedValueOnce({
      id: "auc_prog_01",
      articleId: "art_aprob_ok",
      startingPrice: new Prisma.Decimal("1000.00"),
      minIncrement: new Prisma.Decimal("50.00"),
      opensAt,
      closesAt,
      status: "ACTIVA",
    });

    const activated = await activateAuction(
      USERS.admin.id,
      "auc_prog_01",
      new Date("2026-11-16T14:05:00Z"),
    );
    expect(activated.status).toBe("ACTIVA");

    // 3. Suspensión sin motivo válido -> 400
    const badSuspendRes = await postSuspendAuctionRoute(
      buildApiRequest("POST", "http://localhost:3000/api/admin/auctions/auc_prog_01/suspend", {
        token: ADMIN_TOKEN,
        body: { reason: "abc" },
      }),
      { params: Promise.resolve({ id: "auc_prog_01" }) },
    );
    expect(badSuspendRes.status).toBe(400);

    // 4. Suspensión con motivo obligatorio -> 200 SUSPENDIDA
    db.auction.findUnique.mockResolvedValueOnce({
      id: "auc_prog_01",
      articleId: "art_aprob_ok",
      startingPrice: new Prisma.Decimal("1000.00"),
      minIncrement: new Prisma.Decimal("50.00"),
      opensAt,
      closesAt,
      status: "ACTIVA",
      article: {
        id: "art_aprob_ok",
        ownerId: USERS.seller.id,
        title: "Astrolabio de Latón Grabado",
        category: "Instrumentos Científicos",
      },
      bids: [{ amount: new Prisma.Decimal("1050.00") }],
      _count: { bids: 1 },
    });
    db.auction.update.mockResolvedValueOnce({
      id: "auc_prog_01",
      articleId: "art_aprob_ok",
      startingPrice: new Prisma.Decimal("1000.00"),
      minIncrement: new Prisma.Decimal("50.00"),
      opensAt,
      closesAt,
      status: "SUSPENDIDA",
    });

    const okSuspendRes = await postSuspendAuctionRoute(
      buildApiRequest("POST", "http://localhost:3000/api/admin/auctions/auc_prog_01/suspend", {
        token: ADMIN_TOKEN,
        body: { reason: "Verificación suplementaria del certificado de procedencia." },
      }),
      { params: Promise.resolve({ id: "auc_prog_01" }) },
    );
    const okSuspendJson = await okSuspendRes.json();
    expect(okSuspendRes.status).toBe(200);
    expect(okSuspendJson.data.status).toBe("SUSPENDIDA");
    expect(okSuspendJson.data.highestBid).toBe("1050.00");
  });

  it("GET /api/auctions/[id] devuelve exactamente el contrato acordado con Kevin y winnerAlias sin PII", async () => {
    db.auction.findUnique.mockResolvedValueOnce({
      id: "auc_public_01",
      status: "ADJUDICADA",
      startingPrice: new Prisma.Decimal("900.00"),
      minIncrement: new Prisma.Decimal("25.00"),
      opensAt: new Date("2026-11-14T18:00:00.000Z"),
      closesAt: new Date("2026-11-15T18:00:00.000Z"),
      winnerBidId: "bid_win_01",
      article: {
        id: "art_public_01",
        title: "Mapa Cartográfico Antiguo de Quito (1748)",
        category: "Cartografía e Historia",
        description: "Grabado calcográfico original verificado por especialista.",
        files: [{ id: "file_photo_01" }, { id: "file_photo_02" }],
      },
      bids: [
        { id: "bid_win_01", buyerId: "usr_buyer_secret_01", amount: new Prisma.Decimal("1125.00") },
        { id: "bid_02", buyerId: "usr_buyer_secret_02", amount: new Prisma.Decimal("950.00") },
      ],
      aliases: [
        { userId: "usr_buyer_secret_01", alias: "Postor-8f9a1b" },
        { userId: "usr_buyer_secret_02", alias: "Postor-2c3d4e" },
      ],
    });

    const response = await getAuctionDetailRoute(
      buildApiRequest("GET", "http://localhost:3000/api/auctions/auc_public_01"),
      { params: Promise.resolve({ id: "auc_public_01" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      ok: true,
      data: {
        id: "auc_public_01",
        article: {
          id: "art_public_01",
          title: "Mapa Cartográfico Antiguo de Quito (1748)",
          category: "Cartografía e Historia",
          description: "Grabado calcográfico original verificado por especialista.",
          photoFileIds: ["file_photo_01", "file_photo_02"],
        },
        status: "ADJUDICADA",
        startingPrice: "900.00",
        minIncrement: "25.00",
        opensAt: "2026-11-14T18:00:00.000Z",
        closesAt: "2026-11-15T18:00:00.000Z",
        highestBid: "1125.00",
        bidCount: 2,
        winnerAlias: "Postor-8f9a1b",
      },
    });

    const rawText = JSON.stringify(body);
    expect(rawText).not.toContain("usr_buyer_secret_01");
    expect(rawText).not.toContain("usr_buyer_secret_02");
    expect(rawText).not.toContain("ownerId");
    expect(rawText).not.toContain("buyerId");
    expect(rawText).not.toContain("email");
    expect(rawText).not.toContain("cedula");
  });

  it("GET /api/auctions lista subastas públicas, rechaza filtro BORRADOR y oculta identidades en seguimiento de vendedor", async () => {
    db.auction.findMany.mockResolvedValueOnce([
      {
        id: "auc_pub_list_01",
        articleId: "art_public_01",
        status: "ACTIVA",
        startingPrice: new Prisma.Decimal("900.00"),
        minIncrement: new Prisma.Decimal("25.00"),
        opensAt: new Date("2026-11-14T18:00:00.000Z"),
        closesAt: new Date("2026-11-17T18:00:00.000Z"),
        winnerBidId: null,
        article: {
          id: "art_public_01",
          title: "Mapa Cartográfico Antiguo de Quito (1748)",
          category: "Cartografía",
          files: [{ id: "file_photo_01" }],
        },
        bids: [{ id: "bid_01", buyerId: "usr_buyer_secret_01", amount: new Prisma.Decimal("950.00") }],
        aliases: [{ userId: "usr_buyer_secret_01", alias: "Postor-8f9a1b" }],
      },
    ]);
    db.auction.count.mockResolvedValueOnce(1);

    const listRes = await getAuctionsRoute(
      buildApiRequest("GET", "http://localhost:3000/api/auctions?status=ACTIVA&q=Quito&page=1"),
    );
    const listBody = await listRes.json();
    expect(listRes.status).toBe(200);
    expect(listBody.ok).toBe(true);
    expect(listBody.data.items).toHaveLength(1);
    expect(listBody.data.items[0].highestBid).toBe("950.00");
    expect(listBody.data.items[0].winnerAlias).toBeUndefined();

    // Rechaza consultar estado BORRADOR en endpoint público
    const draftFilterRes = await getAuctionsRoute(
      buildApiRequest("GET", "http://localhost:3000/api/auctions?status=BORRADOR"),
    );
    expect(draftFilterRes.status).toBe(400);

    // Rechaza detalle de subasta en estado BORRADOR con 404
    db.auction.findUnique.mockResolvedValueOnce({
      id: "auc_draft_hidden",
      status: "BORRADOR",
      startingPrice: new Prisma.Decimal("100.00"),
      minIncrement: new Prisma.Decimal("10.00"),
      opensAt: new Date("2026-11-16T10:00:00Z"),
      closesAt: new Date("2026-11-17T10:00:00Z"),
      winnerBidId: null,
      article: {
        id: "art_01",
        title: "Oculto",
        category: "Arte",
        description: "Texto",
        files: [],
      },
      bids: [],
      aliases: [],
    });
    await expect(getPublicAuction("auc_draft_hidden")).rejects.toMatchObject({
      status: 404,
      code: "SUBASTA_NO_ENCONTRADA",
    });

    // Verifica que listSellerAuctions y getAdminDashboardSummary operen sin exponer PII
    db.auction.findMany.mockResolvedValueOnce([
      {
        id: "auc_seller_01",
        articleId: "art_seller_01",
        startingPrice: new Prisma.Decimal("450.00"),
        minIncrement: new Prisma.Decimal("20.00"),
        opensAt: new Date("2026-11-10T12:00:00.000Z"),
        closesAt: new Date("2026-11-12T18:00:00.000Z"),
        status: "ADJUDICADA",
        winnerBidId: "bid_w_01",
        article: {
          title: "Juego de Té de Plata",
          category: "Platería",
        },
        bids: [{ id: "bid_w_01", buyerId: "usr_buyer_secret_99", amount: new Prisma.Decimal("620.00") }],
        aliases: [{ userId: "usr_buyer_secret_99", alias: "Postor-A84F" }],
      },
    ]);
    const sellerAuctions = await listSellerAuctions(USERS.seller.id);
    expect(sellerAuctions).toHaveLength(1);
    expect(sellerAuctions[0]?.winnerAlias).toBe("Postor-A84F");
    expect(JSON.stringify(sellerAuctions)).not.toContain("usr_buyer_secret_99");

    db.article.count.mockResolvedValueOnce(2);
    db.auction.count.mockResolvedValueOnce(3).mockResolvedValueOnce(1);
    db.bid.count.mockResolvedValueOnce(14);
    const summary = await getAdminDashboardSummary();
    expect(summary).toEqual({
      pendingArticlesCount: 2,
      scheduledAuctionsCount: 3,
      activeAuctionsCount: 1,
      validBidsCount: 14,
    });
  });
});

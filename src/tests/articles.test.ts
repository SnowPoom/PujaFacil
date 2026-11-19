import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

/* ================================================================== *
 *  PujaFácil — Suite de Pruebas Unitarias para Artículos             *
 *  Cubre: article-schema.ts, article-service.ts y Route Handlers     *
 * ================================================================== */

// ─── 0. Mock unitario de Prisma ──────────────────────────────────────
const db = vi.hoisted(() => ({
  article: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  fileRecord: {
    count: vi.fn(),
    deleteMany: vi.fn(),
  },
  auction: {
    count: vi.fn(),
  },
  review: {
    count: vi.fn(),
  },
  session: {
    findUnique: vi.fn(),
    create: vi.fn(),
    deleteMany: vi.fn(),
  },
  user: {
    findUnique: vi.fn(),
  },
  $transaction: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: db }));
const uploadMocks = vi.hoisted(() => ({ cleanup: vi.fn() }));
vi.mock("@/lib/uploads", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/uploads")>(),
  deleteFilesForDraft: uploadMocks.cleanup,
}));

// ─── Imports de módulos bajo prueba ─────────────────────────────────
import {
  articleInputSchema,
  articleUpdateSchema,
  articleListQuerySchema,
  type ArticleInput,
} from "@/modules/articles/article-schema";
import {
  ArticleServiceError,
  listOwnArticles,
  getOwnArticle,
  createDraft,
  updateDraft,
  deleteDraft,
  submitForReview,
} from "@/modules/articles/article-service";
import { GET as getArticlesRoute, POST as postArticlesRoute } from "@/app/api/articles/route";
import {
  GET as getArticleByIdRoute,
  PATCH as patchArticleByIdRoute,
  DELETE as deleteArticleByIdRoute,
} from "@/app/api/articles/[id]/route";
import { POST as submitArticleRoute } from "@/app/api/articles/[id]/submit/route";
import { GET as getPublicArticlesRoute } from "@/app/api/public/articles/route";

// ─── Helpers y Fixtures para Pruebas ────────────────────────────────
const VALID_INPUT: ArticleInput = {
  title: "Reloj antiguo de bolsillo siglo XIX",
  description:
    "Excelente reloj suizo de bolsillo fabricado en plata pura con grabados manuales de época y engranajes intactos.",
  category: "Relojería",
  condition: "Excelente",
  provenance:
    "Colección privada de la familia Gómez adquirida originalmente en Ginebra en 1920 con certificado de origen.",
  initialPrice: "250.00",
};

function createMockArticle(
  overrides: Partial<Prisma.ArticleGetPayload<{ include: { files: true } }>> = {}
) {
  return {
    id: "art-1",
    ownerId: "vendedor-a",
    title: VALID_INPUT.title,
    description: VALID_INPUT.description,
    category: VALID_INPUT.category,
    condition: VALID_INPUT.condition,
    provenance: VALID_INPUT.provenance,
    initialPrice: new Prisma.Decimal(VALID_INPUT.initialPrice),
    status: "BORRADOR" as const,
    createdAt: new Date("2026-11-15T10:00:00.000Z"),
    updatedAt: new Date("2026-11-15T10:00:00.000Z"),
    files: [],
    ...overrides,
  };
}

const SELLER_TOKEN = "a".repeat(64);
const BUYER_TOKEN = "b".repeat(64);
const PENDING_TOKEN = "c".repeat(64);

function setupSessionMocks() {
  db.session.findUnique.mockResolvedValue({
    expiresAt: new Date(Date.now() + 3600_000),
    user: {
      id: "vendedor-a",
      nombreCompleto: "Vendedor PujaFacil",
      email: "vendedor@pujafacil.com",
      status: "ACTIVA" as const,
      roles: [{ role: "VENDEDOR" as const }],
    },
  });
}

function makeApiRequest(
  method: string,
  url = "http://localhost:3000/api/articles",
  options: {
    body?: unknown;
    cookie?: string;
    origin?: string;
    rawBody?: string;
  } = {}
) {
  const headers: Record<string, string> = {
    origin: options.origin ?? "http://localhost:3000",
  };
  if (options.cookie) {
    headers["cookie"] = options.cookie;
  }
  if (options.body !== undefined || options.rawBody !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  return new Request(url, {
    method,
    headers,
    body:
      options.rawBody !== undefined
        ? options.rawBody
        : options.body !== undefined
        ? JSON.stringify(options.body)
        : undefined,
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  uploadMocks.cleanup.mockResolvedValue(0);
  // Configuración predeterminada de transacción
  db.$transaction.mockImplementation(
    async (cb: (tx: typeof db) => Promise<unknown>) => cb(db)
  );
});

// ====================================================================
// BLOQUE 1: Validaciones de esquema (article-schema.ts)
// ====================================================================
describe("1. Validaciones de esquema (articleInputSchema y articleUpdateSchema)", () => {
  it("acepta datos válidos completos con 6 campos requeridos", () => {
    const result = articleInputSchema.safeParse(VALID_INPUT);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.title).toBe(VALID_INPUT.title);
      expect(result.data.initialPrice).toBe("250.00");
    }
  });

  it("aplica trim() a los campos de texto correctamente", () => {
    const inputConEspacios = {
      ...VALID_INPUT,
      title: "   Reloj antiguo suizo de plata   ",
      category: "  Relojería  ",
    };
    const result = articleInputSchema.safeParse(inputConEspacios);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.title).toBe("Reloj antiguo suizo de plata");
      expect(result.data.category).toBe("Relojería");
    }
  });

  it("rechaza title menor a 5 caracteres o mayor a 100", () => {
    const muyCorto = articleInputSchema.safeParse({ ...VALID_INPUT, title: "abcd" });
    expect(muyCorto.success).toBe(false);

    const muyLargo = articleInputSchema.safeParse({
      ...VALID_INPUT,
      title: "A".repeat(101),
    });
    expect(muyLargo.success).toBe(false);
  });

  it("rechaza description menor a 20 caracteres o mayor a 2000", () => {
    const muyCorta = articleInputSchema.safeParse({
      ...VALID_INPUT,
      description: "Descripcion corta",
    });
    expect(muyCorta.success).toBe(false);

    const muyLarga = articleInputSchema.safeParse({
      ...VALID_INPUT,
      description: "D".repeat(2001),
    });
    expect(muyLarga.success).toBe(false);
  });

  it("rechaza category menor a 2 caracteres o mayor a 60", () => {
    expect(articleInputSchema.safeParse({ ...VALID_INPUT, category: "A" }).success).toBe(false);
    expect(articleInputSchema.safeParse({ ...VALID_INPUT, category: "C".repeat(61) }).success).toBe(false);
  });

  it("rechaza condition menor a 3 caracteres o mayor a 80", () => {
    expect(articleInputSchema.safeParse({ ...VALID_INPUT, condition: "OK" }).success).toBe(false);
    expect(articleInputSchema.safeParse({ ...VALID_INPUT, condition: "E".repeat(81) }).success).toBe(false);
  });

  it("rechaza provenance menor a 10 caracteres o mayor a 1000", () => {
    expect(articleInputSchema.safeParse({ ...VALID_INPUT, provenance: "Comprado" }).success).toBe(false);
    expect(articleInputSchema.safeParse({ ...VALID_INPUT, provenance: "P".repeat(1001) }).success).toBe(false);
  });

  it("rechaza initialPrice negativo, cero, sin dos decimales o con texto no numérico", () => {
    // Negativo
    expect(articleInputSchema.safeParse({ ...VALID_INPUT, initialPrice: "-10.00" }).success).toBe(false);
    // Cero
    expect(articleInputSchema.safeParse({ ...VALID_INPUT, initialPrice: "0.00" }).success).toBe(false);
    // Entero sin decimales
    expect(articleInputSchema.safeParse({ ...VALID_INPUT, initialPrice: "100" }).success).toBe(false);
    // Un solo decimal
    expect(articleInputSchema.safeParse({ ...VALID_INPUT, initialPrice: "100.5" }).success).toBe(false);
    // Tres decimales
    expect(articleInputSchema.safeParse({ ...VALID_INPUT, initialPrice: "100.555" }).success).toBe(false);
    // No numérico
    expect(articleInputSchema.safeParse({ ...VALID_INPUT, initialPrice: "abc" }).success).toBe(false);
    expect(articleInputSchema.safeParse({ ...VALID_INPUT, initialPrice: "" }).success).toBe(false);
  });

  it("articleUpdateSchema permite modificaciones parciales válidas y rechaza inválidas", () => {
    // Actualización parcial válida con solo título
    const soloTitulo = articleUpdateSchema.safeParse({ title: "Nuevo Título Aceptable" });
    expect(soloTitulo.success).toBe(true);

    // Actualización parcial válida con solo precio
    const soloPrecio = articleUpdateSchema.safeParse({ initialPrice: "350.00" });
    expect(soloPrecio.success).toBe(true);

    // Actualización parcial con precio inválido es rechazada
    const precioInvalido = articleUpdateSchema.safeParse({ initialPrice: "gratis" });
    expect(precioInvalido.success).toBe(false);

    // Actualización parcial con título muy corto es rechazada
    const tituloCorto = articleUpdateSchema.safeParse({ title: "abc" });
    expect(tituloCorto.success).toBe(false);
  });

  it("articleListQuerySchema valida q, coerce y valores por defecto para page y pageSize", () => {
    // Valores por defecto
    const defaultQuery = articleListQuerySchema.parse({});
    expect(defaultQuery.page).toBe(1);
    expect(defaultQuery.pageSize).toBe(8);
    expect(defaultQuery.q).toBeUndefined();

    // Coerción desde strings (típico en searchParams)
    const coerced = articleListQuerySchema.parse({ q: "joyas", page: "3", pageSize: "16" });
    expect(coerced.q).toBe("joyas");
    expect(coerced.page).toBe(3);
    expect(coerced.pageSize).toBe(16);

    // Rechaza límites fuera de rango
    expect(articleListQuerySchema.safeParse({ page: 0 }).success).toBe(false);
    expect(articleListQuerySchema.safeParse({ pageSize: 51 }).success).toBe(false);
  });
});

// ====================================================================
// BLOQUE 2: Creación y listado con paginación (article-service.ts)
// ====================================================================
describe("2. Creación y listado con paginación (createDraft y listOwnArticles)", () => {
  it("createDraft crea un borrador en estado BORRADOR y serializa initialPrice y fechas", async () => {
    const mockCreated = createMockArticle();
    db.article.create.mockResolvedValue(mockCreated);

    const result = await createDraft("vendedor-a", VALID_INPUT);

    expect(db.article.create).toHaveBeenCalledWith({
      data: {
        ownerId: "vendedor-a",
        title: VALID_INPUT.title,
        description: VALID_INPUT.description,
        category: VALID_INPUT.category,
        condition: VALID_INPUT.condition,
        provenance: VALID_INPUT.provenance,
        initialPrice: expect.any(Prisma.Decimal),
        status: "BORRADOR",
      },
      include: { files: true, reviews: true },
    });

    expect(result.status).toBe("BORRADOR");
    expect(result.initialPrice).toBe("250.00");
    expect(typeof result.createdAt).toBe("string");
    expect(typeof result.updatedAt).toBe("string");
  });

  it("listOwnArticles aplica filtro por ownerId, búsqueda q y calcula páginas correctamente", async () => {
    const mockItems = [
      createMockArticle({ id: "art-1", title: "Reloj Omega 1950" }),
      createMockArticle({ id: "art-2", title: "Reloj Rolex Vintage" }),
    ];

    db.article.findMany.mockResolvedValue(mockItems);
    // Simular total de 10 artículos con pageSize 8 -> 2 páginas
    db.article.count.mockResolvedValue(10);

    const result = await listOwnArticles("vendedor-a", {
      q: "reloj",
      page: 2,
      pageSize: 8,
    });

    expect(db.article.findMany).toHaveBeenCalledWith({
      where: {
        ownerId: "vendedor-a",
        OR: [
          { title: { contains: "reloj", mode: "insensitive" } },
          { category: { contains: "reloj", mode: "insensitive" } },
        ],
      },
      orderBy: { createdAt: "desc" },
      skip: 8,
      take: 8,
    });

    expect(result.page).toBe(2);
    expect(result.pageSize).toBe(8);
    expect(result.total).toBe(10);
    expect(result.pages).toBe(2);
    expect(result.items).toHaveLength(2);
    expect(result.items[0].initialPrice).toBe("250.00");
  });

  it("listOwnArticles devuelve al menos 1 página cuando no hay registros", async () => {
    db.article.findMany.mockResolvedValue([]);
    db.article.count.mockResolvedValue(0);

    const result = await listOwnArticles("vendedor-a", { page: 1, pageSize: 8 });

    expect(result.total).toBe(0);
    expect(result.pages).toBe(1);
    expect(result.items).toEqual([]);
  });
});

// ====================================================================
// BLOQUE 3: Control de propiedad entre vendedores
// ====================================================================
describe("3. Control de propiedad entre vendedores (getOwnArticle, updateDraft, deleteDraft)", () => {
  it("getOwnArticle lanza 404 (NOT_FOUND) si el artículo pertenece a otro vendedor o no existe", async () => {
    // Artículo de vendedor-a
    db.article.findUnique.mockResolvedValue(createMockArticle({ ownerId: "vendedor-a" }));

    // Vendedor-b intenta consultar
    await expect(getOwnArticle("vendedor-b", "art-1")).rejects.toBeInstanceOf(ArticleServiceError);
    await expect(getOwnArticle("vendedor-b", "art-1")).rejects.toMatchObject({
      statusCode: 404,
      code: "NOT_FOUND",
    });

    // Artículo no existe
    db.article.findUnique.mockResolvedValue(null);
    await expect(getOwnArticle("vendedor-a", "inexistente")).rejects.toBeInstanceOf(ArticleServiceError);
    await expect(getOwnArticle("vendedor-a", "inexistente")).rejects.toMatchObject({
      statusCode: 404,
      code: "NOT_FOUND",
    });
  });

  it("updateDraft lanza 404 (NOT_FOUND) si el vendedor no es el propietario", async () => {
    db.article.findUnique.mockResolvedValue(createMockArticle({ ownerId: "vendedor-a" }));

    await expect(
      updateDraft("vendedor-b", "art-1", { title: "Intento de modificación" })
    ).rejects.toMatchObject({
      statusCode: 404,
      code: "NOT_FOUND",
    });

    expect(db.article.update).not.toHaveBeenCalled();
  });

  it("deleteDraft lanza 404 (NOT_FOUND) si el vendedor no es el propietario", async () => {
    db.article.findUnique.mockResolvedValue(createMockArticle({ ownerId: "vendedor-a" }));

    await expect(deleteDraft("vendedor-b", "art-1")).rejects.toMatchObject({
      statusCode: 404,
      code: "NOT_FOUND",
    });

    expect(db.article.delete).not.toHaveBeenCalled();
  });
});

// ====================================================================
// BLOQUE 4: Restricciones de estado, borrado y envío a revisión
// ====================================================================
describe("4. Restricciones de estado, borrado y envío a revisión (updateDraft, deleteDraft, submitForReview)", () => {
  it("updateDraft permite editar en BORRADOR o REQUIERE_CORRECCIONES", async () => {
    // Caso 1: BORRADOR
    const borrador = createMockArticle({ status: "BORRADOR" });
    db.article.findUnique.mockResolvedValue(borrador);
    db.article.update.mockResolvedValue({
      ...borrador,
      title: "Título Actualizado",
      initialPrice: new Prisma.Decimal("300.00"),
    });

    const resBorrador = await updateDraft("vendedor-a", "art-1", {
      title: "Título Actualizado",
      initialPrice: "300.00",
    });
    expect(resBorrador.title).toBe("Título Actualizado");
    expect(resBorrador.initialPrice).toBe("300.00");

    // Caso 2: REQUIERE_CORRECCIONES
    const correcciones = createMockArticle({ status: "REQUIERE_CORRECCIONES" });
    db.article.findUnique.mockResolvedValue(correcciones);
    db.article.update.mockResolvedValue({
      ...correcciones,
      condition: "Bueno",
    });

    const resCorrecciones = await updateDraft("vendedor-a", "art-1", {
      condition: "Bueno",
    });
    expect(resCorrecciones.condition).toBe("Bueno");
  });

  it("updateDraft lanza 409 (INVALID_STATE) en estados no editables", async () => {
    const estadosNoEditables = [
      "PENDIENTE_REVISION",
      "APROBADO",
      "ASOCIADO_SUBASTA",
      "RECHAZADO",
      "ARCHIVADO",
    ] as const;

    for (const status of estadosNoEditables) {
      db.article.findUnique.mockResolvedValue(createMockArticle({ status }));

      await expect(
        updateDraft("vendedor-a", "art-1", { title: "Nuevo" })
      ).rejects.toMatchObject({
        statusCode: 409,
        code: "INVALID_STATE",
      });
    }

    expect(db.article.update).not.toHaveBeenCalled();
  });

  it("deleteDraft solo permite eliminar en estado BORRADOR sin subastas ni revisiones", async () => {
    // Falla si no es BORRADOR
    db.article.findUnique.mockResolvedValue(createMockArticle({ status: "APROBADO" }));
    await expect(deleteDraft("vendedor-a", "art-1")).rejects.toMatchObject({
      statusCode: 409,
      code: "CANNOT_DELETE",
    });

    // Falla si tiene subastas asociadas
    db.article.findUnique.mockResolvedValue(createMockArticle({ status: "BORRADOR" }));
    db.auction.count.mockResolvedValue(1);
    db.review.count.mockResolvedValue(0);
    await expect(deleteDraft("vendedor-a", "art-1")).rejects.toMatchObject({
      statusCode: 409,
      code: "CANNOT_DELETE",
    });

    // Falla si tiene revisiones asociadas
    db.auction.count.mockResolvedValue(0);
    db.review.count.mockResolvedValue(1);
    await expect(deleteDraft("vendedor-a", "art-1")).rejects.toMatchObject({
      statusCode: 409,
      code: "CANNOT_DELETE",
    });

    // Éxito: BORRADOR sin subastas ni revisiones
    db.auction.count.mockResolvedValue(0);
    db.review.count.mockResolvedValue(0);

    const result = await deleteDraft("vendedor-a", "art-1");
    expect(result).toEqual({ deleted: true });
    expect(uploadMocks.cleanup).toHaveBeenCalledWith("art-1", "vendedor-a");
    expect(db.article.delete).toHaveBeenCalledWith({ where: { id: "art-1" } });
  });

  it("submitForReview rechaza con 400 (MISSING_PHOTO) si no tiene fotos", async () => {
    db.article.findUnique.mockResolvedValue(createMockArticle({ status: "BORRADOR" }));
    db.fileRecord.count.mockResolvedValue(0);

    await expect(submitForReview("vendedor-a", "art-1")).rejects.toMatchObject({
      statusCode: 400,
      code: "MISSING_PHOTO",
      message: "Debes adjuntar al menos una fotografía antes de enviar el artículo a verificación",
    });

    expect(db.article.update).not.toHaveBeenCalled();
  });

  it("submitForReview actualiza a PENDIENTE_REVISION cuando tiene al menos una foto", async () => {
    db.article.findUnique.mockResolvedValue(createMockArticle({ status: "BORRADOR" }));
    db.fileRecord.count.mockResolvedValue(1);

    const actualizado = createMockArticle({ status: "PENDIENTE_REVISION" });
    db.article.update.mockResolvedValue(actualizado);

    const result = await submitForReview("vendedor-a", "art-1");

    expect(db.article.update).toHaveBeenCalledWith({
      where: { id: "art-1" },
      data: { status: "PENDIENTE_REVISION" },
      include: { files: true, reviews: true },
    });
    expect(result.status).toBe("PENDIENTE_REVISION");
  });

  it("submitForReview rechaza con 409 (INVALID_STATE) si no está en BORRADOR ni REQUIERE_CORRECCIONES", async () => {
    db.article.findUnique.mockResolvedValue(createMockArticle({ status: "APROBADO" }));

    await expect(submitForReview("vendedor-a", "art-1")).rejects.toMatchObject({
      statusCode: 409,
      code: "INVALID_STATE",
    });
  });
});

// ====================================================================
// BLOQUE 5: Protección de endpoints API (/api/articles)
// ====================================================================
describe("5. Protección de endpoints API (/api/articles)", () => {
  it("GET /api/articles responde 401 si no hay sesión activa", async () => {
    const req = makeApiRequest("GET", "http://localhost:3000/api/articles");
    const res = await getArticlesRoute(req);

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json).toMatchObject({
      ok: false,
      error: { code: "NO_AUTENTICADO" },
    });
  });

  it("POST /api/articles responde 403 si el origen no es confiable (assertTrustedOrigin)", async () => {
    const req = makeApiRequest("POST", "http://localhost:3000/api/articles", {
      origin: "https://sitio-malicioso.test",
      body: VALID_INPUT,
    });
    const res = await postArticlesRoute(req);

    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json).toMatchObject({
      ok: false,
      error: { code: "ORIGEN_NO_PERMITIDO" },
    });
  });

  it("POST /api/articles responde 403 si el usuario tiene cuenta PENDIENTE (no ACTIVA)", async () => {
    // Simular sesión de usuario con cuenta PENDIENTE
    db.session.findUnique.mockResolvedValue({
      expiresAt: new Date(Date.now() + 60_000),
      user: {
        id: "usr-pendiente",
        nombreCompleto: "Usuario Pendiente",
        email: "pendiente@test.com",
        status: "PENDIENTE",
        roles: [{ role: "VENDEDOR" }],
      },
    });

    const req = makeApiRequest("POST", "http://localhost:3000/api/articles", {
      cookie: `pf_session=${PENDING_TOKEN}`,
      body: VALID_INPUT,
    });
    const res = await postArticlesRoute(req);

    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json).toMatchObject({
      ok: false,
      error: { code: "CUENTA_NO_ACTIVA" },
    });
  });

  it("POST /api/articles responde 403 si el usuario no tiene rol VENDEDOR", async () => {
    // Simular sesión de COMPRADOR exclusivamente
    db.session.findUnique.mockResolvedValue({
      expiresAt: new Date(Date.now() + 60_000),
      user: {
        id: "usr-comprador",
        nombreCompleto: "Comprador Exclusivo",
        email: "comprador@test.com",
        status: "ACTIVA",
        roles: [{ role: "COMPRADOR" }],
      },
    });

    const req = makeApiRequest("POST", "http://localhost:3000/api/articles", {
      cookie: `pf_session=${BUYER_TOKEN}`,
      body: VALID_INPUT,
    });
    const res = await postArticlesRoute(req);

    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json).toMatchObject({
      ok: false,
      error: { code: "ROL_NO_PERMITIDO" },
    });
  });

  it("POST /api/articles responde 201 y crea el borrador con usuario VENDEDOR y datos válidos", async () => {
    setupSessionMocks();
    db.article.create.mockResolvedValue(createMockArticle());

    const req = makeApiRequest("POST", "http://localhost:3000/api/articles", {
      cookie: `pf_session=${SELLER_TOKEN}`,
      body: VALID_INPUT,
    });
    const res = await postArticlesRoute(req);

    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.data.article.title).toBe(VALID_INPUT.title);
    expect(json.data.article.status).toBe("BORRADOR");
  });

  it("POST /api/articles responde 400 (VALIDATION_ERROR) ante cuerpo no JSON o datos inválidos", async () => {
    setupSessionMocks();

    // Body con JSON malformado
    const reqSintaxis = makeApiRequest("POST", "http://localhost:3000/api/articles", {
      cookie: `pf_session=${SELLER_TOKEN}`,
      rawBody: "{ malformado: ",
    });
    const resSintaxis = await postArticlesRoute(reqSintaxis);
    expect(resSintaxis.status).toBe(400);
    const jsonSintaxis = await resSintaxis.json();
    expect(jsonSintaxis.error.code).toBe("VALIDATION_ERROR");

    // Body con validación fallida (precio negativo)
    const reqInvalido = makeApiRequest("POST", "http://localhost:3000/api/articles", {
      cookie: `pf_session=${SELLER_TOKEN}`,
      body: { ...VALID_INPUT, initialPrice: "-50.00" },
    });
    const resInvalido = await postArticlesRoute(reqInvalido);
    expect(resInvalido.status).toBe(400);
    const jsonInvalido = await resInvalido.json();
    expect(jsonInvalido.error.code).toBe("VALIDATION_ERROR");
  });

  it("GET /api/articles responde 200 con listado paginado para vendedor autenticado", async () => {
    setupSessionMocks();
    db.article.findMany.mockResolvedValue([createMockArticle()]);
    db.article.count.mockResolvedValue(1);

    const req = makeApiRequest("GET", "http://localhost:3000/api/articles?page=1&pageSize=8", {
      cookie: `pf_session=${SELLER_TOKEN}`,
    });
    const res = await getArticlesRoute(req);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.data.items).toHaveLength(1);
    expect(json.data.total).toBe(1);
  });

  it("PATCH /api/articles/[id] responde 400 si el body está vacío y 409 si el estado no es editable", async () => {
    setupSessionMocks();

    // Body vacío
    const reqVacio = makeApiRequest("PATCH", "http://localhost:3000/api/articles/art-1", {
      cookie: `pf_session=${SELLER_TOKEN}`,
      body: {},
    });
    const resVacio = await patchArticleByIdRoute(reqVacio, {
      params: Promise.resolve({ id: "art-1" }),
    });
    expect(resVacio.status).toBe(400);
    expect((await resVacio.json()).error.code).toBe("VALIDATION_ERROR");

    // Estado no editable (APROBADO)
    db.article.findUnique.mockResolvedValue(createMockArticle({ status: "APROBADO" }));
    const reqInvalido = makeApiRequest("PATCH", "http://localhost:3000/api/articles/art-1", {
      cookie: `pf_session=${SELLER_TOKEN}`,
      body: { title: "Nuevo Título Válido" },
    });
    const resInvalido = await patchArticleByIdRoute(reqInvalido, {
      params: Promise.resolve({ id: "art-1" }),
    });
    expect(resInvalido.status).toBe(409);
    expect((await resInvalido.json()).error.code).toBe("INVALID_STATE");
  });

  it("POST /api/articles/[id]/submit responde 400 si falta foto para enviar a verificación", async () => {
    setupSessionMocks();
    db.article.findUnique.mockResolvedValue(createMockArticle({ status: "BORRADOR" }));
    db.fileRecord.count.mockResolvedValue(0);

    const req = makeApiRequest("POST", "http://localhost:3000/api/articles/art-1/submit", {
      cookie: `pf_session=${SELLER_TOKEN}`,
    });
    const res = await submitArticleRoute(req, {
      params: Promise.resolve({ id: "art-1" }),
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.code).toBe("MISSING_PHOTO");
    expect(json.error.message).toContain("fotografía");
  });

  it("GET /api/articles/[id] responde 200 con el artículo para el vendedor propietario", async () => {
    setupSessionMocks();
    db.article.findUnique.mockResolvedValue(createMockArticle({ ownerId: "vendedor-a" }));

    const req = makeApiRequest("GET", "http://localhost:3000/api/articles/art-1", {
      cookie: `pf_session=${SELLER_TOKEN}`,
    });
    const res = await getArticleByIdRoute(req, {
      params: Promise.resolve({ id: "art-1" }),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.data.article.id).toBe("art-1");
  });

  it("DELETE /api/articles/[id] responde 200 al eliminar un borrador propio", async () => {
    setupSessionMocks();
    db.article.findUnique.mockResolvedValue(createMockArticle({ status: "BORRADOR" }));
    db.auction.count.mockResolvedValue(0);
    db.review.count.mockResolvedValue(0);

    const req = makeApiRequest("DELETE", "http://localhost:3000/api/articles/art-1", {
      cookie: `pf_session=${SELLER_TOKEN}`,
    });
    const res = await deleteArticleByIdRoute(req, {
      params: Promise.resolve({ id: "art-1" }),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ ok: true, data: { deleted: true, id: "art-1" } });
  });
});

describe("Catálogo público (/api/public/articles) e integración de archivos", () => {
  const publicArticle = {
    id: "public-art-1",
    ownerId: "internal-owner-id",
    title: "Reloj antiguo",
    description: "Reloj mecánico de bolsillo en buen estado.",
    category: "Relojería",
    condition: "Muy bueno",
    provenance: "Colección privada documentada desde 1950.",
    initialPrice: new Prisma.Decimal("125.50"),
    status: "APROBADO" as const,
    createdAt: new Date("2026-11-15T10:00:00.000Z"),
    owner: {
      nombreCompleto: "Nombre Interno",
      email: "privado@example.test",
      cedulaCifrada: "identidad-cifrada",
    },
    files: [{ id: "photo-1", kind: "FOTO", storagePath: "C:/private/files/photo.jpg" }],
    auctions: [{
      id: "auction-1",
      status: "PROGRAMADA" as const,
      startingPrice: new Prisma.Decimal("125.50"),
      closesAt: new Date("2026-12-01T10:00:00.000Z"),
    }],
  };

  it("filtra findMany y count a los dos estados públicos permitidos", async () => {
    db.article.findMany.mockResolvedValue([publicArticle]);
    db.article.count.mockResolvedValue(1);

    const response = await getPublicArticlesRoute(
      makeApiRequest("GET", "http://localhost:3000/api/public/articles"),
    );

    expect(response.status).toBe(200);
    const expectedWhere = { status: { in: ["APROBADO", "ASOCIADO_SUBASTA"] } };
    expect(db.article.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expectedWhere }));
    expect(db.article.count).toHaveBeenCalledWith({ where: expectedWhere });
  });

  it("aplica búsqueda, categoría y paginación, y devuelve el contrato paginado", async () => {
    db.article.findMany.mockResolvedValue([publicArticle]);
    db.article.count.mockResolvedValue(17);

    const response = await getPublicArticlesRoute(makeApiRequest(
      "GET",
      "http://localhost:3000/api/public/articles?q=Reloj&category=Relojer%C3%ADa&page=2&pageSize=8",
    ));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(db.article.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        status: { in: ["APROBADO", "ASOCIADO_SUBASTA"] },
        OR: [
          { title: { contains: "Reloj", mode: "insensitive" } },
          { description: { contains: "Reloj", mode: "insensitive" } },
        ],
        category: { equals: "Relojería", mode: "insensitive" },
      },
      skip: 8,
      take: 8,
    }));
    expect(db.article.count).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ category: { equals: "Relojería", mode: "insensitive" } }),
    }));
    expect(json).toMatchObject({
      ok: true,
      data: { items: [{ id: "public-art-1" }], page: 2, pageSize: 8, total: 17, pages: 3 },
    });
  });

  it("no serializa campos privados del propietario ni rutas de almacenamiento", async () => {
    db.article.findMany.mockResolvedValue([publicArticle]);
    db.article.count.mockResolvedValue(1);

    const response = await getPublicArticlesRoute(
      makeApiRequest("GET", "http://localhost:3000/api/public/articles"),
    );
    const serialized = JSON.stringify(await response.json());

    expect(serialized).not.toContain("ownerId");
    expect(serialized).not.toContain("email");
    expect(serialized).not.toContain("cedulaCifrada");
    expect(serialized).not.toContain("nombreCompleto");
    expect(serialized).not.toContain("storagePath");
    expect(serialized).not.toContain("C:/private/files");
  });

  it("rechaza parámetros de paginación inválidos con VALIDATION_ERROR", async () => {
    const response = await getPublicArticlesRoute(
      makeApiRequest("GET", "http://localhost:3000/api/public/articles?page=-1"),
    );
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json).toMatchObject({
      ok: false,
      error: { code: "VALIDATION_ERROR", message: expect.any(String) },
    });
  });
});

describe("Regresiones de expedientes y consistencia del borrado", () => {
  it("conserva el artículo y propaga un fallo de almacenamiento al limpiar sus archivos", async () => {
    db.article.findUnique.mockResolvedValue(createMockArticle());
    db.auction.count.mockResolvedValue(0); db.review.count.mockResolvedValue(0);
    uploadMocks.cleanup.mockRejectedValue(new Error("Disco no disponible"));
    await expect(deleteDraft("vendedor-a", "art-1")).rejects.toThrow("Disco no disponible");
    expect(db.article.delete).not.toHaveBeenCalled();
    expect(db.fileRecord.deleteMany).not.toHaveBeenCalled();
  });
  it("devuelve observaciones y fechas de revisión al propietario sin exponer al verificador", async () => {
    db.article.findUnique.mockResolvedValue({ ...createMockArticle(), reviews: [{
      id: "review-1", verifierId: "interno", status: "REQUIERE_CORRECCIONES", comments: "Adjunta una fotografía del número de serie.",
      assignedAt: new Date("2026-11-18T12:00:00Z"), decidedAt: new Date("2026-11-18T13:00:00Z"),
    }] });
    const result = await getOwnArticle("vendedor-a", "art-1");
    expect(result.reviews?.[0]).toMatchObject({ comments: "Adjunta una fotografía del número de serie.", decidedAt: "2026-11-18T13:00:00.000Z" });
    expect(result.reviews?.[0]).not.toHaveProperty("verifierId");
  });
  it("mantiene categorías de otras páginas aunque se filtre por un término sin resultados", async () => {
    db.article.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([{ category: "Arte" }, { category: "Relojería" }]);
    db.article.count.mockResolvedValue(0);
    const response = await getPublicArticlesRoute(makeApiRequest("GET", "http://localhost:3000/api/public/articles?q=inexistente"));
    expect((await response.json()).data.categories).toEqual(["Arte", "Relojería"]);
    expect(db.article.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ distinct: ["category"], where: { status: { in: ["APROBADO", "ASOCIADO_SUBASTA"] } } }));
  });
});

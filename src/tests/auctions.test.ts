import { describe, expect, it } from "vitest";
import {
  assignReviewSchema,
  decideReviewSchema,
  validateReviewAssignmentRules,
  validateReviewDecisionRules,
} from "@/modules/reviews/review-schema";
import {
  createAuctionSchema,
  isWithinServerAuctionWindow,
  suspendAuctionSchema,
  usdAmountSchema,
  validateStartingPriceAgainstArticle,
} from "@/modules/auctions/auction-schema";

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
        .success
    ).toBe(true);
  });

  it("determina si una subasta está en ventana activa usando la hora del servidor", () => {
    const opensAt = new Date("2026-11-16T10:00:00Z");
    const closesAt = new Date("2026-11-16T18:00:00Z");

    expect(
      isWithinServerAuctionWindow(opensAt, closesAt, new Date("2026-11-16T09:59:59Z"))
    ).toBe(false);
    expect(
      isWithinServerAuctionWindow(opensAt, closesAt, new Date("2026-11-16T12:00:00Z"))
    ).toBe(true);
    expect(
      isWithinServerAuctionWindow(opensAt, closesAt, new Date("2026-11-16T18:00:00Z"))
    ).toBe(false);
  });
});

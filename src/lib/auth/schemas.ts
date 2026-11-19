import { z } from "zod";

const email = z.string().trim().toLowerCase().max(254).pipe(z.email("Ingresa un correo válido."));
export const passwordSchema = z.string().min(15, "Usa al menos 15 caracteres.").max(64, "Usa como máximo 64 caracteres.").refine(
  (value) => {
    // Solo se normaliza para detectar patrones débiles, nunca para guardar/verificar la clave.
    const normalized = value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[\s\p{P}\p{S}]/gu, "");
    return normalized.length > 0
      && !/123456|654321|987654|password|qwerty|contrasena|letmein|abcdefgh|asdfgh|zxcvbn/.test(normalized)
      && !/^(.{1,8})\1+$/u.test(normalized)
      && !/^(?:admin(?:istrador|istrator)?|welcome|bienvenido|iloveyou|changeme|pujafacil)\d*$/.test(normalized);
  },
  "Evita contraseñas comunes, secuencias y patrones repetidos.",
);

export const registerSchema = z.object({
  nombreCompleto: z.string().trim().min(3, "Ingresa tu nombre completo.").max(100),
  email,
  password: passwordSchema,
  cedula: z.string().regex(/^\d{10}$/, "La cédula debe tener 10 dígitos."),
  roles: z.array(z.enum(["COMPRADOR", "VENDEDOR"])).min(1, "Selecciona al menos un perfil.").max(2).refine((roles) => new Set(roles).size === roles.length, "No repitas perfiles."),
});
// IDENTIDAD se valida con saveValidatedUpload de Jonathan al integrar J2.
export const loginSchema = z.object({ email, password: z.string().min(1, "Ingresa tu contraseña.").max(256) });
export const forgotSchema = z.object({ email });
export const resetSchema = z.object({ token: z.string().min(1).max(256), newPassword: passwordSchema });
export const profileSchema = z.object({
  telefono: z.string().trim().max(25).regex(/^[+\d\s()-]*$/, "Ingresa un teléfono válido.").optional(),
  direccion: z.string().trim().max(250).optional(),
}).strict();

// Motivo cerrado de aprobación: sin texto libre que pueda introducir PII en auditoría.
export const APPROVAL_REASON = "REVISION_DOCUMENTAL_COHERENTE";
export const activationSchema = z.object({
  reviewId: z.string().min(1).max(128),
  documentoRevisadoId: z.string().min(1).max(128),
  coherenciaConfirmada: z.literal(true, { error: "Confirma la revisión de los datos y del documento." }),
  motivoCodigo: z.literal(APPROVAL_REASON, { error: "Selecciona un motivo de aprobación válido." }),
}).strict();

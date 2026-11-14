import { z } from "zod";

const email = z.email("Ingresa un correo válido.").trim().toLowerCase().max(254);
export const passwordSchema = z.string().min(15, "Usa al menos 15 caracteres.").max(64, "Usa como máximo 64 caracteres.").refine(
  (value) => !/123456|password|qwerty|contraseña|contrasena|letmein|abcdefgh/i.test(value),
  "Elige una contraseña que no sea común.",
);

export const registerSchema = z.object({
  nombreCompleto: z.string().trim().min(3, "Ingresa tu nombre completo.").max(100),
  email,
  password: passwordSchema,
  cedula: z.string().regex(/^\d{10}$/, "La cédula ficticia debe tener 10 dígitos."),
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

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function encryptionKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY_HEX;
  if (!key || !/^[a-f\d]{64}$/i.test(key)) {
    throw new Error("Configura ENCRYPTION_KEY_HEX con una clave hexadecimal de 32 bytes.");
  }
  return Buffer.from(key, "hex");
}

/** Formato único: iv:ciphertext:tag en hexadecimal; AES-256-GCM, IV de 12 bytes. Solo backend. */
export function encryptCedula(text: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  return [iv, encrypted, cipher.getAuthTag()].map((part) => part.toString("hex")).join(":");
}

export function decryptCedula(ciphertext: string): string {
  if (!/^[a-f\d]{24}:(?:[a-f\d]{2})+:[a-f\d]{32}$/i.test(ciphertext)) {
    throw new Error("Formato de cifrado inválido.");
  }
  const [iv, encrypted, tag] = ciphertext.split(":").map((part) => Buffer.from(part, "hex"));
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

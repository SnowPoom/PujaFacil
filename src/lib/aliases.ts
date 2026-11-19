/** Conserva el identificador reservado de alias antiguos sin modificar registros. */
export function displayAlias(value: string): string {
  return value.replace(/\bPostor\b/g, "Usuario");
}

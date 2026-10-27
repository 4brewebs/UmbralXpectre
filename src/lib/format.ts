/** Número para la interfaz en español: coma decimal, sin separador de miles. Solo texto de UI, nunca JSON/datos. */
export function num(value: number, digits: number): string {
  return value.toFixed(digits).replace(".", ",");
}

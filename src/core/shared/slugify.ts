/**
 * Utilidad compartida entre `core/session` (para generar ids legibles y
 * deterministas de feature/scenario/step) y `core/evidence` (para generar
 * los nombres de carpeta bajo `evidence/`). Vive en `src/core/shared/` en
 * vez de dentro de uno de los dos módulos porque ambos la necesitan y
 * ninguno debe depender del otro (ver ARCHITECTURE.md, "Cambios
 * registrados": esta carpeta no estaba prevista en la estructura original y
 * se añadió en la fase 2 por este motivo).
 *
 * Convierte un texto arbitrario (nombre de feature/scenario, texto de un
 * step, nombre original de un archivo, etc.) a una forma segura para usar
 * como nombre de archivo/carpeta y como fragmento de id:
 * - minúsculas,
 * - sin acentos/diacríticos (normaliza NFD y descarta las marcas combinantes,
 *   rango Unicode U+0300-U+036F),
 * - cualquier carácter que no sea `[a-z0-9]` se convierte en `-`,
 * - guiones repetidos se colapsan a uno solo,
 * - sin guiones al inicio/final.
 *
 * Un texto que quede vacío tras la limpieza (p. ej. compuesto solo de
 * símbolos/emojis) cae en el fallback `'sin-titulo'` para nunca devolver una
 * cadena vacía (que rompería `mkdir`/joins de rutas).
 */
export function slugify(input: string): string {
  const cleaned = input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  return cleaned.length > 0 ? cleaned : 'sin-titulo';
}

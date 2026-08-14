import type { ResultCounts } from '../types/report.js';
import type { StepResult } from '../types/session.js';

/**
 * Paleta de colores del reporte — ÚNICO lugar del código donde se definen
 * estos valores hex (ver ARCHITECTURE.md, "Gráficos del reporte": SVG
 * server-side sin librería de charting). Cualquier otro módulo que necesite
 * pintar un resultado (helpers de Handlebars en `templateEngine.ts`, CSS de
 * los templates) debe importar/reflejar estos mismos valores en vez de
 * hardcodear su propia copia — ver `RESULT_LABELS` más abajo, que sigue el
 * mismo criterio para las etiquetas en español.
 *
 * Elegidos como tonos "700/800" (oscuros y saturados, no colores planos
 * brillantes) porque dan un contraste razonable tanto usados como relleno
 * con texto blanco encima (badges) como usados como color de texto sobre
 * fondo blanco/gris claro — en ambos casos por encima o cerca del umbral
 * WCAG AA (contraste ≥ 4.5:1) para texto normal. Ningún consumidor debe
 * depender SOLO de estos colores para distinguir categorías: siempre van
 * acompañados de texto/etiqueta (ver JSDoc de `renderDonutChart` y la
 * leyenda textual en `templates/default/partials/legend.hbs`).
 */
export const RESULT_COLORS: Readonly<Record<StepResult, string>> = {
  pass: '#15803d',
  fail: '#b91c1c',
  skip: '#57534e',
  pending: '#b45309',
};

/** Etiquetas en español de cada `StepResult`, únicas para todo el reporte (ver nota de diseño de `RESULT_COLORS`). */
export const RESULT_LABELS: Readonly<Record<StepResult, string>> = {
  pass: 'Aprobado',
  fail: 'Fallido',
  skip: 'Omitido',
  pending: 'Pendiente',
};

/** Orden de dibujado/legend fijo, para que el resultado sea determinístico entre corridas (mismos conteos → mismo SVG byte a byte). */
const RESULT_ORDER: readonly StepResult[] = ['pass', 'fail', 'skip', 'pending'];

/**
 * Espacio en blanco (en unidades del `viewBox`, independiente del tamaño)
 * entre porciones adyacentes del donut, combinado con `stroke-linecap="round"`
 * en cada porción — el anillo segmentado con extremos redondeados en vez de
 * porciones que se tocan a tope. Exportado para que `charts.test.ts` pueda
 * calcular la geometría esperada sin duplicar el número mágico.
 */
export const DONUT_SLICE_GAP_PX = 4;

/** Color de la barra de progreso general. Reutiliza `RESULT_COLORS.pass` a propósito: "completado" es conceptualmente el mismo verde que "aprobado", y así no se introduce un quinto color sin documentar. */
const PROGRESS_FILL_COLOR = RESULT_COLORS.pass;

export interface DonutChartOptions {
  /** Ancho/alto del `viewBox` cuadrado, en px. Default `220`. */
  size?: number;
  /** Grosor del anillo, en px. Default `32`. */
  strokeWidth?: number;
  /**
   * Si se dibuja el `%` de aprobación en el centro del anillo. Default
   * `true`. El dashboard (único caller hoy, ver `reportGenerator.ts`) lo
   * pasa en `false` cuando ya hay datos — ese mismo número ya es el
   * protagonista tipográfico del hero (`.qa-hero__number`) justo al lado, y
   * repetirlo en el centro del anillo era puro ruido redundante, no una
   * segunda pieza de información. Con `total === 0` el caller sigue
   * pidiendo el label (`true`), porque ahí el centro no repite nada: es el
   * único lugar que dice "Sin datos".
   */
  showCenterLabel?: boolean;
}

/**
 * Donut chart de distribución pass/fail/skip/pending, como string SVG
 * autocontenido (sin dependencias externas — ver ARCHITECTURE.md). Función
 * pura: mismo `counts`/`options` siempre produce el mismo string.
 *
 * Accesibilidad:
 * - `role="img"` + `aria-label` en la raíz con el resumen completo en texto
 *   (no solo "gráfico de torta").
 * - Un `<title>` (primer hijo del `<svg>`, y también uno por cada porción)
 *   para lectores de pantalla y tooltips nativos del navegador.
 * - Cada porción lleva `data-result`/`data-value`/`data-percent` — no son
 *   necesarios para renderizar, pero permiten identificar cada porción sin
 *   depender del color (tanto para tests como para cualquier herramienta de
 *   accesibilidad/automatización que inspeccione el markup).
 * - El texto central y el aro de fondo usan `fill`/`stroke="currentColor"`:
 *   como el SVG se inserta inline dentro del HTML del reporte (nunca como
 *   `<img>`), heredan el color de texto normal de la página y por lo tanto
 *   se adaptan automáticamente al tema claro/oscuro sin que `charts.ts`
 *   necesite conocer los colores del tema.
 * - El llamador (template) SIEMPRE debe agregar además una leyenda textual
 *   en HTML (ver contrato de `TemplateEngine`) — este SVG por sí solo no
 *   alcanza como única fuente de la distribución para quien no pueda
 *   percibir colores.
 *
 * Caso `total === 0` (sesión sin steps): se dibuja solo el aro de fondo
 * (sin porciones) y el centro muestra "Sin datos", en vez de dividir por
 * cero.
 *
 * Las porciones llevan un pequeño hueco (`DONUT_SLICE_GAP_PX`) entre sí y
 * `stroke-linecap="round"` — un anillo segmentado con extremos redondeados
 * en vez de porciones a tope, para que cada categoría se lea como una
 * pieza propia incluso antes de mirar el color.
 */
export function renderDonutChart(counts: ResultCounts, options: DonutChartOptions = {}): string {
  const size = options.size ?? 220;
  const strokeWidth = options.strokeWidth ?? 32;
  const showCenterLabel = options.showCenterLabel ?? true;
  const radius = (size - strokeWidth) / 2;
  const center = size / 2;
  const circumference = 2 * Math.PI * radius;
  const total = RESULT_ORDER.reduce((sum, key) => sum + counts[key], 0);

  const ariaLabel =
    total === 0
      ? 'Distribución de resultados: todavía no hay steps ejecutados.'
      : `Distribución de resultados sobre ${total} step${total === 1 ? '' : 's'}: ` +
        RESULT_ORDER.map((key) => `${RESULT_LABELS[key]} ${percentOf(counts[key], total)}%`).join(
          ', ',
        ) +
        '.';

  let cumulativeFraction = 0;
  const slices = RESULT_ORDER.filter((key) => counts[key] > 0)
    .map((key) => {
      const value = counts[key];
      const fraction = value / total;
      const dashLength = fraction * circumference;
      const dashOffset = cumulativeFraction * circumference;
      cumulativeFraction += fraction;
      const visibleLength = Math.max(0, dashLength - DONUT_SLICE_GAP_PX);
      const visibleOffset = dashOffset + DONUT_SLICE_GAP_PX / 2;

      return (
        `<circle cx="${center}" cy="${center}" r="${radius}" fill="none" ` +
        `stroke="${RESULT_COLORS[key]}" stroke-width="${strokeWidth}" stroke-linecap="round" ` +
        `stroke-dasharray="${round(visibleLength)} ${round(circumference - visibleLength)}" ` +
        `stroke-dashoffset="${round(-visibleOffset)}" ` +
        `data-result="${key}" data-value="${value}" data-percent="${percentOf(value, total)}">` +
        `<title>${escapeXml(RESULT_LABELS[key])}: ${value} (${percentOf(value, total)}%)</title>` +
        `</circle>`
      );
    })
    .join('');

  const centerLabel = total === 0 ? 'Sin datos' : `${percentOf(counts.pass, total)}%`;
  const centerText = showCenterLabel
    ? `<text x="${center}" y="${center}" text-anchor="middle" dominant-baseline="middle" font-size="${round(size * 0.16)}" font-weight="700" fill="currentColor">${escapeXml(centerLabel)}</text>`
    : '';

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="${escapeXml(ariaLabel)}">` +
    `<title>${escapeXml(ariaLabel)}</title>` +
    `<circle cx="${center}" cy="${center}" r="${radius}" fill="none" stroke="currentColor" stroke-opacity="0.15" stroke-width="${strokeWidth}" data-role="track"></circle>` +
    `<g transform="rotate(-90 ${center} ${center})">${slices}</g>` +
    centerText +
    `</svg>`
  );
}

export interface ProgressBarOptions {
  /** Ancho del `viewBox`, en px. Default `480`. */
  width?: number;
  /** Alto del `viewBox`, en px. Default `28`. */
  height?: number;
}

/**
 * Barra de progreso simple (% completado = steps que ya no están en
 * `'pending'`, ver `ResultSummary.completionPercent` en
 * `core/types/report.ts`), como string SVG autocontenido. Función pura,
 * mismas garantías de accesibilidad que `renderDonutChart` (`role="img"` +
 * `aria-label`, con el porcentaje en texto).
 *
 * Sin `<text>` visible dentro del SVG a propósito (a diferencia de una
 * versión anterior): el único caller (`index.hbs`, dashboard) ya muestra el
 * mismo porcentaje como texto real justo arriba de la barra
 * (`.qa-progress-label strong`) — duplicarlo adentro era ruido, y ese texto
 * embebido tampoco podía garantizar contraste consigo mismo: a color de
 * relleno fijo (blanco) sobre una barra que, en porcentajes bajos, deja la
 * mayor parte del ancho ocupada por el track claro/oscuro del tema, no por
 * el relleno. Retirar el texto retira también ese riesgo de contraste sin
 * perder el requisito de "el % siempre visible como texto, no solo como
 * longitud de barra" — ese requisito lo sigue cumpliendo el label externo.
 *
 * `percentComplete` se clampea a `[0, 100]` — un caller que pase un valor
 * fuera de rango (p. ej. por un bug de redondeo previo) nunca produce una
 * barra que se desborde del `viewBox`.
 */
export function renderProgressBar(
  percentComplete: number,
  options: ProgressBarOptions = {},
): string {
  const width = options.width ?? 480;
  const height = options.height ?? 28;
  const clamped = Math.min(100, Math.max(0, percentComplete));
  const filledWidth = round((clamped / 100) * width);
  const cornerRadius = height / 2;
  const ariaLabel = `Progreso general: ${Math.round(clamped)}% completado.`;

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${escapeXml(ariaLabel)}">` +
    `<title>${escapeXml(ariaLabel)}</title>` +
    `<rect x="0" y="0" width="${width}" height="${height}" rx="${cornerRadius}" ry="${cornerRadius}" fill="currentColor" fill-opacity="0.12" data-role="track"></rect>` +
    `<rect x="0" y="0" width="${filledWidth}" height="${height}" rx="${cornerRadius}" ry="${cornerRadius}" fill="${PROGRESS_FILL_COLOR}" data-role="fill" data-percent="${round(clamped)}"></rect>` +
    `</svg>`
  );
}

/** Porcentaje de `value` sobre `total`, redondeado a entero. `0` si `total === 0` (nunca `NaN`). */
function percentOf(value: number, total: number): number {
  return total === 0 ? 0 : Math.round((value / total) * 100);
}

/** Redondea a 3 decimales — suficiente precisión visual, evita floats larguísimos en el markup (p. ej. `69.115...`). */
function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** Escapa los 5 caracteres especiales de XML. Defensivo: hoy todo el texto insertado es interno (etiquetas fijas), pero mantiene el SVG válido si eso cambia. */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

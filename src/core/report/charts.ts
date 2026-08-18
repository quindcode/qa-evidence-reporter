import type { FeatureBarData, FeatureReportView, SunburstFeatureNode } from '../types/report.js';
import type { StepResult } from '../types/session.js';

/**
 * Paleta de colores del reporte — ÚNICO lugar del código donde se definen
 * estos valores hex (ver ARCHITECTURE.md, "Gráficos del reporte"). Cualquier
 * otro módulo que necesite pintar un resultado (helpers de Handlebars en
 * `templateEngine.ts`, CSS de los templates, los 4 charts de ECharts del
 * dashboard) debe importar/reflejar estos mismos valores en vez de
 * hardcodear su propia copia — ver `RESULT_LABELS` más abajo, que sigue el
 * mismo criterio para las etiquetas en español.
 *
 * Elegidos como tonos "700/800" (oscuros y saturados, no colores planos
 * brillantes) porque dan un contraste razonable tanto usados como relleno
 * con texto blanco encima (badges) como usados como color de texto sobre
 * fondo blanco/gris claro — en ambos casos por encima o cerca del umbral
 * WCAG AA (contraste ≥ 4.5:1) para texto normal. Ningún consumidor debe
 * depender SOLO de estos colores para distinguir categorías: siempre van
 * acompañados de texto/etiqueta (ver la leyenda textual en
 * `templates/default/partials/legend.hbs`).
 *
 * Nota de diseño (por qué el gauge/doughnut/barra/sunburst de ECharts usan
 * este hex FIJO y no la variante "-on-tint" del CSS del reporte): DESIGN.md,
 * "La Regla del Contraste en Oscuro", reserva el hex fijo para "el SVG del
 * chart" — el requisito de contraste WCAG que motiva la variante on-tint
 * aplica a TEXTO/BORDE sobre una superficie propia (badge, chip, riel), no
 * al relleno de una serie de datos, que no tiene esa obligación de
 * contraste y en cambio SÍ necesita calzar exacto entre light/dark para que
 * "verde siempre es aprobado" no varíe con el tema.
 */
export const RESULT_COLORS: Readonly<Record<StepResult, string>> = {
  pass: '#15803d',
  fail: '#b91c1c',
  skip: '#475569',
  pending: '#b45309',
};

/** Etiquetas en español de cada `StepResult`, únicas para todo el reporte (ver nota de diseño de `RESULT_COLORS`). */
export const RESULT_LABELS: Readonly<Record<StepResult, string>> = {
  pass: 'Aprobado',
  fail: 'Fallido',
  skip: 'Omitido',
  pending: 'Pendiente',
};

/** Orden de dibujado/leyenda fijo para cualquier chart que itere las 4 categorías — mismos conteos siempre producen el mismo orden visual entre corridas. */
export const RESULT_ORDER: readonly StepResult[] = ['pass', 'fail', 'skip', 'pending'];

/** Cantidad mínima de features para que la barra apilada "Estado por feature" aporte algo — con 1-2 features, comparar no dice mucho (ver spec del dashboard). */
const MIN_FEATURES_FOR_BAR_CHART = 3;

/** Mínimos para que el sunburst jerárquico aporte algo en vez de ser ruido visual: al menos esta cantidad de features, y CADA una con al menos `MIN_SCENARIOS_PER_FEATURE_FOR_SUNBURST` scenarios. */
const MIN_FEATURES_FOR_SUNBURST = 3;
const MIN_SCENARIOS_PER_FEATURE_FOR_SUNBURST = 2;

/**
 * `true` si hay suficientes features para que la barra apilada "Estado por
 * feature" del dashboard aporte algo — ver `MIN_FEATURES_FOR_BAR_CHART`.
 * Función separada (no solo `features.length >= N` inline en
 * `reportGenerator.ts`) para que el umbral tenga un solo nombre buscable y
 * un test propio.
 */
export function shouldShowFeatureBars(features: readonly FeatureReportView[]): boolean {
  return features.length >= MIN_FEATURES_FOR_BAR_CHART;
}

/** `true` si hay suficientes features (todas con suficientes scenarios) para que el sunburst aporte algo — ver `MIN_FEATURES_FOR_SUNBURST`/`MIN_SCENARIOS_PER_FEATURE_FOR_SUNBURST`. */
export function shouldShowSunburst(features: readonly FeatureReportView[]): boolean {
  return (
    features.length >= MIN_FEATURES_FOR_SUNBURST &&
    features.every((feature) => feature.scenarios.length >= MIN_SCENARIOS_PER_FEATURE_FOR_SUNBURST)
  );
}

/**
 * Una barra por feature para el chart de barra apilada horizontal del
 * dashboard ("Estado por feature") — conteos a nivel SCENARIO (mismo
 * criterio que `ResultSummary` en todo el resto del reporte, ver
 * `buildReportData` en `reportGenerator.ts`: contar steps sueltos inflaría
 * el % de un feature cuyos scenarios individuales no pasaron completos).
 *
 * Ordenadas por `passRatePercent` ASCENDENTE — los features más
 * problemáticos quedan primero, así quien lee el dashboard ve de arriba
 * hacia abajo qué necesita atención antes que lo que ya está en verde (ver
 * spec: "el cliente vea primero lo que necesita atención").
 */
export function buildFeatureBars(features: readonly FeatureReportView[]): FeatureBarData[] {
  return features
    .map((feature) => ({
      name: feature.name,
      detailPath: feature.detailPath,
      pass: feature.summary.pass,
      fail: feature.summary.fail,
      skip: feature.summary.skip,
      pending: feature.summary.pending,
      total: feature.summary.total,
      passRatePercent: feature.summary.passRatePercent,
    }))
    .sort((a, b) => a.passRatePercent - b.passRatePercent);
}

/** Longitud máxima (en caracteres) del label de un nodo hoja de step en el sunburst — el texto completo del step vive en la página de detalle, acá alcanza con identificarlo, no repetirlo entero. */
const SUNBURST_STEP_NAME_MAX_LENGTH = 40;

/**
 * Árbol feature→scenario→step para el sunburst jerárquico del dashboard.
 * Nunca incluye notas, descripción de defecto, ni las evidencias en sí —
 * solo lo mínimo para pintar el nodo (nombre corto, resultado) y señalar en
 * el tooltip si ese step tiene evidencia adjunta (`hasEvidence`), sin
 * duplicar el detalle completo que ya vive en la página de la feature.
 */
export function buildSunburstData(features: readonly FeatureReportView[]): SunburstFeatureNode[] {
  return features.map((feature) => ({
    name: feature.name,
    result: feature.result,
    children: feature.scenarios.map((scenario) => ({
      name: scenario.name,
      result: scenario.result,
      children: scenario.steps.map((step) => ({
        name: truncate(`${step.keyword}: ${step.text}`, SUNBURST_STEP_NAME_MAX_LENGTH),
        result: step.result,
        hasEvidence: step.evidence.length > 0,
      })),
    })),
  }));
}

function truncate(text: string, maxLength: number): string {
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

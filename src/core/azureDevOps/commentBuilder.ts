import { RESULT_LABELS } from '../report/charts.js';
import { deriveScenarioResult } from '../types/session.js';
import type { SessionState, StepResult } from '../types/session.js';

/**
 * Arma el comentario HTML que resume la sesión publicada: por cada feature
 * seleccionada, su nombre y la lista de sus scenarios (nombre + resultado
 * derivado con `deriveScenarioResult` — NUNCA el detalle de steps, que es
 * demasiado granular para un comentario y ya vive en el `.zip` adjunto),
 * seguido de un resumen con el % de aprobado/fallado/omitido.
 *
 * A diferencia de `buildQaSummaryComment` (`core/jira/commentBuilder.ts`,
 * que produce un documento ADF), acá alcanza con un string HTML simple: la
 * API de comentarios de Azure DevOps (`POST .../workItems/{id}/comments`)
 * acepta HTML plano en su campo `text`, sin ningún formato propietario.
 *
 * Decisión de diseño (% sobre SCENARIOS, no sobre steps): mismo criterio
 * que `buildQaSummaryComment` y que `buildReportData`
 * (`core/report/reportGenerator.ts`) — un scenario con, por ejemplo, 2
 * steps pass y 1 skip deriva a "skip" como caso de prueba completo, pero si
 * se contaran los 3 steps sueltos esos 2 pass igual sumarían al total de
 * aprobados, inflando el % aunque ESE scenario no haya pasado. Contar por
 * scenario (cada uno pesa 1, con su resultado final) es también lo que
 * hace que este número coincida con el que muestra el dashboard del
 * reporte HTML.
 *
 * Nota de diseño (módulo hermano de `core/jira`, no una abstracción
 * compartida): este archivo duplica deliberadamente la forma de
 * `commentBuilder.ts` de Jira en vez de factorizar un helper común — ver
 * la nota de diseño de `JiraConfigSchema`/`AzureDevOpsConfigSchema` en
 * `core/types/config.ts` sobre por qué "módulo hermano" es la decisión
 * arquitectónica deliberada acá, no un descuido.
 */
export function buildQaSummaryCommentHtml(state: SessionState): string {
  const parts: string[] = [];
  const scenarioResults: StepResult[] = [];

  for (const feature of state.selectedFeatures) {
    parts.push(`<h3>${escapeHtml(feature.name)}</h3>`, '<ul>');
    for (const scenario of feature.scenarios) {
      const result = deriveScenarioResult(scenario);
      scenarioResults.push(result);
      parts.push(`<li>${escapeHtml(scenario.name)} — ${RESULT_LABELS[result]}</li>`);
    }
    parts.push('</ul>');
  }

  parts.push('<h3>Resumen</h3>', '<ul>', ...buildSummaryItems(scenarioResults), '</ul>');

  return parts.join('');
}

function buildSummaryItems(results: StepResult[]): string[] {
  const total = results.length;
  const counts = { pass: 0, fail: 0, skip: 0, pending: 0 };
  for (const result of results) counts[result] += 1;
  const percent = (count: number): number => (total === 0 ? 0 : Math.round((count / total) * 100));

  return [
    `<li>${RESULT_LABELS.pass}: ${percent(counts.pass)}% (${counts.pass}/${total})</li>`,
    `<li>${RESULT_LABELS.fail}: ${percent(counts.fail)}% (${counts.fail}/${total})</li>`,
    `<li>${RESULT_LABELS.skip}: ${percent(counts.skip)}% (${counts.skip}/${total})</li>`,
  ];
}

/** Escape mínimo de HTML (los nombres de feature/scenario vienen de `.feature` reales, no de un formulario, pero nunca se insertan crudos en el HTML del comentario). */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

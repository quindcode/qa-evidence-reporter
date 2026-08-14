import { RESULT_LABELS } from '../report/charts.js';
import { deriveScenarioResult } from '../types/session.js';
import type { SessionState, StepResult } from '../types/session.js';

/**
 * Documento en Atlassian Document Format (ADF) — formato que la API v3 de
 * Jira Cloud exige para el `body` de un comentario (no acepta texto plano
 * ni markdown). Solo se tipan los campos que este módulo produce; Jira
 * acepta un árbol bastante más rico que este.
 */
export interface AdfDocument {
  type: 'doc';
  version: 1;
  content: unknown[];
}

/**
 * Arma el comentario que resume la sesión publicada: por cada feature
 * seleccionada, su nombre y la lista de sus scenarios (nombre + resultado
 * derivado con `deriveScenarioResult` — NUNCA el detalle de steps, que es
 * demasiado granular para un comentario de Jira y ya vive en el `.zip`
 * adjunto), seguido de un resumen con el % de aprobado/fallado/omitido.
 *
 * Decisión de diseño (% sobre SCENARIOS, no sobre steps): mismo criterio
 * que `buildReportData` (`core/report/reportGenerator.ts`) — un scenario
 * con, por ejemplo, 2 steps pass y 1 skip deriva a "skip" como caso de
 * prueba completo, pero si se contaran los 3 steps sueltos esos 2 pass
 * igual sumarían al total de aprobados, inflando el % aunque ESE scenario
 * no haya pasado. Contar por scenario (cada uno pesa 1, con su resultado
 * final) es también lo que hace que este número SIEMPRE coincida con el
 * que ya muestra el dashboard del reporte HTML — ambas superficies deben
 * mostrar el mismo % sobre la misma base de cálculo.
 */
export function buildQaSummaryComment(state: SessionState): AdfDocument {
  const content: unknown[] = [];
  const scenarioResults: StepResult[] = [];

  for (const feature of state.selectedFeatures) {
    content.push(heading(feature.name));
    const items = feature.scenarios.map((scenario) => {
      const result = deriveScenarioResult(scenario);
      scenarioResults.push(result);
      return listItem(`${scenario.name} — ${RESULT_LABELS[result]}`);
    });
    content.push(bulletList(items));
  }

  content.push(heading('Resumen'));
  content.push(bulletList(buildSummaryItems(scenarioResults)));

  return { type: 'doc', version: 1, content };
}

function buildSummaryItems(results: StepResult[]): unknown[] {
  const total = results.length;
  const counts = { pass: 0, fail: 0, skip: 0, pending: 0 };
  for (const result of results) counts[result] += 1;
  const percent = (count: number): number => (total === 0 ? 0 : Math.round((count / total) * 100));

  return [
    listItem(`${RESULT_LABELS.pass}: ${percent(counts.pass)}% (${counts.pass}/${total})`),
    listItem(`${RESULT_LABELS.fail}: ${percent(counts.fail)}% (${counts.fail}/${total})`),
    listItem(`${RESULT_LABELS.skip}: ${percent(counts.skip)}% (${counts.skip}/${total})`),
  ];
}

function heading(text: string): unknown {
  return { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text }] };
}

function bulletList(items: unknown[]): unknown {
  return { type: 'bulletList', content: items };
}

function listItem(text: string): unknown {
  return {
    type: 'listItem',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  };
}

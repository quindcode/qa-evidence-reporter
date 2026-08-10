import { slugify } from '../shared/slugify.js';
import type { ParsedFeature, ParsedScenario } from '../types/parser.js';

/**
 * Construcción de los ids determinísticos de `FeatureExecution`/
 * `ScenarioExecution`/`StepExecution` (ver las notas de diseño en
 * `core/types/session.ts`, sección "Decisión de diseño (id)" de cada
 * interfaz). Se aíslan en su propio módulo porque `core/evidence` construye
 * exactamente la misma terna de identificadores por su cuenta a partir de
 * `ParsedFeature`/`ParsedScenario` en algunos flujos de tests de
 * integración — mantener la fórmula en un solo lugar evita que ambos
 * módulos diverjan silenciosamente.
 */

/** `"f{featureIndex}-{slug(feature.name)}"`. Único porque `featureIndex` es único dentro de `selectedFeatures`. */
export function buildFeatureId(featureIndex: number, feature: Pick<ParsedFeature, 'name'>): string {
  return `f${featureIndex}-${slugify(feature.name)}`;
}

/** `"{featureId}_s{scenarioIndex}-{slug(scenario.name)}"`. Único porque incluye el `featureId` padre. */
export function buildScenarioId(
  featureId: string,
  scenarioIndex: number,
  scenario: Pick<ParsedScenario, 'name'>,
): string {
  return `${featureId}_s${scenarioIndex}-${slugify(scenario.name)}`;
}

/**
 * `"{scenarioId}_st{stepIndex}"`. Sin slug del texto del step a propósito
 * (ver JSDoc de `StepExecution` en `core/types/session.ts`): el índice ya
 * es suficiente para unicidad dentro del scenario.
 */
export function buildStepId(scenarioId: string, stepIndex: number): string {
  return `${scenarioId}_st${stepIndex}`;
}

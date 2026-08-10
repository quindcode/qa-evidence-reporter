import type { JSX } from 'preact';

import type { SessionState } from '../types';

export interface ProgressHeaderProps {
  session: SessionState;
}

/**
 * "Feature X de Y, Scenario X de Y, Step X de Y" + barra de progreso general
 * (ARCHITECTURE.md, "UX del runner"). El progreso general se calcula sobre
 * el total de steps de TODA la sesión (no solo la feature actual), contando
 * cuántos ya dejaron de estar `'pending'` — mismo criterio que
 * `ResultSummary.completionPercent` de `core/types/report.ts` (duplicado
 * acá en vez de importado, ver `src/ui/types.ts`).
 */
export function ProgressHeader({ session }: ProgressHeaderProps): JSX.Element {
  const { featureIndex, scenarioIndex, stepIndex } = session.currentPosition;
  const totalFeatures = session.selectedFeatures.length;
  const currentFeature = session.selectedFeatures[featureIndex];
  const totalScenarios = currentFeature?.scenarios.length ?? 0;
  const currentScenario = currentFeature?.scenarios[scenarioIndex];
  const totalSteps = currentScenario?.steps.length ?? 0;

  let completed = 0;
  let total = 0;
  for (const feature of session.selectedFeatures) {
    for (const scenario of feature.scenarios) {
      for (const step of scenario.steps) {
        total += 1;
        if (step.result !== 'pending') completed += 1;
      }
    }
  }
  const percent = total === 0 ? 0 : Math.round((completed / total) * 100);

  return (
    <div class="progress-header">
      <div class="progress-header__labels">
        <span>
          Feature {featureIndex + 1} de {totalFeatures}
        </span>
        <span>
          Scenario {scenarioIndex + 1} de {totalScenarios}
        </span>
        <span>
          Step {stepIndex + 1} de {totalSteps}
        </span>
        <span class="progress-header__percent">{percent}% completado</span>
      </div>
      <div
        class="progress-bar"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div class="progress-bar__fill" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

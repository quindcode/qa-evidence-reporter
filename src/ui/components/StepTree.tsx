import type { JSX } from 'preact';
import { useState } from 'preact/hooks';

import { RESULT_COLORS } from '../colors';
import { deriveFeatureResult, deriveScenarioResult } from '../types';
import type { SessionState } from '../types';

export interface StepTreeProps {
  session: SessionState;
  currentStepId: string | undefined;
  onJump: (position: { featureIndex: number; scenarioIndex: number; stepIndex: number }) => void;
}

/**
 * Árbol lateral colapsable de features/scenarios/steps con su estado
 * (pass/fail/skip/pending), que permite saltar directamente a cualquier
 * step ya visitado (ARCHITECTURE.md, "UX del runner": "volver a un step
 * anterior para adjuntar/editar evidencia").
 *
 * Colapsa por feature (no por scenario): el volumen esperado (decenas de
 * scenarios/steps por feature, no cientos) hace que colapsar solo un nivel
 * sea suficiente para que el árbol completo entre en una sidebar razonable;
 * agregar un segundo nivel de colapso por scenario es posible pero no se
 * consideró necesario para el volumen real de una sesión de QA manual.
 */
export function StepTree({ session, currentStepId, onJump }: StepTreeProps): JSX.Element {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  function toggleFeature(featureId: string): void {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(featureId)) next.delete(featureId);
      else next.add(featureId);
      return next;
    });
  }

  return (
    <nav class="step-tree" aria-label="Árbol de features, scenarios y steps">
      {session.selectedFeatures.map((feature, featureIndex) => {
        const isCollapsed = collapsed.has(feature.id);
        const featureResult = deriveFeatureResult(feature);
        return (
          <div key={feature.id} class="step-tree__feature">
            <button
              type="button"
              class="step-tree__feature-header"
              onClick={() => toggleFeature(feature.id)}
              aria-expanded={!isCollapsed}
            >
              <span class="step-tree__caret">{isCollapsed ? '▶' : '▼'}</span>
              <span
                class="step-tree__dot"
                style={{ backgroundColor: RESULT_COLORS[featureResult] }}
                aria-hidden="true"
              />
              <span class="step-tree__label">{feature.name}</span>
            </button>

            {!isCollapsed && (
              <div class="step-tree__scenarios">
                {feature.scenarios.map((scenario, scenarioIndex) => {
                  const scenarioResult = deriveScenarioResult(scenario);
                  return (
                    <div key={scenario.id} class="step-tree__scenario">
                      <div class="step-tree__scenario-header">
                        <span
                          class="step-tree__dot"
                          style={{ backgroundColor: RESULT_COLORS[scenarioResult] }}
                          aria-hidden="true"
                        />
                        <span class="step-tree__label">{scenario.name}</span>
                      </div>
                      <ul class="step-tree__steps">
                        {scenario.steps.map((step, stepIndex) => {
                          const isCurrent = step.id === currentStepId;
                          return (
                            <li key={step.id}>
                              <button
                                type="button"
                                class={
                                  'step-tree__step' + (isCurrent ? ' step-tree__step--current' : '')
                                }
                                onClick={() => onJump({ featureIndex, scenarioIndex, stepIndex })}
                              >
                                <span
                                  class="step-tree__dot"
                                  style={{ backgroundColor: RESULT_COLORS[step.result] }}
                                  aria-hidden="true"
                                />
                                <span class="step-tree__step-keyword">{step.step.keyword}</span>
                                <span class="step-tree__step-text">{step.step.text}</span>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}

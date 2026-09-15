import type { JSX } from 'preact';
import { useState } from 'preact/hooks';

import { api } from '../api';
import type { ApiRequestError } from '../api';
import type { CurrentStepInfo, ScenarioExecution, SessionState } from '../types';

export interface ScenarioEditModalProps {
  scenario: ScenarioExecution;
  onSessionUpdate: (session: SessionState, currentStep: CurrentStepInfo | null) => void;
  onError: (error: ApiRequestError) => void;
  onClose: () => void;
}

const STEP_KEYWORD_LABEL: Record<string, string> = {
  Given: 'Dado',
  When: 'Cuando',
  Then: 'Entonces',
};

/**
 * Modal de corrección de un caso de prueba TODAVÍA pendiente (ver
 * `isScenarioEditable`/`isStepEditable`, `types.ts`, y
 * `PATCH /api/session/scenario/:scenarioId`): nombre del escenario + texto de
 * cada step propio. Los steps de `Background` se listan aparte, siempre
 * deshabilitados — son compartidos por toda la feature, nunca editables.
 *
 * Llama a `api.editScenario` directamente (no delega a `Runner.tsx`), mismo
 * criterio que `SettingsPanel`: es un formulario autocontenido con su propio
 * estado de guardado, no un control embebido que comparta el `busy` del
 * step actual.
 */
export function ScenarioEditModal({
  scenario,
  onSessionUpdate,
  onError,
  onClose,
}: ScenarioEditModalProps): JSX.Element {
  const [name, setName] = useState(scenario.name);
  const ownSteps = scenario.steps.filter((step) => !step.step.fromBackground);
  const backgroundSteps = scenario.steps.filter((step) => step.step.fromBackground);
  const [stepTexts, setStepTexts] = useState<Record<string, string>>(() =>
    Object.fromEntries(ownSteps.map((step) => [step.id, step.step.text])),
  );
  const [saving, setSaving] = useState(false);

  async function handleSave(event: JSX.TargetedEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    const trimmedName = name.trim();
    const changedName = trimmedName.length > 0 && trimmedName !== scenario.name ? trimmedName : undefined;
    const changedSteps = ownSteps
      .map((step) => ({ stepId: step.id, text: (stepTexts[step.id] ?? '').trim(), original: step.step.text }))
      .filter((change) => change.text.length > 0 && change.text !== change.original)
      .map(({ stepId, text }) => ({ stepId, text }));

    if (changedName === undefined && changedSteps.length === 0) {
      onClose();
      return;
    }

    setSaving(true);
    try {
      const response = await api.editScenario(scenario.id, {
        name: changedName,
        steps: changedSteps.length > 0 ? changedSteps : undefined,
      });
      onSessionUpdate(response.session, response.currentStep);
      onClose();
    } catch (error) {
      onError(error as ApiRequestError);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div class="modal-overlay" role="presentation" onClick={onClose}>
      <div
        class="modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Editar caso de prueba "${scenario.name}"`}
        onClick={(event) => event.stopPropagation()}
      >
        <h3>Editar caso de prueba</h3>
        <p class="modal__hint">
          Solo se puede corregir texto (nombre y steps) — este caso de prueba todavía no tiene
          ningún resultado asignado. En cuanto marques pass/fail/skip, se bloquea.
        </p>

        <form class="modal__form" onSubmit={(event) => void handleSave(event)}>
          <label class="field">
            <span class="field__label">Nombre del escenario</span>
            <input
              type="text"
              class="field__input"
              value={name}
              onInput={(event) => setName((event.target as HTMLInputElement).value)}
              disabled={saving}
              required
            />
          </label>

          {ownSteps.map((step) => (
            <label class="field" key={step.id}>
              <span class="field__label">
                {STEP_KEYWORD_LABEL[step.step.keyword] ?? step.step.keyword}
              </span>
              <textarea
                class="field__input"
                rows={2}
                value={stepTexts[step.id] ?? ''}
                onInput={(event) =>
                  setStepTexts((current) => ({
                    ...current,
                    [step.id]: (event.target as HTMLTextAreaElement).value,
                  }))
                }
                disabled={saving}
                required
              />
            </label>
          ))}

          {backgroundSteps.length > 0 && (
            <div class="modal__background-steps">
              <span class="field__label">
                Steps de Background (compartidos por toda la feature, no editables)
              </span>
              <ul class="modal__background-steps-list">
                {backgroundSteps.map((step) => (
                  <li key={step.id}>
                    <span class="step-tree__step-keyword">
                      {STEP_KEYWORD_LABEL[step.step.keyword] ?? step.step.keyword}
                    </span>{' '}
                    {step.step.text}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div class="modal__actions">
            <button type="button" class="button" onClick={onClose} disabled={saving}>
              Cancelar
            </button>
            <button type="submit" class="button button--primary" disabled={saving}>
              Guardar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

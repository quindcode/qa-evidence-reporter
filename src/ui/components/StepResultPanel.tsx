import type { JSX, Ref } from 'preact';

export interface StepResultPanelProps {
  notes: string;
  defectDescription: string;
  onNotesChange: (value: string) => void;
  onDefectDescriptionChange: (value: string) => void;
  busy: boolean;
  defectFieldRef: Ref<HTMLTextAreaElement>;
  onPass: () => void;
  onFail: () => void;
  onSkip: () => void;
}

/**
 * Notas + descripción de defecto + botones Pass/Fail/Skip del step actual.
 *
 * Componente CONTROLADO a propósito (recibe `notes`/`defectDescription` y
 * sus `onChange` en vez de manejar su propio `useState` interno): el atajo
 * de teclado `F` (ver `Runner.tsx`, `useKeyboardShortcuts`) necesita leer el
 * valor ACTUAL de `defectDescription` para decidir si enfoca el campo (vacío)
 * o dispara el submit (ya tiene texto) — ARCHITECTURE.md, "UX del runner":
 * "F (fail — enfoca el campo de descripción de defecto si aún no tiene
 * texto)". Si el estado viviera encapsulado acá, `Runner` no podría leerlo
 * sin duplicar una segunda fuente de verdad.
 *
 * Validación de "Fail" (consigna de esta fase: "validación en el cliente
 * ANTES de llamar a la API"): el botón "Fallido" queda deshabilitado
 * mientras `defectDescription` esté vacío (tras `trim()}`); el servidor
 * SIGUE validando lo mismo (`INVALID_STEP_TRANSITION`, ver
 * `core/session/sessionEngine.ts`) como defensa en profundidad.
 */
export function StepResultPanel({
  notes,
  defectDescription,
  onNotesChange,
  onDefectDescriptionChange,
  busy,
  defectFieldRef,
  onPass,
  onFail,
  onSkip,
}: StepResultPanelProps): JSX.Element {
  const canFail = defectDescription.trim().length > 0;

  return (
    <div class="step-result-panel">
      <label class="field">
        <span class="field__label">Notas / observaciones</span>
        <textarea
          class="field__input"
          rows={2}
          value={notes}
          onInput={(event) => onNotesChange((event.target as HTMLTextAreaElement).value)}
          placeholder="Opcional: cualquier observación sobre este step."
        />
      </label>

      <label class="field">
        <span class="field__label">
          Descripción del defecto{' '}
          {!canFail && <span class="field__required">(obligatoria para Fallido)</span>}
        </span>
        <textarea
          ref={defectFieldRef}
          class="field__input"
          rows={2}
          value={defectDescription}
          onInput={(event) =>
            onDefectDescriptionChange((event.target as HTMLTextAreaElement).value)
          }
          placeholder="Qué salió mal, con el detalle suficiente para reproducirlo."
        />
      </label>

      <div class="step-result-panel__actions">
        <button
          type="button"
          class="button button--pass"
          disabled={busy}
          onClick={onPass}
          title="Atajo: P"
        >
          ✓ Pass
        </button>
        <button
          type="button"
          class="button button--fail"
          disabled={busy || !canFail}
          onClick={onFail}
          title="Atajo: F"
        >
          ✕ Fail
        </button>
        <button
          type="button"
          class="button button--skip"
          disabled={busy}
          onClick={onSkip}
          title="Atajo: S"
        >
          ⤼ Skip
        </button>
      </div>
    </div>
  );
}

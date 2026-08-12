import type { JSX } from 'preact';
import { useMemo, useState } from 'preact/hooks';

import type { FeatureSummary, SessionSummary } from '../types';

export interface FeatureSelectProps {
  features: FeatureSummary[];
  sessionSummary: SessionSummary;
  busy: boolean;
  onStart: (featureIds: string[], force: boolean) => void;
  onContinue: () => void;
}

const SESSION_STATUS_LABELS: Record<string, string> = {
  not_started: 'no iniciada',
  in_progress: 'en curso',
  completed: 'completada',
  paused: 'pausada',
};

/**
 * Pantalla de selección de features (`GET /api/features` ya resuelto por el
 * caller). Si ya hay una sesión (sin completar O completada), ofrece
 * continuarla en vez de forzar una selección nueva (ver ARCHITECTURE.md,
 * "UX del runner").
 *
 * Decisión de diseño (`onContinue` también para sesiones `'completed'`,
 * corregido tras un incidente real — ver ARCHITECTURE.md "Cambios
 * registrados"): antes, una sesión completada solo mostraba un aviso SIN
 * ninguna acción real ("podés revisar su reporte" sin ningún botón para
 * hacerlo), y "Iniciar ejecución" nunca reintentaba con `?force=true` para
 * ese caso — como el server exige esa confirmación apenas hay progreso
 * real registrado (sin importar `status`), esto dejaba al QA totalmente
 * bloqueado: no podía ni seguir viendo su sesión completada (para generar/
 * exportar el reporte) ni empezar una nueva. Ahora CUALQUIER sesión
 * existente (con progreso o no, completada o no) ofrece "Continuar
 * sesión" para entrar al runner (donde están los botones de reporte y
 * "Cerrar sesión", ver `Runner.tsx`), y el flujo de "Iniciar ejecución"
 * confirma y reintenta con `force=true` para cualquier sesión existente,
 * no solo las sin terminar.
 */
export function FeatureSelect({
  features,
  sessionSummary,
  busy,
  onStart,
  onContinue,
}: FeatureSelectProps): JSX.Element {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const hasExistingSession = sessionSummary.exists;
  const isUnfinishedSession = sessionSummary.exists && sessionSummary.status !== 'completed';
  const isCompletedSession = sessionSummary.exists && sessionSummary.status === 'completed';

  const allSelected = useMemo(
    () => features.length > 0 && selected.size === features.length,
    [features, selected],
  );

  function toggle(id: string): void {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll(): void {
    setSelected(allSelected ? new Set() : new Set(features.map((feature) => feature.id)));
  }

  function handleStart(): void {
    if (selected.size === 0) return;
    // Reseleccionar sobre CUALQUIER sesión existente (completada o no)
    // requiere `force=true` si tiene progreso real registrado (ver
    // `POST /api/session/select`, 409 SESSION_ALREADY_IN_PROGRESS —
    // `routes/session.ts`, `sessionHasRecordedProgress`). Se confirma acá
    // de todas formas para cualquier sesión existente: el servidor es la
    // fuente de verdad real de si había algo que perder, pero no tiene
    // sentido pasar `force=true` a ciegas sin avisar primero.
    if (hasExistingSession) {
      const confirmed = window.confirm(
        isCompletedSession
          ? 'La última sesión ya se completó. Iniciar una nueva selección descarta su progreso ' +
              '(evidencia, resultados y notas) si todavía no generaste/exportaste su reporte. ' +
              '¿Continuar igual?'
          : 'Ya hay una sesión en curso sin completar. Iniciar una nueva selección descarta ' +
              'su progreso (evidencia y resultados no exportados a un reporte). ¿Continuar igual?',
      );
      if (!confirmed) return;
    }
    onStart(Array.from(selected), hasExistingSession);
  }

  return (
    <div class="feature-select">
      {isUnfinishedSession && (
        <div class="session-banner" role="status">
          <p>
            Hay una sesión {SESSION_STATUS_LABELS[sessionSummary.status] ?? sessionSummary.status}{' '}
            de <strong>{sessionSummary.exists ? sessionSummary.projectName : ''}</strong> sin
            terminar.
          </p>
          <button type="button" class="button button--primary" onClick={onContinue} disabled={busy}>
            Continuar sesión
          </button>
        </div>
      )}
      {isCompletedSession && (
        <div class="session-banner session-banner--info" role="status">
          <p>
            La última sesión de{' '}
            <strong>{sessionSummary.exists ? sessionSummary.projectName : ''}</strong> ya se
            completó.
          </p>
          <button type="button" class="button button--primary" onClick={onContinue} disabled={busy}>
            Ver sesión / generar reporte
          </button>
        </div>
      )}

      <div class="feature-select__header">
        <h2>Seleccioná las features a ejecutar</h2>
        {features.length > 0 && (
          <button type="button" class="button button--link" onClick={toggleAll}>
            {allSelected ? 'Deseleccionar todas' : 'Seleccionar todas'}
          </button>
        )}
      </div>

      {features.length === 0 ? (
        <p class="empty-state">
          No se encontraron archivos <code>.feature</code> en el directorio configurado.
        </p>
      ) : (
        <ul class="feature-list">
          {features.map((feature) => (
            <li key={feature.id} class="feature-card">
              <label class="feature-card__label">
                <input
                  type="checkbox"
                  checked={selected.has(feature.id)}
                  onChange={() => toggle(feature.id)}
                />
                <div class="feature-card__body">
                  <span class="feature-card__name">{feature.name}</span>
                  {feature.description && (
                    <p class="feature-card__description">{feature.description}</p>
                  )}
                  <div class="feature-card__meta">
                    <span class="feature-card__scenario-count">
                      {feature.scenarioCount} escenario{feature.scenarioCount === 1 ? '' : 's'}
                    </span>
                    {feature.tags.map((tag) => (
                      <span key={tag} class="tag">
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              </label>
            </li>
          ))}
        </ul>
      )}

      <div class="feature-select__actions">
        <button
          type="button"
          class="button button--primary"
          disabled={selected.size === 0 || busy}
          onClick={handleStart}
        >
          Iniciar ejecución ({selected.size})
        </button>
      </div>
    </div>
  );
}

import type { JSX } from 'preact';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';

import { api } from '../api';
import type { ApiRequestError } from '../api';
import { EvidenceArea } from './EvidenceArea';
import { ProgressHeader } from './ProgressHeader';
import { StepResultPanel } from './StepResultPanel';
import { StepTree } from './StepTree';
import { getCurrentStepFromSession } from '../types';
import type { CurrentStepInfo, EvidenceFile, SessionState, StepResult } from '../types';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';

export interface RunnerProps {
  session: SessionState;
  currentStep: CurrentStepInfo | null;
  onSessionUpdate: (session: SessionState, currentStep: CurrentStepInfo | null) => void;
  onError: (error: ApiRequestError) => void;
  /** Llamado después de `POST /api/session/close` exitoso — el caller (`App.tsx`) vuelve a la pantalla de selección. */
  onSessionClosed: () => void;
}

const STEP_KEYWORD_LABEL: Record<string, string> = {
  Given: 'Dado',
  When: 'Cuando',
  Then: 'Entonces',
};

/**
 * Pantalla de ejecución paso a paso: feature/scenario/step actual + barra de
 * progreso, evidencia, notas/defecto, botones de resultado, navegación
 * manual y árbol lateral (ARCHITECTURE.md, "UX del runner").
 */
export function Runner({
  session,
  currentStep,
  onSessionUpdate,
  onError,
  onSessionClosed,
}: RunnerProps): JSX.Element {
  const [evidenceFiles, setEvidenceFiles] = useState<EvidenceFile[]>([]);
  const [loadingEvidence, setLoadingEvidence] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notes, setNotes] = useState('');
  const [defectDescription, setDefectDescription] = useState('');
  const [reportUrl, setReportUrl] = useState<string | null>(null);
  const defectFieldRef = useRef<HTMLTextAreaElement>(null);

  const stepId = currentStep?.step.id;

  // Al cambiar de step (navegación, o al saltar desde el árbol lateral): se
  // recarga la evidencia real desde el server (`GET
  // /api/session/step/:stepId/evidence`, agregado en esta fase — ver
  // ARCHITECTURE.md "Fase 5b") y se resetean notas/defecto al valor ya
  // guardado de ESE step, no al del step anterior.
  useEffect(() => {
    setNotes(currentStep?.step.notes ?? '');
    setDefectDescription(currentStep?.step.defectDescription ?? '');

    if (!stepId) {
      setEvidenceFiles([]);
      return;
    }

    let cancelled = false;
    setLoadingEvidence(true);
    api
      .getStepEvidence(stepId)
      .then((response) => {
        if (!cancelled) setEvidenceFiles(response.evidenceFiles);
      })
      .catch((error: ApiRequestError) => onError(error))
      .finally(() => {
        if (!cancelled) setLoadingEvidence(false);
      });

    return () => {
      cancelled = true;
    };
  }, [stepId]);

  const refreshEvidence = useCallback(
    (targetStepId: string) => {
      api
        .getStepEvidence(targetStepId)
        .then((response) => setEvidenceFiles(response.evidenceFiles))
        .catch((error: ApiRequestError) => onError(error));
    },
    [onError],
  );

  async function handleUpload(files: File[]): Promise<void> {
    if (!stepId) return;
    setUploading(true);
    try {
      const response = await api.uploadEvidence(stepId, files);
      onSessionUpdate(response.session, getCurrentStepFromSession(response.session));
      refreshEvidence(stepId);
    } catch (error) {
      onError(error as ApiRequestError);
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(evidenceId: string): Promise<void> {
    if (!stepId) return;
    try {
      const response = await api.deleteEvidence(stepId, evidenceId);
      onSessionUpdate(response.session, getCurrentStepFromSession(response.session));
      refreshEvidence(stepId);
    } catch (error) {
      onError(error as ApiRequestError);
    }
  }

  async function handleSubmitResult(result: StepResult): Promise<void> {
    if (!stepId || busy) return;

    // Validación de cliente ANTES de llamar a la API (consigna de esta
    // fase). El servidor valida lo mismo (`INVALID_STEP_TRANSITION`) como
    // defensa en profundidad, pero no queremos ni siquiera intentar la
    // request si ya sabemos que va a fallar.
    if (result === 'fail' && defectDescription.trim().length === 0) {
      defectFieldRef.current?.focus();
      return;
    }

    setBusy(true);
    try {
      const resultResponse = await api.setStepResult(stepId, result, {
        notes: notes || undefined,
        defectDescription: result === 'fail' ? defectDescription : undefined,
      });
      // Avanza automáticamente al siguiente step tras marcar un resultado
      // (ARCHITECTURE.md, "UX del runner").
      const navigateResponse = await api.navigateNext();
      onSessionUpdate(navigateResponse.session, navigateResponse.currentStep);
      void resultResponse;
    } catch (error) {
      onError(error as ApiRequestError);
    } finally {
      setBusy(false);
    }
  }

  async function handleNavigate(direction: 'next' | 'previous'): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      const response =
        direction === 'next' ? await api.navigateNext() : await api.navigatePrevious();
      onSessionUpdate(response.session, response.currentStep);
    } catch (error) {
      onError(error as ApiRequestError);
    } finally {
      setBusy(false);
    }
  }

  async function handleJump(position: {
    featureIndex: number;
    scenarioIndex: number;
    stepIndex: number;
  }): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      const response = await api.navigateTo(position);
      onSessionUpdate(response.session, response.currentStep);
    } catch (error) {
      onError(error as ApiRequestError);
    } finally {
      setBusy(false);
    }
  }

  async function handleGenerateReport(): Promise<void> {
    setBusy(true);
    try {
      const response = await api.generateReport();
      setReportUrl(response.reportUrl);
    } catch (error) {
      onError(error as ApiRequestError);
    } finally {
      setBusy(false);
    }
  }

  /**
   * "Cerrar sesión" — agregado tras un incidente real (ver ARCHITECTURE.md,
   * "Cambios registrados"): una vez que el server exige `?force=true` para
   * descartar una sesión con progreso registrado (sin importar `status`),
   * un QA que ya generó/exportó su reporte necesita una forma EXPLÍCITA de
   * decir "terminé con esto" para poder empezar una selección nueva sin
   * ese chequeo de por medio. Confirma primero si TODAVÍA no se generó
   * ningún reporte en esta sesión (`reportUrl` sigue `null`) — si ya se
   * generó, cerrar es sencillamente "prolijo", no arriesga nada.
   */
  async function handleCloseSession(): Promise<void> {
    if (!reportUrl) {
      const confirmed = window.confirm(
        'Todavía no generaste el reporte de esta sesión. Cerrarla ahora no borra la evidencia ' +
          'ya adjuntada (queda en disco), pero perdés la posibilidad de retomarla o de generar ' +
          'un reporte con sus resultados. ¿Cerrar igual?',
      );
      if (!confirmed) return;
    }

    setBusy(true);
    try {
      await api.closeSession();
      onSessionClosed();
    } catch (error) {
      onError(error as ApiRequestError);
    } finally {
      setBusy(false);
    }
  }

  useKeyboardShortcuts(
    {
      onPass: () => void handleSubmitResult('pass'),
      onFail: () => void handleSubmitResult('fail'),
      onSkip: () => void handleSubmitResult('skip'),
      onNext: () => void handleNavigate('next'),
      onPrevious: () => void handleNavigate('previous'),
    },
    !busy,
  );

  const currentFeature = session.selectedFeatures[session.currentPosition.featureIndex];
  const currentScenario = currentFeature?.scenarios[session.currentPosition.scenarioIndex];

  return (
    <div class="runner">
      <aside class="runner__sidebar">
        <StepTree session={session} currentStepId={stepId} onJump={handleJump} />
      </aside>

      <div class="runner__main">
        <ProgressHeader session={session} />

        {session.status === 'completed' && (
          <div class="session-banner session-banner--info" role="status">
            Sesión completada. Podés seguir revisando/editando evidencia o generar el reporte.
          </div>
        )}

        {currentStep ? (
          <>
            <section class="current-step">
              <h2 class="current-step__scenario">{currentScenario?.name}</h2>
              <p class="current-step__text">
                <span class="current-step__keyword">
                  {STEP_KEYWORD_LABEL[currentStep.step.step.keyword] ??
                    currentStep.step.step.keyword}
                </span>{' '}
                {currentStep.step.step.text}
              </p>
            </section>

            <section class="panel">
              <h3>Evidencia</h3>
              {loadingEvidence ? (
                <p class="empty-state">Cargando evidencia…</p>
              ) : (
                <EvidenceArea
                  evidenceFiles={evidenceFiles}
                  uploading={uploading}
                  onUpload={(files) => void handleUpload(files)}
                  onDelete={(id) => void handleDelete(id)}
                />
              )}
            </section>

            <section class="panel">
              <StepResultPanel
                notes={notes}
                defectDescription={defectDescription}
                onNotesChange={setNotes}
                onDefectDescriptionChange={setDefectDescription}
                busy={busy}
                defectFieldRef={defectFieldRef}
                onPass={() => void handleSubmitResult('pass')}
                onFail={() => void handleSubmitResult('fail')}
                onSkip={() => void handleSubmitResult('skip')}
              />
            </section>

            <nav class="runner__nav">
              <button
                type="button"
                class="button"
                onClick={() => void handleNavigate('previous')}
                disabled={busy}
                title="Atajo: B"
              >
                ← Anterior
              </button>
              <button
                type="button"
                class="button"
                onClick={() => void handleNavigate('next')}
                disabled={busy}
                title="Atajo: N"
              >
                Siguiente →
              </button>
            </nav>
          </>
        ) : (
          <p class="empty-state">No hay ningún step seleccionado.</p>
        )}

        <section class="panel report-panel">
          <h3>Reporte</h3>
          <div class="report-panel__actions">
            <button
              type="button"
              class="button button--primary"
              onClick={() => void handleGenerateReport()}
              disabled={busy}
            >
              Generar reporte
            </button>
            {reportUrl && (
              <>
                <a class="button" href={reportUrl} target="_blank" rel="noreferrer">
                  Ver reporte
                </a>
                <a class="button button--cta" href="/api/report/export-zip" download="qa-report.zip">
                  Exportar como ZIP
                </a>
              </>
            )}
            <button
              type="button"
              class="button button--danger-outline"
              onClick={() => void handleCloseSession()}
              disabled={busy}
            >
              Cerrar sesión
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}

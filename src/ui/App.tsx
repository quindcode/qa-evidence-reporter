import type { JSX } from 'preact';
import { useCallback, useEffect, useState } from 'preact/hooks';

import { api } from './api';
import { ApiRequestError } from './api';
import { ErrorBanner } from './components/ErrorBanner';
import { FeatureSelect } from './components/FeatureSelect';
import { Runner } from './components/Runner';
import { ThemeToggle } from './components/ThemeToggle';
import { useTheme } from './hooks/useTheme';
import type { CurrentStepInfo, FeatureSummary, SessionState, SessionSummary } from './types';

type Phase = 'loading' | 'select' | 'runner';

/**
 * Componente raíz: decide entre la pantalla de selección de features y el
 * runner paso a paso, según haya (o no) una sesión existente — ver
 * `GET /api/features` -> `session` (`routes/features.ts`).
 */
export function App(): JSX.Element {
  const { theme, toggleTheme } = useTheme();

  const [phase, setPhase] = useState<Phase>('loading');
  const [features, setFeatures] = useState<FeatureSummary[]>([]);
  const [sessionSummary, setSessionSummary] = useState<SessionSummary>({ exists: false });
  const [session, setSession] = useState<SessionState | null>(null);
  const [currentStep, setCurrentStep] = useState<CurrentStepInfo | null>(null);
  const [error, setError] = useState<ApiRequestError | null>(null);
  const [busy, setBusy] = useState(false);

  const loadFeatures = useCallback(async () => {
    try {
      const response = await api.getFeatures();
      setFeatures(response.features);
      setSessionSummary(response.session);
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err : new ApiRequestError('UNKNOWN_ERROR', String(err)),
      );
    } finally {
      setPhase('select');
    }
  }, []);

  useEffect(() => {
    void loadFeatures();
  }, [loadFeatures]);

  async function handleStart(featureIds: string[], force: boolean): Promise<void> {
    setBusy(true);
    try {
      const response = await api.selectFeatures(featureIds, force);
      setSession(response.session);
      setCurrentStep(response.currentStep);
      setPhase('runner');
    } catch (err) {
      setError(err as ApiRequestError);
    } finally {
      setBusy(false);
    }
  }

  async function handleContinue(): Promise<void> {
    setBusy(true);
    try {
      const response = await api.getSession();
      setSession(response.session);
      setCurrentStep(response.currentStep);
      setPhase('runner');
    } catch (err) {
      setError(err as ApiRequestError);
    } finally {
      setBusy(false);
    }
  }

  function handleSessionUpdate(
    nextSession: SessionState,
    nextCurrentStep: CurrentStepInfo | null,
  ): void {
    setSession(nextSession);
    setCurrentStep(nextCurrentStep);
  }

  return (
    <div class="app">
      <header class="app-header">
        <h1 class="app-header__title">qa-evidence-reporter</h1>
        <ThemeToggle theme={theme} onToggle={toggleTheme} />
      </header>

      {error && (
        <ErrorBanner code={error.code} message={error.message} onDismiss={() => setError(null)} />
      )}

      <main class="app-main">
        {phase === 'loading' && <p class="empty-state">Cargando…</p>}

        {phase === 'select' && (
          <FeatureSelect
            features={features}
            sessionSummary={sessionSummary}
            busy={busy}
            onStart={(ids, force) => void handleStart(ids, force)}
            onContinue={() => void handleContinue()}
          />
        )}

        {phase === 'runner' && session && (
          <Runner
            session={session}
            currentStep={currentStep}
            onSessionUpdate={handleSessionUpdate}
            onError={setError}
          />
        )}
      </main>
    </div>
  );
}

import type { JSX } from 'preact';
import { useCallback, useEffect, useState } from 'preact/hooks';

import { api } from './api';
import { ApiRequestError } from './api';
import { ErrorBanner } from './components/ErrorBanner';
import { FeatureSelect } from './components/FeatureSelect';
import { Runner } from './components/Runner';
import { ThemeToggle } from './components/ThemeToggle';
import { pickReadableTextColor } from './colors';
import { useTheme } from './hooks/useTheme';
import type {
  Branding,
  CurrentStepInfo,
  FeatureSummary,
  SessionState,
  SessionSummary,
} from './types';

type Phase = 'loading' | 'select' | 'runner';

const NO_BRANDING: Branding = {
  logoUrl: null,
  primaryColor: null,
  accentColor: null,
  highlightColor: null,
  ctaColor: null,
};

/**
 * Aplica la paleta de marca como custom properties inline en `<html>` — un
 * estilo inline gana por sobre CUALQUIER regla de `styles.css` en cualquier
 * tema (claro/oscuro/`prefers-color-scheme`), sin necesitar `!important`
 * (ver comentario de estas variables en `styles.css`, `:root`). No hace
 * nada por los campos que vienen `null` (el CSS ya tiene un default
 * razonable para ese caso — "sin branding configurado, se ve como
 * siempre").
 */
function applyBranding(branding: Branding): void {
  const root = document.documentElement.style;

  if (branding.accentColor) {
    root.setProperty('--accent', branding.accentColor);
    root.setProperty('--accent-contrast', pickReadableTextColor(branding.accentColor));
  }
  if (branding.primaryColor) {
    root.setProperty('--brand-primary', branding.primaryColor);
    root.setProperty('--brand-primary-contrast', pickReadableTextColor(branding.primaryColor));
  }
  if (branding.highlightColor) {
    root.setProperty('--brand-highlight', branding.highlightColor);
  }
  if (branding.ctaColor) {
    root.setProperty('--brand-cta', branding.ctaColor);
    root.setProperty('--brand-cta-contrast', pickReadableTextColor(branding.ctaColor));
  }
}

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
  const [projectName, setProjectName] = useState('qa-evidence-reporter');
  const [branding, setBranding] = useState<Branding>(NO_BRANDING);
  const [jiraEnabled, setJiraEnabled] = useState(false);
  const [azureDevOpsEnabled, setAzureDevOpsEnabled] = useState(false);

  const loadFeatures = useCallback(async () => {
    try {
      const response = await api.getFeatures();
      setFeatures(response.features);
      setSessionSummary(response.session);
      setProjectName(response.projectName);
      setBranding(response.branding);
      applyBranding(response.branding);
      setJiraEnabled(response.jira.enabled);
      setAzureDevOpsEnabled(response.azureDevOps.enabled);
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

  const isBranded = Boolean(branding.logoUrl || branding.primaryColor);

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

  /**
   * Tras "Cerrar sesión" (`Runner.tsx` -> `POST /api/session/close`): vuelve
   * a la pantalla de selección, recargando `GET /api/features` para que
   * `sessionSummary` refleje que ya no hay ninguna sesión (`exists: false`)
   * — sin este reload, la pantalla de selección seguiría mostrando el
   * banner de la sesión recién cerrada hasta el próximo refresh manual.
   */
  function handleSessionClosed(): void {
    setSession(null);
    setCurrentStep(null);
    void loadFeatures();
  }

  return (
    <div class="app">
      <header class={`app-header${isBranded ? ' app-header--branded' : ''}`}>
        <div class="app-header__brand">
          {branding.logoUrl && (
            <img class="app-header__logo" src={branding.logoUrl} alt={`Logo de ${projectName}`} />
          )}
          <h1 class="app-header__title">{projectName}</h1>
        </div>
        <ThemeToggle theme={theme} onToggle={toggleTheme} />
      </header>
      {isBranded && <div class="app-header__stripe" aria-hidden="true" />}

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
            onSessionClosed={handleSessionClosed}
            jiraEnabled={jiraEnabled}
            azureDevOpsEnabled={azureDevOpsEnabled}
          />
        )}
      </main>
    </div>
  );
}

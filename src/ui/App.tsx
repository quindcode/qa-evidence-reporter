import type { JSX } from 'preact';
import { useCallback, useEffect, useState } from 'preact/hooks';

import { api } from './api';
import { ApiRequestError } from './api';
import { ErrorBanner } from './components/ErrorBanner';
import { FeatureSelect } from './components/FeatureSelect';
import { Runner } from './components/Runner';
import { SettingsPanel } from './components/SettingsPanel';
import { ThemeToggle } from './components/ThemeToggle';
import { pickReadableTextColor } from './colors';
import { useTheme } from './hooks/useTheme';
import type {
  Branding,
  CurrentStepInfo,
  FeatureSummary,
  Settings,
  SessionState,
  SessionSummary,
} from './types';

type Phase = 'loading' | 'select' | 'runner' | 'settings';

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
  const [jiraTokenConfigured, setJiraTokenConfigured] = useState(false);
  const [azureDevOpsTokenConfigured, setAzureDevOpsTokenConfigured] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);
  // A qué fase volver al cerrar Configuración — 'select' o 'runner', nunca
  // 'settings' ni 'loading' (no tendría sentido "volver" a esas dos).
  const [phaseBeforeSettings, setPhaseBeforeSettings] = useState<Phase>('select');

  /**
   * `resetToSelect`: por defecto `true` (el uso original — carga inicial de
   * la app y "Cerrar sesión", donde SÍ corresponde terminar en la pantalla
   * de selección). `handleSettingsUpdate` la llama con `false`: guardar el
   * token de Jira/Azure DevOps desde Configuración (típicamente para
   * resolver el aviso "Token no configurado" del propio Runner, ver
   * `Runner.tsx`) no debería expulsar al usuario de su sesión en curso de
   * vuelta a la selección de features — solo refrescar
   * `jiraEnabled`/`azureDevOpsEnabled`/`tokenConfigured` en segundo plano.
   */
  const loadFeatures = useCallback(async (resetToSelect = true) => {
    try {
      const response = await api.getFeatures();
      setFeatures(response.features);
      setSessionSummary(response.session);
      setProjectName(response.projectName);
      setBranding(response.branding);
      applyBranding(response.branding);
      setJiraEnabled(response.jira.enabled);
      setAzureDevOpsEnabled(response.azureDevOps.enabled);
      setJiraTokenConfigured(response.jira.tokenConfigured);
      setAzureDevOpsTokenConfigured(response.azureDevOps.tokenConfigured);
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err : new ApiRequestError('UNKNOWN_ERROR', String(err)),
      );
    } finally {
      if (resetToSelect) setPhase('select');
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

  async function handleOpenSettings(): Promise<void> {
    setBusy(true);
    try {
      const response = await api.getSettings();
      setSettings(response);
      setPhaseBeforeSettings(phase === 'settings' ? 'select' : phase);
      setPhase('settings');
    } catch (err) {
      setError(err as ApiRequestError);
    } finally {
      setBusy(false);
    }
  }

  /**
   * Tras cualquier cambio en Configuración (el PATCH no-secreto o un token):
   * actualiza el estado local del panel Y recarga `GET /api/features` — el
   * nombre de proyecto/logo del header y `jiraEnabled`/`azureDevOpsEnabled`
   * (que deciden si `Runner` muestra los botones de publicar) viven en ESE
   * estado, no en `settings`, así que sin este refresh quedarían mostrando
   * datos viejos hasta la próxima recarga completa de la página.
   * `resetToSelect: false` — guardar un token no debe expulsar al usuario
   * de su sesión en curso de vuelta a la pantalla de selección (ver JSDoc
   * de `loadFeatures`); `handleCloseSettings` ya sabe volver a la fase
   * correcta (`phaseBeforeSettings`) cuando el usuario cierra Configuración.
   */
  function handleSettingsUpdate(nextSettings: Settings): void {
    setSettings(nextSettings);
    void loadFeatures(false);
  }

  function handleCloseSettings(): void {
    setPhase(phaseBeforeSettings);
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
        <div class="app-header__actions">
          <button
            type="button"
            class="button button--link"
            onClick={() => void handleOpenSettings()}
            disabled={busy}
          >
            ⚙️ Configuración
          </button>
          <ThemeToggle theme={theme} onToggle={toggleTheme} />
        </div>
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
            jiraTokenConfigured={jiraTokenConfigured}
            azureDevOpsTokenConfigured={azureDevOpsTokenConfigured}
          />
        )}

        {phase === 'settings' && settings && (
          <SettingsPanel
            settings={settings}
            onSettingsUpdate={handleSettingsUpdate}
            onError={setError}
            onClose={handleCloseSettings}
          />
        )}
      </main>
    </div>
  );
}

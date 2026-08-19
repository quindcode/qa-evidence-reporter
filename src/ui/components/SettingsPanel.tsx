import type { JSX } from 'preact';
import { useState } from 'preact/hooks';

import { api, ApiRequestError } from '../api';
import type { Settings } from '../types';

export interface SettingsPanelProps {
  settings: Settings;
  onSettingsUpdate: (settings: Settings) => void;
  onError: (error: ApiRequestError) => void;
  onClose: () => void;
}

/**
 * Pantalla de "Configuración" — nombre de proyecto + integraciones de Jira/
 * Azure DevOps, editables desde el UI en vez de tener que tocar
 * `qa-config.json` a mano (ver la conversación de producto que motivó esto).
 *
 * Dos formularios con vidas MUY distintas, reflejando la separación de
 * `SettingsService` (`adapters/server/settingsService.ts`):
 *
 * 1. **Nombre de proyecto + `baseUrl`/`email`/`organizationUrl`/`project`**:
 *    un solo `PATCH /api/settings`, PERSISTE en `qa-config.json` — sigue así
 *    después de cerrar el runner o reiniciar el server, como si se hubiera
 *    editado el archivo a mano.
 * 2. **Token de Jira / PAT de Azure DevOps**: cada uno con su propio botón
 *    "Guardar", que llama a `POST /api/settings/jira-token` (o
 *    `azure-token`) — vive SOLO en memoria del proceso del server mientras
 *    siga corriendo, nunca en disco. Por eso el campo siempre arranca
 *    vacío (nunca se precarga con nada, ni siquiera un placeholder que
 *    insinúe el valor) y solo muestra si HAY un token configurado ahora
 *    (`tokenConfigured`), nunca cuál es.
 */
export function SettingsPanel({
  settings,
  onSettingsUpdate,
  onError,
  onClose,
}: SettingsPanelProps): JSX.Element {
  const [projectName, setProjectName] = useState(settings.projectName);
  const [jiraBaseUrl, setJiraBaseUrl] = useState(settings.jira.baseUrl ?? '');
  const [jiraEmail, setJiraEmail] = useState(settings.jira.email ?? '');
  const [azureOrgUrl, setAzureOrgUrl] = useState(settings.azureDevOps.organizationUrl ?? '');
  const [azureProject, setAzureProject] = useState(settings.azureDevOps.project ?? '');

  const [jiraToken, setJiraToken] = useState('');
  const [azureToken, setAzureToken] = useState('');

  const [savingSettings, setSavingSettings] = useState(false);
  const [savingJiraToken, setSavingJiraToken] = useState(false);
  const [savingAzureToken, setSavingAzureToken] = useState(false);

  async function handleSaveSettings(event: JSX.TargetedEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSavingSettings(true);
    try {
      const updated = await api.updateSettings({
        projectName,
        jira: { baseUrl: jiraBaseUrl.trim() || null, email: jiraEmail.trim() || null },
        azureDevOps: {
          organizationUrl: azureOrgUrl.trim() || null,
          project: azureProject.trim() || null,
        },
      });
      onSettingsUpdate(updated);
    } catch (error) {
      onError(error as ApiRequestError);
    } finally {
      setSavingSettings(false);
    }
  }

  async function handleSaveJiraToken(): Promise<void> {
    setSavingJiraToken(true);
    try {
      const updated = await api.setJiraToken(jiraToken.trim() || null);
      onSettingsUpdate(updated);
      setJiraToken('');
    } catch (error) {
      onError(error as ApiRequestError);
    } finally {
      setSavingJiraToken(false);
    }
  }

  async function handleClearJiraToken(): Promise<void> {
    setSavingJiraToken(true);
    try {
      const updated = await api.setJiraToken(null);
      onSettingsUpdate(updated);
      setJiraToken('');
    } catch (error) {
      onError(error as ApiRequestError);
    } finally {
      setSavingJiraToken(false);
    }
  }

  async function handleSaveAzureToken(): Promise<void> {
    setSavingAzureToken(true);
    try {
      const updated = await api.setAzureToken(azureToken.trim() || null);
      onSettingsUpdate(updated);
      setAzureToken('');
    } catch (error) {
      onError(error as ApiRequestError);
    } finally {
      setSavingAzureToken(false);
    }
  }

  async function handleClearAzureToken(): Promise<void> {
    setSavingAzureToken(true);
    try {
      const updated = await api.setAzureToken(null);
      onSettingsUpdate(updated);
      setAzureToken('');
    } catch (error) {
      onError(error as ApiRequestError);
    } finally {
      setSavingAzureToken(false);
    }
  }

  return (
    <div class="settings-panel">
      <div class="settings-panel__header">
        <h2>Configuración</h2>
        <button type="button" class="button button--link" onClick={onClose}>
          Volver
        </button>
      </div>

      <form class="settings-panel__section" onSubmit={(event) => void handleSaveSettings(event)}>
        <h3>Proyecto</h3>
        <label class="field">
          <span class="field__label">Nombre del proyecto</span>
          <input
            class="field__input"
            type="text"
            value={projectName}
            onInput={(event) => setProjectName((event.target as HTMLInputElement).value)}
            required
          />
        </label>

        <h3>Jira Cloud</h3>
        <p class="settings-panel__hint">
          El resto de las credenciales (email + URL) se guardan en <code>qa-config.json</code>.
        </p>
        <label class="field">
          <span class="field__label">Base URL</span>
          <input
            class="field__input"
            type="url"
            placeholder="https://tuempresa.atlassian.net"
            value={jiraBaseUrl}
            onInput={(event) => setJiraBaseUrl((event.target as HTMLInputElement).value)}
          />
        </label>
        <label class="field">
          <span class="field__label">Email de la cuenta</span>
          <input
            class="field__input"
            type="email"
            placeholder="qa@tuempresa.com"
            value={jiraEmail}
            onInput={(event) => setJiraEmail((event.target as HTMLInputElement).value)}
          />
        </label>

        <h3>Azure DevOps</h3>
        <label class="field">
          <span class="field__label">URL de la organización</span>
          <input
            class="field__input"
            type="url"
            placeholder="https://dev.azure.com/tuorganizacion"
            value={azureOrgUrl}
            onInput={(event) => setAzureOrgUrl((event.target as HTMLInputElement).value)}
          />
        </label>
        <label class="field">
          <span class="field__label">Proyecto</span>
          <input
            class="field__input"
            type="text"
            placeholder="Nombre o id del proyecto"
            value={azureProject}
            onInput={(event) => setAzureProject((event.target as HTMLInputElement).value)}
          />
        </label>

        <div class="settings-panel__actions">
          <button type="submit" class="button button--primary" disabled={savingSettings}>
            {savingSettings ? 'Guardando…' : 'Guardar configuración'}
          </button>
        </div>
      </form>

      <div class="settings-panel__section">
        <h3>
          Token de Jira{' '}
          <span
            class={`settings-panel__token-status${settings.jira.tokenConfigured ? ' settings-panel__token-status--ok' : ''}`}
          >
            {settings.jira.tokenConfigured ? 'Configurado' : 'No configurado'}
          </span>
        </h3>
        <p class="settings-panel__hint">
          No se guarda en <code>qa-config.json</code> ni en ningún archivo — solo queda en memoria
          mientras este servidor siga corriendo.
        </p>
        <div class="settings-panel__token-row">
          <input
            class="field__input"
            type="password"
            placeholder="Pegar el token de API de Jira"
            value={jiraToken}
            onInput={(event) => setJiraToken((event.target as HTMLInputElement).value)}
            autocomplete="off"
          />
          <button
            type="button"
            class="button button--primary"
            disabled={savingJiraToken || jiraToken.trim().length === 0}
            onClick={() => void handleSaveJiraToken()}
          >
            Guardar token
          </button>
          {settings.jira.tokenConfigured && (
            <button
              type="button"
              class="button button--danger-outline"
              disabled={savingJiraToken}
              onClick={() => void handleClearJiraToken()}
            >
              Quitar
            </button>
          )}
        </div>
      </div>

      <div class="settings-panel__section">
        <h3>
          PAT de Azure DevOps{' '}
          <span
            class={`settings-panel__token-status${settings.azureDevOps.tokenConfigured ? ' settings-panel__token-status--ok' : ''}`}
          >
            {settings.azureDevOps.tokenConfigured ? 'Configurado' : 'No configurado'}
          </span>
        </h3>
        <p class="settings-panel__hint">
          No se guarda en <code>qa-config.json</code> ni en ningún archivo — solo queda en memoria
          mientras este servidor siga corriendo.
        </p>
        <div class="settings-panel__token-row">
          <input
            class="field__input"
            type="password"
            placeholder="Pegar el Personal Access Token de Azure DevOps"
            value={azureToken}
            onInput={(event) => setAzureToken((event.target as HTMLInputElement).value)}
            autocomplete="off"
          />
          <button
            type="button"
            class="button button--primary"
            disabled={savingAzureToken || azureToken.trim().length === 0}
            onClick={() => void handleSaveAzureToken()}
          >
            Guardar token
          </button>
          {settings.azureDevOps.tokenConfigured && (
            <button
              type="button"
              class="button button--danger-outline"
              disabled={savingAzureToken}
              onClick={() => void handleClearAzureToken()}
            >
              Quitar
            </button>
          )}
        </div>
      </div>

      <div class="settings-panel__section settings-panel__section--tip">
        <h3>💡 ¿Querés que el token te dure entre reinicios?</h3>
        <p class="settings-panel__hint">
          Lo que pegás acá arriba solo dura mientras este servidor siga corriendo — al volver a
          correr <code>qa-reporter run</code> hay que pegarlo de nuevo. Si preferís que no se
          pierda, exportá la variable de entorno correspondiente en la terminal ANTES de correr{' '}
          <code>qa-reporter run</code>:
        </p>
        <code class="settings-panel__command">export JIRA_API_TOKEN=&quot;tu-token-de-api&quot;</code>
        <code class="settings-panel__command">
          export AZURE_DEVOPS_PAT=&quot;tu-personal-access-token&quot;
        </code>
      </div>
    </div>
  );
}

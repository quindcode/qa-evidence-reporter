import { createConfigLoader, type ConfigLoader } from '../../core/config/index.js';
import { QaConfigSchema } from '../../core/types/config.js';
import type { QaConfig } from '../../core/types/config.js';
import { QaError } from '../../core/types/errors.js';
import { INVALID_REQUEST_BODY } from './errors.js';

/**
 * Estado mutable de "settings" que la UI puede editar en caliente, sin
 * reiniciar el server — vive en `adapters/server` (no en `core/**`) a
 * propósito: a diferencia de `SessionEngine` (que también persiste estado
 * mutable, pero lo necesitan tanto el CLI como el server), el concepto de
 * "reconfigurar en caliente vía HTTP" solo existe para el server — el CLI
 * sigue leyendo `qa-config.json`/variables de entorno una sola vez por
 * invocación, como siempre.
 *
 * Dos categorías de dato, con vidas MUY distintas (ver la conversación de
 * producto que motivó esto — "quiero evaluar hacer esto desde el UI, para
 * no estar modificando el .json"):
 *
 * 1. **No secreto** (`projectName`, `jira.baseUrl`/`email`,
 *    `azureDevOps.organizationUrl`/`project`): editable vía
 *    `updateSettings`, se PERSISTE de vuelta a `qa-config.json` — sobrevive
 *    a un restart del server, igual que si se hubiera editado el archivo a
 *    mano.
 * 2. **Secreto** (token de Jira, PAT de Azure DevOps): editable vía
 *    `setJiraToken`/`setAzureToken`, pero SOLO EN MEMORIA de este proceso —
 *    nunca se escribe a disco. Se pierde al reiniciar el server (vuelve a
 *    lo que diga `JIRA_API_TOKEN`/`AZURE_DEVOPS_PAT`, si algo) — es la
 *    decisión de diseño explícita para no reintroducir el riesgo que
 *    `JiraConfigSchema`/`AzureDevOpsConfigSchema` evitan a propósito
 *    (secretos que terminan versionados en el repo del proyecto del QA).
 */
export interface PublicSettings {
  projectName: string;
  jira: {
    baseUrl: string | null;
    email: string | null;
    /** `true` si hay un token configurado AHORA (env var o UI) — nunca el valor. */
    tokenConfigured: boolean;
  };
  azureDevOps: {
    organizationUrl: string | null;
    project: string | null;
    /** `true` si hay un PAT configurado AHORA (env var o UI) — nunca el valor. */
    tokenConfigured: boolean;
  };
}

/** Patch parcial aceptado por `updateSettings` — mismos campos no-secretos que expone `PublicSettings`, todos opcionales (PATCH real, no reemplazo completo). */
export interface SettingsPatch {
  projectName?: string;
  jira?: {
    baseUrl?: string | null;
    email?: string | null;
  };
  azureDevOps?: {
    organizationUrl?: string | null;
    project?: string | null;
  };
}

export interface JiraCredentials {
  baseUrl: string | null;
  email: string | null;
  apiToken: string | undefined;
}

export interface AzureDevOpsCredentials {
  organizationUrl: string | null;
  project: string | null;
  personalAccessToken: string | undefined;
}

export interface SettingsService {
  getPublicSettings(): PublicSettings;
  /** Valida `patch` contra `QaConfigSchema`, lo mezcla sobre la config actual y la persiste en `qa-config.json`. Lanza `QaError(INVALID_REQUEST_BODY)` si el resultado no es válido. */
  updateSettings(patch: SettingsPatch): Promise<PublicSettings>;
  /** `null` limpia el token (queda "no configurado" hasta que se vuelva a setear o se reinicie el server con la env var puesta). */
  setJiraToken(token: string | null): void;
  setAzureToken(token: string | null): void;
  /** Para que las rutas construyan un `JiraClient` al vuelo con las credenciales VIGENTES (ver `routes/report.ts`) — nunca se guarda una instancia de cliente ya armada, porque eso congelaría las credenciales del momento del boot. */
  getJiraCredentials(): JiraCredentials;
  getAzureCredentials(): AzureDevOpsCredentials;
}

export interface SettingsServiceDeps {
  configLoader?: ConfigLoader;
}

export function createSettingsService(
  configFilePath: string,
  initialConfig: QaConfig,
  initialJiraToken: string | undefined,
  initialAzureDevOpsPat: string | undefined,
  deps: SettingsServiceDeps = {},
): SettingsService {
  const configLoader = deps.configLoader ?? createConfigLoader();

  // Copia propia, mutable — nunca la misma referencia que `ServerContext.config`
  // (ese objeto sigue representando el snapshot original del boot; ver su
  // JSDoc en `context.ts`). Un `structuredClone` alcanza: `QaConfig` es JSON
  // plano (ni funciones ni clases), sin las trampas de una copia superficial
  // pisando los objetos anidados (`jira`, `azureDevOps`, etc.) del original.
  let config: QaConfig = structuredClone(initialConfig);
  let jiraApiToken = initialJiraToken;
  let azureDevOpsPat = initialAzureDevOpsPat;

  function getPublicSettings(): PublicSettings {
    return {
      projectName: config.projectName,
      jira: {
        baseUrl: config.jira.baseUrl,
        email: config.jira.email,
        tokenConfigured: Boolean(jiraApiToken),
      },
      azureDevOps: {
        organizationUrl: config.azureDevOps.organizationUrl,
        project: config.azureDevOps.project,
        tokenConfigured: Boolean(azureDevOpsPat),
      },
    };
  }

  async function updateSettings(patch: SettingsPatch): Promise<PublicSettings> {
    const merged: QaConfig = {
      ...config,
      ...(patch.projectName !== undefined ? { projectName: patch.projectName } : {}),
      jira: { ...config.jira, ...patch.jira },
      azureDevOps: { ...config.azureDevOps, ...patch.azureDevOps },
    };

    const result = QaConfigSchema.safeParse(merged);
    if (!result.success) {
      const issues = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
      throw new QaError(`Configuración inválida: ${issues.join('; ')}`, INVALID_REQUEST_BODY);
    }

    config = result.data;
    await configLoader.saveConfig(configFilePath, config);
    return getPublicSettings();
  }

  function setJiraToken(token: string | null): void {
    jiraApiToken = token?.trim() || undefined;
  }

  function setAzureToken(token: string | null): void {
    azureDevOpsPat = token?.trim() || undefined;
  }

  function getJiraCredentials(): JiraCredentials {
    return { baseUrl: config.jira.baseUrl, email: config.jira.email, apiToken: jiraApiToken };
  }

  function getAzureCredentials(): AzureDevOpsCredentials {
    return {
      organizationUrl: config.azureDevOps.organizationUrl,
      project: config.azureDevOps.project,
      personalAccessToken: azureDevOpsPat,
    };
  }

  return {
    getPublicSettings,
    updateSettings,
    setJiraToken,
    setAzureToken,
    getJiraCredentials,
    getAzureCredentials,
  };
}

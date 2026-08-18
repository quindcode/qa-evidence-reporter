import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { createConfigLoader } from '../../core/config/index.js';
import { createLogger } from '../../core/logger/index.js';
import type { QaConfig } from '../../core/types/config.js';
import type { Logger } from '../../core/types/logger.js';
import { resolveTemplateDir } from './templatePaths.js';

/** Mismo nombre de carpeta oculta que usa `adapters/cli` (ver `adapters/cli/commands/run.ts`, `SESSION_DIR_NAME`). Se duplica el literal (en vez de importar desde `adapters/cli`) por la misma regla de dependencia estricta documentada en `templatePaths.ts`. */
const SESSION_DIR_NAME = '.qa-evidence-reporter';
const SESSION_FILE_NAME = 'session.json';
const CONFIG_FILE_NAME = 'qa-config.json';

/**
 * Todo lo que `createApp`/`startServer` necesitan para levantar el server,
 * ya resuelto (rutas absolutas, config cargada, logger construido) — el
 * mismo criterio que `SessionEngineDeps`/`EvidenceStoreDeps` de fases
 * anteriores: recibir dependencias ya construidas en vez de que el propio
 * módulo decida cómo construirlas, para que `createApp` sea trivial de
 * testear con directorios temporales (ver `app.test.ts`) sin pasar por
 * `qa-config.json` real en disco.
 */
export interface ServerContext {
  config: QaConfig;
  logger: Logger;
  /** Raíz del proyecto del QA (cwd de donde se sirve `qa-evidence-reporter run`, en producción). */
  projectRoot: string;
  /** Ruta absoluta a `.qa-evidence-reporter/session.json`. */
  sessionFilePath: string;
  /** Ruta absoluta a la carpeta de `.feature` (`config.featuresDir` resuelto). */
  featuresDir: string;
  /** Ruta absoluta a la raíz de evidencias (`config.evidenceDir` resuelto) — el `baseDir` que se le pasa a `createEvidenceStore`. */
  evidenceBaseDir: string;
  /** Ruta absoluta a la carpeta de reportes (`config.reportsDir` resuelto) — el `outputDir` que se le pasa a `ReportGenerator.generate()`. */
  reportsDir: string;
  /** Ruta absoluta al `templateDir` a usar (`config.reportTemplate` resuelto, o el template embebido — ver `templatePaths.ts`). */
  templateDir: string;
  /** Ruta absoluta al logo de marca (`config.branding.logoPath` resuelto), o `null` si no hay logo configurado. */
  brandingLogoAbsolutePath: string | null;
  /**
   * Token de API de Jira Cloud, leído de la variable de entorno
   * `JIRA_API_TOKEN` — NUNCA de `qa-config.json` (ver `JiraConfigSchema` en
   * `core/types/config.ts`, que deliberadamente no tiene un campo para
   * esto). `undefined` si la variable no está seteada; `JiraClient`
   * (`core/jira`) recién valida su ausencia cuando se intenta publicar de
   * verdad, no acá.
   */
  jiraApiToken: string | undefined;
  /**
   * Personal Access Token (PAT) de Azure DevOps, leído de la variable de
   * entorno `AZURE_DEVOPS_PAT` — mismo criterio que `jiraApiToken`: NUNCA
   * en `qa-config.json` (ver `AzureDevOpsConfigSchema`). `undefined` si la
   * variable no está seteada; `AzureDevOpsClient` (`core/azureDevOps`)
   * recién valida su ausencia cuando se intenta publicar de verdad.
   */
  azureDevOpsPat: string | undefined;
}

export interface BuildServerContextDeps {
  logger?: Logger;
}

/**
 * Construye un `ServerContext` real a partir de `projectRoot`, siguiendo
 * EXACTAMENTE el mismo patrón que ya usan `adapters/cli/commands/run.ts` y
 * `report.ts` para resolver estas mismas rutas (carga de `qa-config.json`,
 * `resolve(cwd, config.featuresDir)`, etc.) — no se reinventa nada nuevo
 * acá, solo se agrupa en la forma que espera `createApp`.
 *
 * No usada todavía por `adapters/cli` (conectar `run` a un server real queda
 * para fase 5b o un ajuste posterior, ver ARCHITECTURE.md "Fase 5a"): esta
 * función existe para que levantar un server real (la prueba manual de esta
 * fase, `startServer` contra un proyecto de ejemplo) no tenga que duplicar
 * esta resolución de rutas a mano.
 */
export async function buildServerContext(
  projectRoot: string,
  deps: BuildServerContextDeps = {},
): Promise<ServerContext> {
  const configFilePath = join(projectRoot, CONFIG_FILE_NAME);
  const config = await createConfigLoader().loadConfig(configFilePath);
  const logger = deps.logger ?? createLogger(config.logging.level);

  const sessionDir = join(projectRoot, SESSION_DIR_NAME);
  await mkdir(sessionDir, { recursive: true });

  return {
    config,
    logger,
    projectRoot,
    sessionFilePath: join(sessionDir, SESSION_FILE_NAME),
    featuresDir: resolve(projectRoot, config.featuresDir),
    evidenceBaseDir: resolve(projectRoot, config.evidenceDir),
    reportsDir: resolve(projectRoot, config.reportsDir),
    templateDir: resolveTemplateDir(projectRoot, config.reportTemplate),
    brandingLogoAbsolutePath: config.branding.logoPath
      ? resolve(projectRoot, config.branding.logoPath)
      : null,
    jiraApiToken: process.env.JIRA_API_TOKEN,
    azureDevOpsPat: process.env.AZURE_DEVOPS_PAT,
  };
}

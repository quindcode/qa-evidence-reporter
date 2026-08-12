import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { createConfigLoader } from '../../../core/config/index.js';
import { createLogger } from '../../../core/logger/index.js';
import { createGherkinParser } from '../../../core/parser/index.js';
import { createSessionEngine } from '../../../core/session/index.js';
import type { QaConfig } from '../../../core/types/config.js';
import { QaError, SessionNotFoundError } from '../../../core/types/errors.js';
import type { Logger } from '../../../core/types/logger.js';
import type { ParsedFeature } from '../../../core/types/parser.js';
import type { SessionState } from '../../../core/types/session.js';
import type { ServerContext, StartServerResult } from '../../server/index.js';
import { startServer as startServerReal } from '../../server/index.js';
import { isDirectory } from '../fsUtils.js';
import { DEFAULT_TEMPLATE_DIR } from '../templatePaths.js';

/** Nombre fijo de la carpeta oculta de estado del proyecto (ver ARCHITECTURE.md, "Formato de `session.json`"). */
export const SESSION_DIR_NAME = '.qa-evidence-reporter';
const SESSION_FILE_NAME = 'session.json';
const CONFIG_FILE_NAME = 'qa-config.json';

export interface RunCommandDeps {
  logger?: Logger;
  print?: (message: string) => void;
  /**
   * Inyectable para tests (ver `run.test.ts`): evita levantar un puerto TCP
   * real al probar la orquestación de este comando. Default de producción:
   * `startServer` real de `adapters/server` (ver ARCHITECTURE.md, "Cambios
   * registrados", fase 6 — este es el punto que conecta `run` con el server
   * real de fase 5, una excepción deliberada y documentada a la regla de
   * "adapters/cli y adapters/server nunca se importan entre sí").
   * `startServer` ya se encarga de abrir el navegador cuando
   * `config.server.openBrowser` es `true` (con su propio try/catch: un fallo
   * al abrir el navegador, p. ej. sin entorno gráfico, nunca hace fallar el
   * arranque del server) — este comando no duplica esa lógica.
   */
  startServer?: (context: ServerContext) => Promise<StartServerResult>;
  /**
   * Inyectable para tests: por defecto espera una señal real de proceso
   * (`SIGINT`/`SIGTERM`) para cerrar el server limpiamente y devolver el
   * control a `adapters/cli/index.ts`. En un test unitario se inyecta una
   * versión que resuelve inmediatamente, para no depender de enviar una
   * señal real al proceso de test.
   */
  waitForShutdownSignal?: () => Promise<NodeJS.Signals>;
}

export interface RunCommandResult {
  config: QaConfig;
  features: ParsedFeature[];
  /** `null` si todavía no existe una sesión guardada (nadie corrió/seleccionó features todavía). */
  session: SessionState | null;
  sessionFilePath: string;
  /** URL real donde quedó escuchando el server (incluye el puerto real efectivo). */
  url: string;
}

/**
 * Implementación de `qa-evidence-reporter run`.
 *
 * Carga `qa-config.json`, parsea las features de `featuresDir`, carga la
 * sesión existente si hay una, y levanta el server HTTP interactivo real de
 * `adapters/server` (`startServer`) sobre el mismo `ServerContext` que
 * consumiría cualquier otro caller de ese módulo. El proceso queda vivo
 * (mantenido por el propio server escuchando el socket TCP) hasta que llega
 * `SIGINT`/`SIGTERM`, momento en el que se cierra el server limpiamente
 * (`close()`) antes de que esta función resuelva y el proceso termine solo,
 * sin necesitar `process.exit()` forzado.
 */
export async function runRun(cwd: string, deps: RunCommandDeps = {}): Promise<RunCommandResult> {
  const print = deps.print ?? ((message: string) => console.log(message));

  const configFilePath = join(cwd, CONFIG_FILE_NAME);
  const config = await createConfigLoader().loadConfig(configFilePath);

  const logger = deps.logger ?? createLogger(config.logging.level);
  logger.debug('Config cargada', { configFilePath });

  const featuresDir = resolve(cwd, config.featuresDir);
  if (!(await isDirectory(featuresDir))) {
    throw new QaError(
      `No se encontró el directorio de features "${featuresDir}" ` +
        `(configurado como "featuresDir": "${config.featuresDir}" en "${CONFIG_FILE_NAME}"). ` +
        'Creá el directorio o corregí la ruta en la configuración.',
      'FEATURES_DIR_NOT_FOUND',
    );
  }

  const features = await createGherkinParser({ logger }).parseDirectory(featuresDir);
  logger.info('Features cargadas', { count: features.length, featuresDir });

  // Se asegura que la carpeta oculta de estado exista desde ya (aunque
  // todavía no haya sesión), para que quede lista para cuando el server
  // necesite escribir en ella (p. ej. al crear la primera sesión desde la UI).
  const sessionDir = join(cwd, SESSION_DIR_NAME);
  await mkdir(sessionDir, { recursive: true });
  const sessionFilePath = join(sessionDir, SESSION_FILE_NAME);

  const session = await loadExistingSession(sessionFilePath);

  printSummary(print, config, features, session);

  const serverContext: ServerContext = {
    config,
    logger,
    projectRoot: cwd,
    sessionFilePath,
    featuresDir,
    evidenceBaseDir: resolve(cwd, config.evidenceDir),
    reportsDir: resolve(cwd, config.reportsDir),
    templateDir: resolveTemplateDir(cwd, config.reportTemplate),
    brandingLogoAbsolutePath: config.branding.logoPath
      ? resolve(cwd, config.branding.logoPath)
      : null,
  };

  const startServerFn = deps.startServer ?? startServerReal;
  const { url, close } = await startServerFn(serverContext);

  print('');
  print(`Servidor QA Evidence Reporter escuchando en ${url}`);
  print('Dejá esta terminal abierta durante la sesión de QA. Presioná Ctrl+C para detenerlo.');

  const waitForShutdownSignal = deps.waitForShutdownSignal ?? defaultWaitForShutdownSignal;
  const signal = await waitForShutdownSignal();

  logger.info('Señal de terminación recibida, cerrando servidor...', { signal });
  await close();
  print('Servidor detenido.');

  return { config, features, session, sessionFilePath, url };
}

/**
 * Espera a que el proceso reciba `SIGINT` (Ctrl+C) o `SIGTERM` (p. ej. `kill`
 * sin `-9`). Registra los listeners con `once` y limpia el que no disparó
 * apenas se resuelve la promesa, para no dejar un listener huérfano
 * colgando del proceso.
 */
function defaultWaitForShutdownSignal(): Promise<NodeJS.Signals> {
  return new Promise((resolvePromise) => {
    const onSigint = (): void => settle('SIGINT');
    const onSigterm = (): void => settle('SIGTERM');
    function settle(signal: NodeJS.Signals): void {
      process.off('SIGINT', onSigint);
      process.off('SIGTERM', onSigterm);
      resolvePromise(signal);
    }
    process.once('SIGINT', onSigint);
    process.once('SIGTERM', onSigterm);
  });
}

/** `config.reportTemplate` (relativo a `cwd` si no es absoluto) o el template embebido del paquete. Misma lógica que `report.ts` (duplicada intencionalmente: ver su propio comentario). */
function resolveTemplateDir(cwd: string, reportTemplate: string | null): string {
  if (!reportTemplate) return DEFAULT_TEMPLATE_DIR;
  return resolve(cwd, reportTemplate);
}

async function loadExistingSession(sessionFilePath: string): Promise<SessionState | null> {
  try {
    return await createSessionEngine(sessionFilePath).load();
  } catch (error) {
    if (error instanceof SessionNotFoundError) return null;
    throw error;
  }
}

function printSummary(
  print: (message: string) => void,
  config: QaConfig,
  features: ParsedFeature[],
  session: SessionState | null,
): void {
  print(`Proyecto: ${config.projectName}`);
  print(`Features encontradas en "${config.featuresDir}": ${features.length}`);
  for (const feature of features) {
    const scenarioCount = feature.scenarios.length;
    print(`  - ${feature.name} (${scenarioCount} escenario${scenarioCount === 1 ? '' : 's'})`);
  }

  print('');
  if (session) {
    const { featureIndex, scenarioIndex, stepIndex } = session.currentPosition;
    print(`Sesión existente encontrada (estado: "${session.status}").`);
    print(
      `  Posición actual: feature #${featureIndex + 1}, escenario #${scenarioIndex + 1}, step #${stepIndex + 1}.`,
    );
    print('  Se retoma desde ahí en el runner interactivo.');
  } else {
    print(
      'No hay una sesión previa guardada: seleccioná qué features correr en el runner interactivo.',
    );
  }
}

import { join, resolve } from 'node:path';

import { createConfigLoader } from '../../../core/config/index.js';
import { createLogger } from '../../../core/logger/index.js';
import {
  createHandlebarsTemplateEngine,
  createReportGenerator,
} from '../../../core/report/index.js';
import { createSessionEngine } from '../../../core/session/index.js';
import { QaError, SessionNotFoundError } from '../../../core/types/errors.js';
import type { Logger } from '../../../core/types/logger.js';
import { DEFAULT_TEMPLATE_DIR } from '../templatePaths.js';
import { SESSION_DIR_NAME } from './run.js';

const SESSION_FILE_NAME = 'session.json';
const CONFIG_FILE_NAME = 'qa-config.json';

export interface ReportCommandDeps {
  logger?: Logger;
  print?: (message: string) => void;
}

export interface ReportCommandResult {
  outputDir: string;
  indexPath: string;
}

/**
 * Implementación de `qa-evidence-reporter report`.
 *
 * Decisión de diseño (`evidenceBaseDir`): `ReportGeneratorConfig.evidenceBaseDir`
 * (`core/report/reportGenerator.ts`) debe ser el MISMO `baseDir` que se le
 * pasa a `createEvidenceStore` cuando se guarda evidencia (server, fase 5):
 * `resolve(cwd, config.evidenceDir)`. `core/evidence` ya no asume ningún
 * nombre de carpeta fijo (corregido tras la fase 4 — ver ARCHITECTURE.md,
 * "Cambios registrados"), así que `config.evidenceDir` ahora sí tiene efecto
 * real de punta a punta.
 */
export async function runReport(
  cwd: string,
  deps: ReportCommandDeps = {},
): Promise<ReportCommandResult> {
  const print = deps.print ?? ((message: string) => console.log(message));

  const configFilePath = join(cwd, CONFIG_FILE_NAME);
  const config = await createConfigLoader().loadConfig(configFilePath);

  const logger = deps.logger ?? createLogger(config.logging.level);
  logger.debug('Config cargada', { configFilePath });

  const sessionFilePath = join(cwd, SESSION_DIR_NAME, SESSION_FILE_NAME);
  const sessionState = await loadSessionOrFail(sessionFilePath);
  logger.info('Sesión cargada', { sessionFilePath, status: sessionState.status });

  const templateDir = resolveTemplateDir(cwd, config.reportTemplate);
  const templateEngine = createHandlebarsTemplateEngine(templateDir);

  const outputDir = resolve(cwd, config.reportsDir);
  const evidenceBaseDir = resolve(cwd, config.evidenceDir);
  const generator = createReportGenerator(
    { projectName: config.projectName, evidenceBaseDir },
    templateEngine,
  );

  await generator.generate(sessionState, outputDir);

  const indexPath = join(outputDir, 'index.html');
  logger.info('Reporte generado', { outputDir, indexPath });
  print(`Reporte generado en "${indexPath}".`);

  return { outputDir, indexPath };
}

/**
 * Carga la sesión guardada, o lanza un error claro y accionable si no hay
 * ninguna. Se envuelve `SessionNotFoundError` (en vez de dejarlo propagar
 * tal cual) porque su mensaje genérico ("no se encontró un archivo de
 * sesión en X") no deja tan claro COMO `report` específicamente que "no hay
 * nada que reportar" y cuál es el siguiente paso (correr `run`) — ver la
 * consigna de esta fase: "si no hay sesión, error claro: nada que
 * reportar".
 */
async function loadSessionOrFail(sessionFilePath: string) {
  try {
    return await createSessionEngine(sessionFilePath).load();
  } catch (error) {
    if (error instanceof SessionNotFoundError) {
      throw new QaError(
        `No hay ninguna sesión de ejecución guardada en "${sessionFilePath}" — no hay nada ` +
          'que reportar todavía. Corré "qa-evidence-reporter run", seleccioná features y ' +
          'ejecutá al menos un step antes de generar el reporte.',
        'NOTHING_TO_REPORT',
        { cause: error },
      );
    }
    throw error;
  }
}

/** `config.reportTemplate` (relativo a `cwd` si no es absoluto) o el template embebido del paquete. */
function resolveTemplateDir(cwd: string, reportTemplate: string | null): string {
  if (!reportTemplate) return DEFAULT_TEMPLATE_DIR;
  return resolve(cwd, reportTemplate);
}

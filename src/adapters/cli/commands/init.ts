import { mkdir, writeFile } from 'node:fs/promises';
import { basename, join, relative, resolve } from 'node:path';

import {
  DEFAULT_ALLOWED_EVIDENCE_FORMATS,
  DEFAULT_PROJECT_NAME,
} from '../../../core/types/config.js';
import { QaError } from '../../../core/types/errors.js';
import type { Logger } from '../../../core/types/logger.js';
import { createLogger } from '../../../core/logger/index.js';
import { pathExists } from '../fsUtils.js';

const CONFIG_FILE_NAME = 'qa-config.json';

/**
 * Feature de ejemplo que `init` deja en `features/` para que `run` tenga
 * algo real para cargar inmediatamente después de inicializar el proyecto,
 * en vez de un directorio vacío con solo un `.gitkeep` (ver la consigna de
 * esta fase: ".gitkeep o un feature de ejemplo — decide"). Se prefirió el
 * ejemplo real: `evidence/`/`reports/` sí quedan con `.gitkeep` (no tiene
 * sentido un "reporte de ejemplo" ni una "evidencia de ejemplo" ahí), pero
 * `features/` es lo primero que un QA nuevo abre, y un archivo `.feature`
 * real y comentado enseña el formato mejor que una carpeta vacía.
 */
const EXAMPLE_FEATURE = `# Feature de ejemplo generada por "qa-evidence-reporter init".
# Podés editar o borrar este archivo, y agregar tantos .feature como
# necesites (en subcarpetas si querés) dentro de este directorio.
Feature: Ejemplo de inicio de sesión
  Como usuario registrado
  quiero iniciar sesión con mis credenciales
  para acceder a mi cuenta.

  Scenario: Inicio de sesión exitoso con credenciales válidas
    Given un usuario registrado en la página de inicio de sesión
    When ingresa su usuario y contraseña válidos
    Then accede correctamente a su cuenta
`;

export interface InitCommandOptions {
  /** `--name`. Si no se provee, se usa el nombre de la carpeta actual (ver `runInit`). */
  name?: string;
  /** `--force`. Si `true`, sobreescribe un "qa-config.json" existente. */
  force?: boolean;
}

export interface InitCommandDeps {
  logger?: Logger;
  /** Salida de cara al usuario (próximos pasos, confirmación). Por defecto `console.log`. Inyectable para tests, ver `init.test.ts`. */
  print?: (message: string) => void;
}

export interface InitCommandResult {
  configFilePath: string;
  featuresDir: string;
  evidenceDir: string;
  reportsDir: string;
  projectName: string;
}

/**
 * Implementación de `qa-evidence-reporter init`: crea `features/`
 * (con una feature de ejemplo), `evidence/`, `reports/` y `qa-config.json`
 * en `cwd`, con los defaults documentados en ARCHITECTURE.md.
 *
 * Decisión de diseño (`projectName`): sin `--name`, se usa
 * `basename(resolve(cwd))` — el nombre de la carpeta del proyecto — en vez
 * de preguntar de forma interactiva. `qa-evidence-reporter` es una
 * herramienta pensada para poder correr en CI/scripts además de a mano
 * (ver ARCHITECTURE.md, "un solo usuario por sesión local" — pero eso no
 * implica una sesión de terminal interactiva para `init`); un prompt
 * interactivo bloquearía ese uso. `--name` cubre el caso en que el nombre
 * de carpeta no sea un buen nombre de proyecto para mostrar en el reporte.
 *
 * Decisión de diseño ("no sobreescribir silenciosamente"): si
 * "qa-config.json" ya existe y no se pasó `--force`, se lanza un `QaError`
 * (código `CONFIG_ALREADY_EXISTS`) SIN tocar nada en disco — ni siquiera
 * las carpetas `features/`/`evidence/`/`reports/` (se valida esto ANTES de
 * crear cualquier directorio). No se modeló como una subclase dedicada de
 * error en `core/types/errors.ts` porque es una condición pura de este
 * comando de CLI (nunca la lanza ningún módulo de `core/**`): instanciar
 * `QaError` directamente (no es una clase abstracta) alcanza y evita
 * agregar una clase de error de una sola línea que ARCHITECTURE.md no
 * pidió para esta fase.
 */
export async function runInit(
  cwd: string,
  options: InitCommandOptions = {},
  deps: InitCommandDeps = {},
): Promise<InitCommandResult> {
  const logger = deps.logger ?? createLogger('info');
  const print = deps.print ?? ((message: string) => console.log(message));

  const projectName = options.name?.trim() || basename(resolve(cwd)) || DEFAULT_PROJECT_NAME;
  const configFilePath = join(cwd, CONFIG_FILE_NAME);

  if (!options.force && (await pathExists(configFilePath))) {
    throw new QaError(
      `Ya existe un "${CONFIG_FILE_NAME}" en "${configFilePath}". Usá --force si querés sobreescribirlo.`,
      'CONFIG_ALREADY_EXISTS',
    );
  }

  const featuresDir = join(cwd, 'features');
  const evidenceDir = join(cwd, 'evidence');
  const reportsDir = join(cwd, 'reports');

  logger.debug('Creando estructura de directorios del proyecto', { cwd });
  await mkdir(featuresDir, { recursive: true });
  await mkdir(evidenceDir, { recursive: true });
  await mkdir(reportsDir, { recursive: true });

  await writeFile(join(featuresDir, 'example.feature'), EXAMPLE_FEATURE, 'utf-8');
  await writeFile(join(evidenceDir, '.gitkeep'), '', 'utf-8');
  await writeFile(join(reportsDir, '.gitkeep'), '', 'utf-8');

  await writeFile(configFilePath, buildConfigFileContents(projectName), 'utf-8');
  logger.info('qa-config.json creado', { configFilePath, projectName });

  printNextSteps(print, cwd, configFilePath);

  return { configFilePath, featuresDir, evidenceDir, reportsDir, projectName };
}

/**
 * Contenido de `qa-config.json` con los defaults de ARCHITECTURE.md,
 * excepto `projectName` (provisto por el caller). Se construye como objeto
 * y se serializa a mano (no reusando `QaConfigSchema.parse({})`) porque el
 * campo `"$schema"` es un hint de editor documentado en ARCHITECTURE.md que
 * NO es parte de `QaConfigSchema` (se descarta al parsear, ver
 * `core/types/config.ts`) — si se generara desde el resultado de un parse,
 * este campo se perdería.
 */
function buildConfigFileContents(projectName: string): string {
  const config = {
    $schema: './node_modules/qa-evidence-reporter/config.schema.json',
    projectName,
    team: [],
    featuresDir: 'features',
    evidenceDir: 'evidence',
    reportsDir: 'reports',
    server: { port: 3000, openBrowser: true },
    evidence: {
      maxFileSizeMB: 50,
      allowedFormats: [...DEFAULT_ALLOWED_EVIDENCE_FORMATS],
    },
    logging: { level: 'info' },
    reportTemplate: null,
  };
  return `${JSON.stringify(config, null, 2)}\n`;
}

function printNextSteps(
  print: (message: string) => void,
  cwd: string,
  configFilePath: string,
): void {
  const relativeConfigPath = relative(cwd, configFilePath) || CONFIG_FILE_NAME;
  print(`Proyecto QA inicializado en "${cwd}".`);
  print('');
  print('Próximos pasos:');
  print(
    `  1. Revisá "${relativeConfigPath}" (nombre del equipo, puertos, formatos de evidencia permitidos, etc.).`,
  );
  print('  2. Agregá tus archivos .feature en "features/" (o editá/borrá el ejemplo incluido).');
  print(
    '  3. Corré "qa-evidence-reporter run" para cargar la configuración y las features del proyecto.',
  );
  print(
    '  4. Ejecutá la sesión de QA manual y corré "qa-evidence-reporter report" para generar el reporte HTML final.',
  );
}

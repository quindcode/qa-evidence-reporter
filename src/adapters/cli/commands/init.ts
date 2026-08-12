import { chmod, mkdir, writeFile } from 'node:fs/promises';
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

/**
 * Lanzadores de doble clic que `init` deja en la raíz del proyecto QA, para
 * que correr una sesión no requiera abrir una terminal y escribir el
 * comando a mano. Se generan siempre los cuatro, independientemente del SO
 * donde corra `init`, porque un mismo proyecto de QA (un repo compartido)
 * puede terminar clonado en máquinas con SO distinto entre los miembros del
 * equipo.
 *
 * `run.sh` y `run.command` tienen el mismo contenido (shell script): Finder
 * en macOS solo ejecuta scripts con doble clic si la extensión es
 * `.command` (con `.sh` los abre en un editor de texto), mientras que en
 * Linux la convención "clásica" es `.sh`.
 *
 * `run.desktop` (verificado con un doble clic real en Nautilus/GNOME
 * Files sobre Ubuntu, tras un reporte de un usuario): que `run.sh` tenga el
 * bit de ejecución (`chmod 755`) NO garantiza que el gestor de archivos lo
 * corra al doble clic — Nautilus, desde hace varias versiones, trata los
 * "archivos de texto ejecutables" como texto por default y los abre en un
 * editor en vez de correrlos (es una preferencia del gestor de archivos,
 * no algo que el bit de ejecución pueda forzar). El mecanismo real para un
 * "acceso directo ejecutable" en Linux es un archivo `.desktop`
 * (especificación freedesktop.org, reconocido por GNOME/KDE/XFCE/Cinnamon/
 * MATE) — con `Exec=` apuntando al comando real, el gestor de archivos lo
 * reconoce como aplicación en vez de texto. Se genera con una ruta absoluta
 * a `run.sh` (conocida en el momento de `init`, ver `runInit`) para no
 * depender de campos de sustitución del formato `.desktop` que no todos los
 * gestores de archivos soportan igual.
 */
const RUN_SCRIPT_SH = `#!/usr/bin/env bash
# Generado por "qa-evidence-reporter init". Doble clic para levantar el
# runner sin escribir el comando a mano.
#
# Si en Linux el doble clic solo ABRE este archivo en un editor de texto en
# vez de ejecutarlo, es el comportamiento default de tu gestor de archivos
# para "archivos de texto ejecutables" (no un problema de este script) — usá
# "run.desktop" en su lugar, o corré "./run.sh" desde una terminal abierta en
# esta carpeta.
cd "$(dirname "$0")"
qa-evidence-reporter run
`;

const RUN_SCRIPT_BAT = `@echo off
REM Generado por "qa-evidence-reporter init". Doble clic para levantar el
REM runner sin escribir el comando a mano.
cd /d "%~dp0"
qa-evidence-reporter run
pause
`;

/**
 * Contenido de `run.desktop` (ver JSDoc de `RUN_SCRIPT_SH` para el porqué).
 * `Terminal=true` deja visible la salida real del comando (mismo criterio
 * que el `pause` de `run.bat`) en vez de correrlo oculto — importante para
 * que un error de arranque (puerto, config inválida, etc.) no desaparezca
 * sin que el QA lo vea. `runScriptShPath` es la ruta ABSOLUTA a `run.sh` ya
 * escrito en este mismo `runInit`, entre comillas dentro del valor de
 * `Exec=` (la forma soportada por la especificación Desktop Entry para un
 * argumento con espacios), para no depender de campos de sustitución
 * (`%k`, etc.) marcados como deprecados/inconsistentes entre gestores de
 * archivos.
 */
function buildRunDesktopContents(runScriptShPath: string): string {
  return `[Desktop Entry]
Type=Application
Name=Iniciar sesión de QA
Comment=Levanta "qa-evidence-reporter run" sin necesitar terminal
Exec=bash "${runScriptShPath}"
Terminal=true
Icon=utilities-terminal
Categories=Development;
`;
}

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

  const runScriptShPath = join(cwd, 'run.sh');
  const runScriptCommandPath = join(cwd, 'run.command');
  const runScriptBatPath = join(cwd, 'run.bat');
  const runDesktopPath = join(cwd, 'run.desktop');
  await writeFile(runScriptShPath, RUN_SCRIPT_SH, 'utf-8');
  await chmod(runScriptShPath, 0o755);
  await writeFile(runScriptCommandPath, RUN_SCRIPT_SH, 'utf-8');
  await chmod(runScriptCommandPath, 0o755);
  await writeFile(runScriptBatPath, RUN_SCRIPT_BAT, 'utf-8');
  await writeFile(runDesktopPath, buildRunDesktopContents(resolve(runScriptShPath)), 'utf-8');
  await chmod(runDesktopPath, 0o755);

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
    '  3. Corré "qa-evidence-reporter run" (o hacé doble clic en "run.command" en macOS, ' +
      '"run.desktop" en Linux, "run.bat" en Windows) para cargar la configuración y las ' +
      'features del proyecto.',
  );
  print(
    '     (En Linux, si el doble clic abre "run.sh"/"run.desktop" en un editor de texto en ' +
      'vez de ejecutarlo, es la configuración default de tu gestor de archivos para archivos ' +
      'ejecutables — probá clic derecho → "Ejecutar"/"Permitir lanzamiento", o cambiá esa ' +
      'preferencia una vez por todas en tu gestor de archivos.)',
  );
  print(
    '  4. Ejecutá la sesión de QA manual y corré "qa-evidence-reporter report" para generar el reporte HTML final.',
  );
}

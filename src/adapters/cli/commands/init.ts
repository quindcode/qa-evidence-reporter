import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { basename, join, relative, resolve } from 'node:path';

import {
  DEFAULT_ALLOWED_EVIDENCE_FORMATS,
  DEFAULT_PROJECT_NAME,
} from '../../../core/types/config.js';
import { QaError } from '../../../core/types/errors.js';
import type { Logger } from '../../../core/types/logger.js';
import { createLogger } from '../../../core/logger/index.js';
import { DEFAULT_BRANDING, DEFAULT_BRANDING_LOGO_PATH } from '../defaultBrandingPaths.js';
import { pathExists } from '../fsUtils.js';

/** Ruta (relativa al proyecto QA) donde `init` copia el logo estándar. */
const BRANDING_LOGO_RELATIVE_PATH = 'branding/logo.png';

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

  const brandingDir = join(cwd, 'branding');
  await mkdir(brandingDir, { recursive: true });
  await copyFile(DEFAULT_BRANDING_LOGO_PATH, join(cwd, BRANDING_LOGO_RELATIVE_PATH));

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
 *
 * Decisión post-fase 6: `branding` se escribe SIEMPRE con el estándar de
 * Quind (`DEFAULT_BRANDING`, `defaultBrandingPaths.ts`), no `null` — todo
 * proyecto nuevo debe verse igual, sin que quien corre `init` tenga que
 * configurar nada a mano. El esquema (`core/types/config.ts`) sigue
 * aceptando `branding: null`/ausente para quien construya un
 * `qa-config.json` a mano por fuera de `init` (o quiera desactivarlo
 * editando el archivo después) — el default a nivel de librería no cambió,
 * solo lo que este comando de CLI decide escribir.
 *
 * Decisión de diseño (`jira` siempre presente, con `baseUrl`/`email` en
 * `null`): JSON no soporta comentarios, así que no hay forma de dejar este
 * bloque "comentado" dentro de un `.json` real sin romper el `JSON.parse`
 * estricto de `configLoader.ts` en cuanto alguien corra `run`/`report` sin
 * tocarlo. Escribir el bloque ya presente pero con ambos valores en `null`
 * (que `JiraConfigSchema` interpreta como "integración desactivada", ver
 * `core/types/config.ts`) logra el mismo resultado práctico sin arriesgar
 * un archivo inválido: para activarlo, alcanza con reemplazar los dos
 * `null` por los valores reales (ver `## Integración con Jira Cloud` en el
 * README) — no hace falta escribir la estructura desde cero.
 *
 * Decisión de diseño (`jira._ejemplo`): campo puramente documental, no
 * forma parte de `JiraConfigSchema` — `z.object()` de Zod descarta claves
 * desconocidas al parsear (mismo criterio que ya aplica a `"$schema"`, ver
 * JSDoc de `QaConfigSchema`), así que `_ejemplo` nunca activa la
 * integración ni rompe la validación. Existe solo para que quien mire el
 * archivo vea la FORMA de un `baseUrl`/`email` reales sin tener que ir al
 * README. `email` usa el dominio real de la empresa (`@quind.io` — todo el
 * equipo lo comparte, a diferencia de `baseUrl`, que sí varía por
 * proyecto/cliente y por eso queda como placeholder genérico
 * `tuempresa.atlassian.net`); la parte local (`tu-email`) sigue siendo
 * genérica, nunca la cuenta real de una persona puntual: `init` scaffolds
 * proyectos para cualquier QA del equipo, no solo para quien lo pidió esta
 * vez.
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
    branding: {
      logoPath: BRANDING_LOGO_RELATIVE_PATH,
      ...DEFAULT_BRANDING,
    },
    jira: {
      baseUrl: null,
      email: null,
      _ejemplo: {
        baseUrl: 'https://tuempresa.atlassian.net',
        email: 'tu-email@quind.io',
      },
    },
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
    `  1. Revisá "${relativeConfigPath}" (nombre del equipo, puertos, formatos de evidencia permitidos, etc.). ` +
      'El branding (logo + colores estándar de Quind) ya viene configurado — no hace falta tocarlo. ' +
      'El bloque "jira" queda con baseUrl/email en null (integración desactivada) — completalo ' +
      'con tus valores reales (mismo formato que "jira._ejemplo", que podés borrar) solo si vas ' +
      'a publicar reportes a Jira Cloud (ver "Integración con Jira Cloud" en el README).',
  );
  print('  2. Agregá tus archivos .feature en "features/" (o editá/borrá el ejemplo incluido).');
  print(
    '  3. Corré "qa-evidence-reporter run" para cargar la configuración y las features del proyecto.',
  );
  print(
    '  4. Ejecutá la sesión de QA manual y corré "qa-evidence-reporter report" para generar el reporte HTML final.',
  );
}

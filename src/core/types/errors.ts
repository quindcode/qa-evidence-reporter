/**
 * Base de todas las clases de error propias del dominio de
 * `qa-evidence-reporter`. Cualquier error que cruce un límite de módulo de
 * `core/**` hacia un adapter (`cli`/`server`) debe ser una instancia de
 * `QaError` (o una subclase), nunca un `Error` genérico ni una excepción
 * cruda de una librería de terceros — así los adapters pueden decidir cómo
 * mostrar/loguear el error usando `code` sin tener que hacer `instanceof`
 * contra clases de librerías externas.
 */
export class QaError extends Error {
  readonly code: string;

  constructor(message: string, code: string, options?: ErrorOptions) {
    super(message, options);
    this.name = this.constructor.name;
    this.code = code;
  }
}

/**
 * Se lanza cuando un archivo `.feature` no puede parsearse: sintaxis
 * Gherkin inválida, o el archivo no contiene una `Feature`/`Característica`
 * válida. Envuelve siempre la causa original del parser de
 * `@cucumber/gherkin` en `options.cause` (nunca se propaga esa excepción
 * cruda hacia afuera de `core/parser`).
 */
export class FeatureParseError extends QaError {
  /** Ruta del archivo `.feature` que falló al parsear. */
  readonly filePath: string;

  constructor(filePath: string, reason: string, options?: ErrorOptions) {
    super(
      `No se pudo parsear el archivo .feature "${filePath}": ${reason}`,
      'FEATURE_PARSE_ERROR',
      options,
    );
    this.filePath = filePath;
  }
}

/**
 * Se lanza cuando `SessionEngine.load()` intenta leer el archivo de sesión
 * (`session.json`) desde `sessionFilePath` y este no existe en disco.
 *
 * Nota de diseño: el motor NUNCA decide por sí mismo "si no existe, crear
 * una nueva" — esa decisión es del caller (en fase 4, el comando `run` del
 * CLI: "cargar si existe, si no crear nueva"). `load()` siempre es estricto
 * y este error es la señal para que el caller decida el fallback.
 */
export class SessionNotFoundError extends QaError {
  /** Ruta del `session.json` que no se encontró. */
  readonly sessionFilePath: string;

  constructor(sessionFilePath: string, options?: ErrorOptions) {
    super(
      `No se encontró un archivo de sesión en "${sessionFilePath}".`,
      'SESSION_NOT_FOUND',
      options,
    );
    this.sessionFilePath = sessionFilePath;
  }
}

/**
 * Se lanza cuando `SessionEngine` rechaza una transición de estado inválida.
 * Cubre, bajo un mismo tipo (ver JSDoc de `SessionEngine` en
 * `core/types/session.ts` para el detalle de cada caso), tres situaciones
 * relacionadas de "el caller intentó dejar la sesión en un estado
 * inconsistente":
 *
 * 1. Marcar un step como `'fail'` sin proveer `defectDescription`.
 * 2. Navegar (`goTo`) a una posición (`featureIndex`/`scenarioIndex`/`stepIndex`)
 *    fuera de rango de `selectedFeatures`.
 * 3. Operar sobre una referencia a step/scenario/feature (`StepRef`) que no
 *    existe en la sesión actual (id desconocido).
 *
 * Se agrupan en una sola clase (en vez de tres) porque las tres son, en el
 * fondo, la misma categoría de error desde el punto de vista de quien llama
 * al motor ("el estado/índice/id que pasaste no es válido para esta
 * sesión") y un adapter (CLI/server) las maneja igual: mostrar `reason` al
 * usuario y no mutar nada (el motor garantiza que si esto se lanza, el
 * estado en memoria/disco no cambió).
 */
export class InvalidStepTransitionError extends QaError {
  constructor(reason: string, options?: ErrorOptions) {
    super(`Transición de sesión inválida: ${reason}`, 'INVALID_STEP_TRANSITION', options);
  }
}

/**
 * Se lanza cuando un archivo de evidencia excede el tamaño máximo permitido.
 *
 * Nota de diseño (ver JSDoc de `EvidenceStore` en `core/types/evidence.ts`):
 * el propio `EvidenceStore` NO valida tamaño (no conoce `qa-config.json`),
 * así que nunca lanza este error por su cuenta. Vive aquí, en el dominio
 * compartido, porque quien sí lo lanza (el adapter/server de fase 5, que
 * conoce `evidence.maxFileSizeMB`) necesita un tipo de error de dominio
 * consistente con el resto (`QaError` + `code`) en vez de inventar uno
 * ad-hoc en `adapters/server`.
 */
export class EvidenceFileTooLargeError extends QaError {
  /** Nombre original del archivo rechazado. */
  readonly originalFilename: string;
  /** Tamaño real del archivo, en bytes. */
  readonly sizeBytes: number;
  /** Límite máximo permitido, en bytes. */
  readonly maxSizeBytes: number;

  constructor(
    originalFilename: string,
    sizeBytes: number,
    maxSizeBytes: number,
    options?: ErrorOptions,
  ) {
    super(
      `El archivo "${originalFilename}" (${sizeBytes} bytes) excede el tamaño máximo permitido (${maxSizeBytes} bytes).`,
      'EVIDENCE_FILE_TOO_LARGE',
      options,
    );
    this.originalFilename = originalFilename;
    this.sizeBytes = sizeBytes;
    this.maxSizeBytes = maxSizeBytes;
  }
}

/**
 * Se lanza cuando `ReportGenerator.generate()` (`core/report`) falla en
 * cualquier punto de la generación del reporte: un template Handlebars
 * inválido o que no compila, un error de I/O al crear `outputDir`/copiar
 * evidencia, o un `TemplateEngine` custom (ver `core/types/report.ts`) que
 * lanza su propio error. `generate()` SIEMPRE envuelve la causa real en
 * `options.cause` — nunca deja escapar la excepción cruda de
 * `core/report` hacia el caller, siguiendo el mismo criterio que
 * `FeatureParseError` en `core/parser`.
 */
export class ReportGenerationError extends QaError {
  constructor(reason: string, options?: ErrorOptions) {
    super(`No se pudo generar el reporte: ${reason}`, 'REPORT_GENERATION_ERROR', options);
  }
}

/** Un problema puntual de validación, ya reducido a una forma legible (ver `ConfigValidationError`). */
export interface ConfigValidationIssue {
  /** Ruta del campo dentro de `qa-config.json`, p. ej. `"server.port"`. Cadena vacía para un problema a nivel raíz (ver `ConfigValidationError.issues`). */
  path: string;
  /** Descripción del problema para ese campo (mensaje de Zod, ya en su forma final). */
  message: string;
}

/**
 * Se lanza cuando `loadConfig()`/`createConfigLoader` (`core/config`) leen
 * `qa-config.json`, el archivo existe y es JSON válido, pero su contenido no
 * cumple `QaConfigSchema` (`core/types/config.ts`): un campo con tipo
 * incorrecto, un enum con un valor no soportado, etc. También se usa para el
 * caso "el archivo no es JSON válido" (un único issue con `path: ''`), para
 * no introducir una tercera clase de error solo para ese caso — ambos son,
 * desde la perspectiva del caller, "el contenido de `qa-config.json` no es
 * usable".
 *
 * Envuelve SIEMPRE la lista completa de `issues` (nunca solo el primero) en
 * un mensaje legible de una sola línea, para que un usuario que tenga varios
 * campos mal a la vez los vea todos de una corrida en vez de tener que
 * corregir uno, volver a ejecutar, ver el siguiente, etc.
 */
export class ConfigValidationError extends QaError {
  readonly issues: readonly ConfigValidationIssue[];

  constructor(issues: readonly ConfigValidationIssue[], options?: ErrorOptions) {
    const details = issues
      .map((issue) => `"${issue.path || '(raíz)'}": ${issue.message}`)
      .join('; ');
    super(
      `La configuración en "qa-config.json" no es válida — ${details}`,
      'CONFIG_VALIDATION_ERROR',
      options,
    );
    this.issues = issues;
  }
}

/**
 * Se lanza cuando `loadConfig()` intenta leer el archivo de configuración
 * (`qa-config.json`) desde `configFilePath` y este no existe.
 *
 * Nota de diseño: deliberadamente NO es lo mismo que `ConfigValidationError`
 * (que asume que el archivo existe pero su contenido es inválido). Se separa
 * en su propia clase, igual que `SessionNotFoundError` vs. una sesión con
 * JSON corrupto, porque el mensaje accionable es distinto: acá el caller
 * (`adapters/cli`, comandos `run`/`report`) siempre sugiere correr
 * `qa-evidence-reporter init` primero, en vez de "corregí este campo".
 * `loadConfig()` NUNCA decide por su cuenta "si no existe, usar todos los
 * defaults" — ver `core/config/configLoader.ts` para el razonamiento
 * completo (mismo criterio que `SessionEngine.load()`, que tampoco crea una
 * sesión nueva por su cuenta).
 */
export class ConfigNotFoundError extends QaError {
  readonly configFilePath: string;

  constructor(configFilePath: string, options?: ErrorOptions) {
    super(
      `No se encontró un archivo de configuración en "${configFilePath}". ` +
        'Ejecutá "qa-evidence-reporter init" primero.',
      'CONFIG_NOT_FOUND',
      options,
    );
    this.configFilePath = configFilePath;
  }
}

/**
 * Se lanza cuando un archivo de evidencia subido tiene un formato (extensión)
 * que no está en `qa-config.json` → `evidence.allowedFormats`.
 *
 * Nota de diseño (igual que `EvidenceFileTooLargeError`, ver arriba):
 * `EvidenceStore` (`core/evidence`) NO valida formato — solo clasifica con
 * `resolveEvidenceKind`, usando `'other'` para lo que no reconoce, nunca
 * rechazando (ver JSDoc de `EvidenceStore` en `core/types/evidence.ts`).
 * Quien sí lo lanza es `adapters/server` (fase 5a, el único consumidor que
 * conoce tanto el archivo subido como `qa-config.json`), ANTES de llamar a
 * `EvidenceStore.save`. Vive en el dominio compartido (`QaError` + `code`)
 * por el mismo motivo que `EvidenceFileTooLargeError`: para que el adapter no
 * tenga que inventar un tipo de error ad-hoc para una condición de negocio
 * ("formato de evidencia no permitido") que tiene sentido más allá de un solo
 * adapter.
 */
export class UnsupportedEvidenceFormatError extends QaError {
  /** Nombre original del archivo rechazado. */
  readonly originalFilename: string;
  /** Extensión (sin el `.`, en minúsculas) que se intentó subir. */
  readonly extension: string;
  /** Formatos permitidos por configuración (`evidence.allowedFormats`). */
  readonly allowedFormats: readonly string[];

  constructor(
    originalFilename: string,
    extension: string,
    allowedFormats: readonly string[],
    options?: ErrorOptions,
  ) {
    super(
      `El archivo "${originalFilename}" tiene un formato no permitido ("${extension}"). ` +
        `Formatos permitidos: ${allowedFormats.join(', ')}.`,
      'UNSUPPORTED_EVIDENCE_FORMAT',
      options,
    );
    this.originalFilename = originalFilename;
    this.extension = extension;
    this.allowedFormats = allowedFormats;
  }
}

/**
 * Se lanza cuando `JiraClient.attachReport()` (`core/jira`) se llama sin
 * `baseUrl`/`email` (`qa-config.json` → `jira`) o sin `apiToken`
 * (variable de entorno `JIRA_API_TOKEN`) configurados. `createJiraClient`
 * nunca valida esto en su construcción (es una factory sin I/O, igual que
 * `createReportGenerator`) — recién lo valida acá, la primera vez que se
 * intenta usar de verdad, para que el server pueda arrancar sin Jira
 * configurado sin problema.
 */
export class JiraNotConfiguredError extends QaError {
  constructor(options?: ErrorOptions) {
    super(
      'Jira no está configurado — falta "jira.baseUrl"/"jira.email" en qa-config.json, ' +
        'o la variable de entorno JIRA_API_TOKEN.',
      'JIRA_NOT_CONFIGURED',
      options,
    );
  }
}

/** Se lanza cuando Jira responde 404 al intentar adjuntar un archivo a `issueKey` (no existe, o la cuenta no tiene permiso para verlo). */
export class JiraIssueNotFoundError extends QaError {
  readonly issueKey: string;

  constructor(issueKey: string, options?: ErrorOptions) {
    super(
      `No se encontró el issue de Jira "${issueKey}" (o no hay permiso para verlo).`,
      'JIRA_ISSUE_NOT_FOUND',
      options,
    );
    this.issueKey = issueKey;
  }
}

/** Se lanza cuando Jira responde 401/403 — el email/token configurados no autenticaron correctamente. */
export class JiraAuthenticationError extends QaError {
  constructor(options?: ErrorOptions) {
    super(
      'Jira rechazó las credenciales configuradas (email + JIRA_API_TOKEN) — verificá que el token no haya vencido o sea inválido.',
      'JIRA_AUTHENTICATION_ERROR',
      options,
    );
  }
}

/**
 * Fallo genérico al hablar con Jira: sin conexión de red, timeout, o
 * cualquier respuesta no-2xx que no sea 401/403/404 (ver
 * `JiraAuthenticationError`/`JiraIssueNotFoundError` para esos dos casos
 * específicos). Siempre envuelve la causa real en `options.cause` cuando la
 * hay (p. ej. la excepción que lanzó `fetch`).
 */
export class JiraRequestError extends QaError {
  constructor(reason: string, options?: ErrorOptions) {
    super(`Falló la solicitud a Jira: ${reason}`, 'JIRA_REQUEST_ERROR', options);
  }
}

/**
 * Se lanza cuando `AzureDevOpsClient.attachReport()`/`.addComment()`
 * (`core/azureDevOps`) se llaman sin `organizationUrl`/`project`
 * (`qa-config.json` → `azureDevOps`) o sin el PAT (variable de entorno
 * `AZURE_DEVOPS_PAT`) configurados. Mismo criterio que
 * `JiraNotConfiguredError`: `createAzureDevOpsClient` es una factory sin
 * I/O, nunca lanza al construirse — esto recién se valida cuando se intenta
 * publicar de verdad.
 */
export class AzureDevOpsNotConfiguredError extends QaError {
  constructor(options?: ErrorOptions) {
    super(
      'Azure DevOps no está configurado — falta "azureDevOps.organizationUrl"/' +
        '"azureDevOps.project" en qa-config.json, o la variable de entorno AZURE_DEVOPS_PAT.',
      'AZURE_DEVOPS_NOT_CONFIGURED',
      options,
    );
  }
}

/** Se lanza cuando Azure DevOps responde 404 al intentar adjuntar un archivo o comentar en `workItemId` (no existe, o la cuenta no tiene permiso para verlo). */
export class AzureDevOpsWorkItemNotFoundError extends QaError {
  readonly workItemId: number;

  constructor(workItemId: number, options?: ErrorOptions) {
    super(
      `No se encontró el work item de Azure DevOps #${workItemId} (o no hay permiso para verlo).`,
      'AZURE_DEVOPS_WORK_ITEM_NOT_FOUND',
      options,
    );
    this.workItemId = workItemId;
  }
}

/** Se lanza cuando Azure DevOps responde 401/403 — el PAT configurado no autenticó correctamente. */
export class AzureDevOpsAuthenticationError extends QaError {
  constructor(options?: ErrorOptions) {
    super(
      'Azure DevOps rechazó las credenciales configuradas (AZURE_DEVOPS_PAT) — verificá que el ' +
        'token no haya vencido, sea inválido, o le falte el scope "Work Items (Read & Write)".',
      'AZURE_DEVOPS_AUTHENTICATION_ERROR',
      options,
    );
  }
}

/**
 * Fallo genérico al hablar con Azure DevOps: sin conexión de red, timeout, o
 * cualquier respuesta no-2xx que no sea 401/403/404 (ver
 * `AzureDevOpsAuthenticationError`/`AzureDevOpsWorkItemNotFoundError` para
 * esos dos casos específicos). Siempre envuelve la causa real en
 * `options.cause` cuando la hay.
 */
export class AzureDevOpsRequestError extends QaError {
  constructor(reason: string, options?: ErrorOptions) {
    super(`Falló la solicitud a Azure DevOps: ${reason}`, 'AZURE_DEVOPS_REQUEST_ERROR', options);
  }
}

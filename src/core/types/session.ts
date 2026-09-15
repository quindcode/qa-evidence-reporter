import { InvalidStepTransitionError } from './errors.js';
import type { ParsedFeature, ParsedStep, SourceLocation } from './parser.js';

/**
 * Resultado que un QA asigna a un step tras ejecutarlo manualmente.
 * `'pending'` es el valor inicial (nunca ejecutado todavía) y es el único
 * valor que no representa una decisión explícita del QA.
 */
export type StepResult = 'pass' | 'fail' | 'skip' | 'pending';

/**
 * Ejecución de un `ParsedStep` dentro de una sesión concreta: además del
 * step original (`step`), lleva el resultado que le asignó el QA, la
 * evidencia adjunta y metadata de auditoría (notas, defecto, timestamps).
 *
 * Decisión de diseño (id): `id` es determinístico y estable — se deriva de
 * la posición del step dentro de la selección de features
 * (`featureIndex`/`scenarioIndex`/`stepIndex`, ver `SessionEngine`), NUNCA
 * de un uuid aleatorio. Esto es lo que hace posible el round-trip
 * guardar→cerrar→volver a abrir: dado el mismo array de `ParsedFeature[]`
 * seleccionado en el mismo orden (que ya es determinístico, ver
 * `GherkinParser.parseDirectory`), regenerar la sesión produce siempre los
 * mismos ids. Concretamente (ver `core/session/ids.ts`):
 * `id = "{scenarioId}_st{stepIndex}"`, es decir, sin slug del texto del
 * step (el texto puede ser larguísimo o tener caracteres raros; el índice
 * ya es suficiente para unicidad dentro del scenario y el texto completo
 * sigue disponible en `step.text` para quien necesite mostrarlo). Como
 * `scenarioId` ya incluye a `featureId` como prefijo (ver JSDoc de
 * `ScenarioExecution`), y `id` a su vez incluye a todo `scenarioId`, el
 * resultado es único en TODA la sesión, no solo dentro de su scenario —
 * por eso todas las operaciones de `SessionEngine` que apuntan a un step
 * (`setStepResult`, `addEvidence`, `removeEvidence`, `addNotes`) reciben
 * simplemente `stepId: string`, sin necesitar además `scenarioId`/`featureId`
 * para desambiguar.
 *
 * Decisión de diseño (referencia al step original): en vez de solo guardar
 * `keyword`/`text` sueltos, se conserva el `ParsedStep` completo tal cual lo
 * produjo `core/parser` (incluye `fromBackground` y, desde la feature de
 * edición de casos de prueba pendientes, `sourceLocation` — ver su JSDoc en
 * `core/types/parser.ts`). `sourceLocation` es lo que permite a
 * `adapters/server` (`PATCH /api/session/scenario/:scenarioId`) reescribir
 * la línea exacta del `.feature` de origen al editar el texto de un step
 * desde la UI (ver `core/parser/featureWriter.ts`).
 *
 * Decisión de diseño (`defectDescription` obligatorio en fail): la interfaz
 * lo modela como opcional (`string | undefined`) porque tiene sentido en
 * TypeScript para todo `StepResult` que no sea `'fail'`. La regla real
 * ("obligatorio cuando `result === 'fail'`") no es expresable de forma
 * simple con tipos discriminados sin duplicar toda la interfaz, así que se
 * valida en runtime en `SessionEngine.setStepResult` (lanza
 * `InvalidStepTransitionError` si falta). Ver `core/types/errors.ts`.
 */
export interface StepExecution {
  /** Id determinístico, ver nota de diseño arriba. */
  id: string;
  /** El step original tal cual lo produjo `core/parser`. */
  step: ParsedStep;
  /** `'pending'` hasta que el QA lo ejecute y asigne un resultado. */
  result: StepResult;
  /** Nota libre del QA sobre este step (opcional, independiente del resultado). */
  notes?: string;
  /**
   * Descripción del defecto encontrado. Solo tiene sentido (y solo se
   * valida como obligatorio) cuando `result === 'fail'`. Si el step se
   * vuelve a marcar como `'pass'`/`'skip'`/`'pending'`, `SessionEngine` la
   * limpia para no dejar información de un defecto obsoleta.
   */
  defectDescription?: string;
  /** Ids de `EvidenceFile` (ver `core/types/evidence.ts`) adjuntos a este step. */
  evidenceFileIds: string[];
  /** Timestamps ISO 8601. `completedAt` se limpia si el step vuelve a `'pending'`. */
  timestamps: {
    startedAt?: string;
    completedAt?: string;
  };
}

/**
 * Ejecución de un `ParsedScenario`: agrupa sus `StepExecution` en orden
 * (Background ya incrustado, igual que en `ParsedScenario.steps`).
 *
 * Decisión de diseño (resultado derivado): `ScenarioExecution` NO tiene un
 * campo `result` persistido. Es "un getter conceptual": se calcula siempre
 * a partir de `steps` con `deriveScenarioResult` (más abajo), nunca se
 * guarda en `session.json`. Motivo: si fuera un campo guardado, cada
 * mutación de un step tendría que recordar recalcularlo y re-guardarlo, lo
 * que crea una fuente de verdad duplicada que puede desincronizarse (p. ej.
 * un bug futuro que actualice `steps` pero no `result`). Al ser puramente
 * derivado, siempre está en sincronía con `steps` por construcción.
 *
 * Regla de derivación (misma prioridad para `deriveFeatureResult`, ver
 * abajo, aplicada sobre los resultados derivados de los scenarios):
 * 1. Si algún step es `'fail'` → el scenario es `'fail'`.
 * 2. Si no hay ningún `'fail'` pero algún step sigue `'pending'` → el
 *    scenario es `'pending'` (todavía no se terminó de ejecutar).
 * 3. Si no hay `'fail'` ni `'pending'` pero algún step es `'skip'` → el
 *    scenario es `'skip'`.
 * 4. Si todos los steps son `'pass'` (o no hay steps) → el scenario es
 *    `'pass'`.
 */
export interface ScenarioExecution {
  /**
   * Id determinístico: `"{featureId}_s{scenarioIndex}-{slug(name)}"`. Nota:
   * si `name` se edita después de crear la sesión (ver `editScenario` más
   * abajo), `id` NO se regenera — queda con el slug del nombre ORIGINAL.
   * Redundancia cosmética aceptada a propósito, mismo criterio ya usado para
   * las carpetas de evidencia (ver ARCHITECTURE.md, Fase 2): `id` debe seguir
   * siendo estable durante toda la sesión (evidencia/resultados ya lo usan
   * como referencia), así que solo `name` cambia.
   */
  id: string;
  name: string;
  tags: string[];
  steps: StepExecution[];
  /**
   * `true` si este scenario proviene de una fila de `Examples` de un
   * `Scenario Outline` (copiado de `ParsedScenario.isOutlineExample`, ver
   * `core/types/parser.ts`). Un scenario así NUNCA es editable desde la UI
   * (ver `assertScenarioEditable` más abajo): todas las filas expandidas de
   * un mismo Outline comparten la línea de origen en el `.feature` y su
   * texto ya viene interpolado, así que no hay una línea propia segura para
   * reescribir.
   */
  isOutlineExample: boolean;
  /**
   * Línea del `Scenario:`/`Escenario:` en el `.feature` de origen (copiado de
   * `ParsedScenario.sourceLocation`). `undefined` cuando `isOutlineExample`
   * es `true` (mismo motivo que arriba).
   */
  sourceLocation?: SourceLocation;
}

/**
 * Ejecución de una `ParsedFeature` seleccionada para esta sesión.
 *
 * Igual que `ScenarioExecution`, no tiene un campo `result` persistido: se
 * deriva con `deriveFeatureResult` a partir de los resultados derivados de
 * sus `scenarios` (misma tabla de prioridad fail > pending > skip > pass).
 */
export interface FeatureExecution {
  /** Id determinístico: `"f{featureIndex}-{slug(name)}"`. */
  id: string;
  name: string;
  tags: string[];
  scenarios: ScenarioExecution[];
  /**
   * Ruta absoluta del `.feature` de origen (`ParsedFeature.filePath`, ver
   * `core/types/parser.ts`) — permite reconocer, desde `adapters/server`,
   * qué features de `GET /api/features` ya forman parte de esta sesión (ver
   * `sessionQueries.ts`, `alreadySelectedRefIds`), sin que `core/session`
   * necesite saber nada sobre `featuresDir` ni sobre la forma de un
   * "ref id" (eso sigue siendo una decisión de `adapters/server`). Opcional
   * porque sesiones persistidas ANTES de que existiera este campo no lo
   * tienen — para esas, simplemente no hay forma de reconocer "ya
   * seleccionada" hasta que se recreen.
   */
  sourceFilePath?: string;
}

/** Posición actual del QA dentro del árbol `selectedFeatures`. */
export interface SessionPosition {
  featureIndex: number;
  scenarioIndex: number;
  stepIndex: number;
}

/**
 * Estado completo de una sesión de ejecución manual, persistido tal cual en
 * `session.json` (ver `SessionEngine`). `version: 1` desde el inicio para
 * permitir migraciones futuras del formato (ver ARCHITECTURE.md).
 */
export interface SessionState {
  version: 1;
  projectName: string;
  /** ISO 8601. No cambia una vez creada la sesión. */
  createdAt: string;
  /** ISO 8601. Se actualiza en cada mutación (autosave, ver `SessionEngine`). */
  updatedAt: string;
  selectedFeatures: FeatureExecution[];
  currentPosition: SessionPosition;
  status: 'not_started' | 'in_progress' | 'completed' | 'paused';
}

/**
 * Step actual (según `SessionState.currentPosition`) junto con los ids de
 * sus ancestros (`featureId`/`scenarioId`).
 *
 * Decisión de diseño: por qué exponer también `featureId`/`scenarioId` aquí
 * si `step.id` ya es globalmente único (ver JSDoc de `StepExecution`) y
 * por sí solo alcanza para todas las operaciones de `SessionEngine`. El
 * motivo es `core/evidence`: `EvidenceStore.save` (ver
 * `core/types/evidence.ts`) necesita la terna `featureId`/`scenarioId`/
 * `stepId` para construir la ruta
 * `evidence/{featureId}/{scenarioId}/{stepId}/...`, y el caller típico
 * (el adapter de fase 4/5) obtiene esa terna llamando a `getCurrentStep()`
 * en vez de tener que "desarmar" `step.id` a mano.
 */
export interface CurrentStepInfo {
  featureId: string;
  scenarioId: string;
  step: StepExecution;
}

/** Opciones para `SessionEngine.setStepResult`. */
export interface SetStepResultOptions {
  /** Obligatorio en runtime si `result === 'fail'` (ver JSDoc de `StepExecution`). */
  defectDescription?: string;
  /** Si se provee, reemplaza la nota del step. */
  notes?: string;
}

/**
 * Cambios pedidos por `SessionEngine.editScenario`: corregir el nombre del
 * scenario y/o el texto de uno o más de sus steps propios (no Background,
 * ver `assertScenarioEditable`/`findEditableStep`). Ambos campos son
 * opcionales pero al menos uno debe traer algo real — el caller
 * (`adapters/server`) es responsable de no llamar con un objeto vacío.
 */
export interface ScenarioEditChanges {
  /** Nuevo nombre del scenario, si se quiere corregir. */
  name?: string;
  /** Nuevo texto por step, identificado por `StepExecution.id`. */
  steps?: Array<{ stepId: string; text: string }>;
}

/**
 * Motor de ejecución de una sesión de QA manual: crea/carga/guarda el
 * estado, permite navegar por los steps seleccionados y registrar
 * resultado/evidencia/notas.
 *
 * Decisión de diseño (persistencia — autosave): TODAS las operaciones que
 * mutan el estado (`createSession`, `next`, `previous`, `goTo`,
 * `setStepResult`, `addEvidence`, `removeEvidence`, `addNotes`) persisten a
 * disco automáticamente antes de devolver el nuevo `SessionState` (llaman a
 * `save()` internamente). No se exige un `save()` manual aparte para no
 * arriesgar perder progreso si el proceso CLI/servidor muere entre una
 * mutación en memoria y un guardado explícito que el caller olvidó invocar.
 * Se eligió autosave-en-cada-mutación en vez de, por ejemplo, debounce o
 * guardado periódico porque esta es una sesión local de un solo usuario
 * (ver ARCHITECTURE.md, "Comunicación UI↔server": "un solo usuario por
 * sesión local") avanzando step a step con acciones humanas (nunca miles de
 * mutaciones por segundo), así que el costo de I/O de escribir un JSON
 * pequeño en cada paso es irrelevante. `save()` sigue expuesto en la
 * interfaz para el caso de `createSession`/`load` inicial y por si un
 * caller necesita forzar un guardado explícito (p. ej. antes de salir del
 * proceso).
 *
 * Decisión de diseño (`load` vs "cargar o crear"): `load()` es estricto —
 * lanza `SessionNotFoundError` si `sessionFilePath` no existe. El motor
 * nunca decide "si no existe, crear una nueva sesión" por su cuenta; esa
 * política ("cargar si existe, si no crear nueva") es del caller (en fase
 * 4, el comando `run` del CLI).
 */
export interface SessionEngine {
  /**
   * Crea una sesión nueva a partir de las features seleccionadas por el QA
   * (ya parseadas). Construye el árbol `selectedFeatures` completo con
   * todos los steps en `'pending'`, posiciona `currentPosition` en el
   * primer step de la primera feature/scenario no vacíos, guarda a disco y
   * devuelve el estado resultante. `status` arranca en `'in_progress'`
   * (ver nota de diseño en `core/session/sessionEngine.ts` sobre por qué
   * `'not_started'` no lo produce este motor).
   */
  createSession(features: ParsedFeature[], projectName: string): Promise<SessionState>;

  /**
   * Agrega `features` al FINAL de `selectedFeatures` de la sesión YA
   * creada, sin tocar ninguna de las ya existentes (sus resultados,
   * evidencia y notas quedan intactos) — a diferencia de `createSession`,
   * que reemplaza `selectedFeatures` por completo. Los ids de las nuevas
   * features continúan la secuencia de índices existente (`"f{N}-{slug}"`
   * con `N` arrancando en `selectedFeatures.length` ANTES de agregar), así
   * que nunca colisionan con los ya asignados.
   *
   * `currentPosition` salta al primer step de la primera feature agregada
   * (mismo criterio que `createSession`: "agregar" debe dejar al QA listo
   * para arrancar esa feature, no que tenga que navegar manualmente hasta
   * ella). Si `status` era `'completed'`, vuelve a `'in_progress'` — hay
   * trabajo pendiente de nuevo.
   *
   * Lanza `SessionNotFoundError` si todavía no hay ninguna sesión creada
   * (agregar features no tiene sentido sin una sesión base).
   */
  addFeatures(features: ParsedFeature[]): Promise<SessionState>;

  /** Carga el estado desde `sessionFilePath`. Lanza `SessionNotFoundError` si no existe. */
  load(): Promise<SessionState>;

  /** Persiste el estado actual en memoria a `sessionFilePath`. */
  save(): Promise<void>;

  /**
   * Devuelve el estado actual en memoria de forma síncrona. Lanza
   * `SessionNotFoundError` si todavía no se llamó a `createSession`/`load`.
   */
  getState(): SessionState;

  /**
   * Step en `currentPosition`, con sus ids de contexto. `null` si
   * `selectedFeatures` está vacío (sesión sin features seleccionadas).
   */
  getCurrentStep(): CurrentStepInfo | null;

  /**
   * Avanza al siguiente step, cruzando de scenario a scenario y de feature
   * a feature cuando se acaban los steps/scenarios. Al completar el último
   * step de la última feature seleccionada, `status` pasa a `'completed'` y
   * `currentPosition` queda apuntando a ese último step (no "se sale" del
   * árbol). Llamar a `next()` estando YA en ese último step es un no-op
   * (devuelve el estado sin cambios, no lanza error).
   *
   * Importante: el no-op se decide por POSICIÓN (¿hay un step siguiente al
   * que avanzar?), nunca por `status`. Si el QA completó la sesión y
   * después navegó hacia atrás (`previous()`/`goTo()`) para revisar o
   * agregar evidencia a un step anterior, `next()` sigue avanzando
   * normalmente desde ahí — `status` puede quedar en `'completed'` durante
   * ese recorrido (ya se completó la sesión al menos una vez) sin que eso
   * bloquee volver a moverse hacia adelante.
   */
  next(): Promise<SessionState>;

  /**
   * Retrocede al step anterior (cruzando de scenario/feature hacia atrás
   * igual que `next()`). Llamar a `previous()` en el primer step de la
   * sesión es un no-op.
   */
  previous(): Promise<SessionState>;

  /**
   * Salta a una posición arbitraria del árbol — es lo que permite volver a
   * un step anterior para editarlo (ver ARCHITECTURE.md, formato de
   * `session.json`). Solo cambia `currentPosition`; nunca toca los datos ya
   * guardados de steps posteriores/anteriores. Lanza
   * `InvalidStepTransitionError` si la posición está fuera de rango.
   */
  goTo(position: SessionPosition): Promise<SessionState>;

  /**
   * Asigna el resultado de un step (identificado por `stepId`, ver JSDoc de
   * `StepExecution` sobre por qué alcanza con el id solo, sin
   * `scenarioId`/`featureId`). Lanza `InvalidStepTransitionError` si
   * `stepId` no existe en la sesión actual. Si `result === 'fail'`,
   * `options.defectDescription` es obligatorio (no vacío tras `trim()`) y
   * si falta se lanza `InvalidStepTransitionError` sin mutar nada. Si
   * `result !== 'fail'`, cualquier `defectDescription` previo se limpia.
   * Actualiza `timestamps` (`startedAt` la primera vez, `completedAt` en
   * cada resultado distinto de `'pending'`; ambos se limpian si se vuelve a
   * `'pending'`).
   */
  setStepResult(
    stepId: string,
    result: StepResult,
    options?: SetStepResultOptions,
  ): Promise<SessionState>;

  /** Agrega el id de un `EvidenceFile` al step (idempotente: no duplica). */
  addEvidence(stepId: string, evidenceFileId: string): Promise<SessionState>;

  /** Quita el id de un `EvidenceFile` del step (no-op si no estaba). */
  removeEvidence(stepId: string, evidenceFileId: string): Promise<SessionState>;

  /** Reemplaza la nota libre del step. */
  addNotes(stepId: string, notes: string): Promise<SessionState>;

  /**
   * Corrige el nombre y/o el texto de uno o más steps de un scenario TODAVÍA
   * no ejecutado (ver `assertScenarioEditable`: lanza `InvalidStepTransitionError`
   * si el scenario es `isOutlineExample`, o si alguno de sus steps ya tiene
   * `result !== 'pending'` — el caso de prueba completo se bloquea apenas se
   * le asigna cualquier resultado, no solo el step corregido). También lanza
   * `InvalidStepTransitionError` si `scenarioId` no existe, si algún
   * `stepId` de `changes.steps` no pertenece a ese scenario, o si pertenece a
   * un step de Background (`step.fromBackground`, ver `findEditableStep`) —
   * nunca editable, sus steps son compartidos por todos los scenarios de la
   * feature.
   *
   * Deliberadamente NO reescribe el `.feature` de origen: `core/session` solo
   * conoce `session.json`. Reescribir el archivo (ver
   * `core/parser/featureWriter.ts`) es responsabilidad de quien orquesta
   * ambos pasos — `adapters/server` (`PATCH /api/session/scenario/:scenarioId`),
   * que llama al `FeatureWriter` ANTES de llamar acá, mismo criterio de
   * separación que ya usa el proyecto entre `core/session`/`core/evidence`.
   */
  editScenario(scenarioId: string, changes: ScenarioEditChanges): Promise<SessionState>;

  /**
   * Cierra la sesión actual: borra `session.json` del disco (no-op si no
   * existe) y limpia el estado en memoria — después de `close()`,
   * `getState()`/`getCurrentStep()` vuelven a lanzar `SessionNotFoundError`
   * como si nunca se hubiera creado ninguna sesión, y `createSession()`
   * puede volver a llamarse sin `?force=true` desde el caller (ver
   * `routes/session.ts`, `sessionHasRecordedProgress`).
   *
   * Decisión de diseño (NO borra evidencia ni reportes): `close()` solo
   * afecta el tracking de la sesión en sí. Los archivos físicos en
   * `evidence/` y cualquier reporte ya generado en `reports/` quedan
   * intactos — mismo criterio que ya aplica al re-seleccionar features con
   * `?force=true` (nunca se borra evidencia física, ver
   * `core/evidence/evidenceStore.ts`). Si el QA quiere limpiar esos
   * archivos, lo hace a mano.
   */
  close(): Promise<void>;
}

/**
 * Deriva el resultado de un scenario a partir de sus steps. Función pura
 * (sin I/O), ver la tabla de prioridad en el JSDoc de `ScenarioExecution`.
 */
export function deriveScenarioResult(scenario: ScenarioExecution): StepResult {
  return deriveFromResults(scenario.steps.map((step) => step.result));
}

/**
 * Deriva el resultado de una feature a partir del resultado derivado de sus
 * scenarios (misma tabla de prioridad, aplicada un nivel más arriba).
 */
export function deriveFeatureResult(feature: FeatureExecution): StepResult {
  return deriveFromResults(feature.scenarios.map((scenario) => deriveScenarioResult(scenario)));
}

function deriveFromResults(results: StepResult[]): StepResult {
  if (results.some((result) => result === 'fail')) return 'fail';
  if (results.some((result) => result === 'pending')) return 'pending';
  if (results.some((result) => result === 'skip')) return 'skip';
  return 'pass';
}

/**
 * Valida que `scenario` sea editable desde la UI (ver `SessionEngine.editScenario`):
 * ningún step suyo tiene todavía un resultado asignado (`result !== 'pending'`
 * bloquea el caso de prueba COMPLETO, no solo el step marcado — mismo
 * criterio que ya usa `setStepResult` para la cascada de skip/fail) y no
 * proviene de un `Scenario Outline` (`isOutlineExample`). Función pura (sin
 * mutar nada): la reutilizan tanto `SessionEngine.editScenario` como
 * `adapters/server` (para fallar rápido, antes de tocar el `.feature`, con el
 * mismo mensaje). Lanza `InvalidStepTransitionError`, no devuelve nada.
 */
export function assertScenarioEditable(scenario: ScenarioExecution): void {
  if (scenario.isOutlineExample) {
    throw new InvalidStepTransitionError(
      `el escenario "${scenario.name}" proviene de un Scenario Outline y no se puede editar desde la UI.`,
    );
  }
  if (scenario.steps.some((step) => step.result !== 'pending')) {
    throw new InvalidStepTransitionError(
      `el caso de prueba "${scenario.name}" ya tiene un resultado asignado — no se puede editar.`,
    );
  }
}

/**
 * Busca, dentro de `scenario`, el `StepExecution` con id `stepId` y valida
 * que sea editable: debe pertenecer a `scenario` y no provenir de un
 * `Background` (`step.step.fromBackground`) — sus steps son compartidos por
 * todos los scenarios de la feature, nunca editables desde acá. Función pura,
 * mismo criterio de reuso que `assertScenarioEditable`. Lanza
 * `InvalidStepTransitionError` si no se cumple alguna de las dos condiciones.
 */
export function findEditableStep(scenario: ScenarioExecution, stepId: string): StepExecution {
  const step = scenario.steps.find((candidate) => candidate.id === stepId);
  if (!step) {
    throw new InvalidStepTransitionError(
      `el step "${stepId}" no pertenece al escenario "${scenario.id}".`,
    );
  }
  if (step.step.fromBackground) {
    throw new InvalidStepTransitionError(
      `el step "${stepId}" pertenece a un Background compartido por toda la feature — no se puede editar desde la UI.`,
    );
  }
  return step;
}

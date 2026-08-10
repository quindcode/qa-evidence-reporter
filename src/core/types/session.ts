import type { ParsedFeature, ParsedStep } from './parser.js';

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
 * `keyword`/`text`/línea sueltos, se conserva el `ParsedStep` completo tal
 * cual lo produjo `core/parser` (incluye `fromBackground`). No se agrega un
 * número de línea porque `ParsedStep` no lo expone (ver su JSDoc en
 * `core/types/parser.ts`): la info de línea solo existe en el AST crudo de
 * `@cucumber/gherkin`, antes de compilarse a Pickle, y `core/parser` decidió
 * no propagarla porque ningún consumidor la necesitaba hasta ahora. Si una
 * fase futura la necesita, se agrega a `ParsedStep` en `core/parser`, no
 * aquí.
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
  /** Id determinístico: `"{featureId}_s{scenarioIndex}-{slug(name)}"`. */
  id: string;
  name: string;
  tags: string[];
  steps: StepExecution[];
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
   * árbol). Llamar a `next()` cuando ya está `'completed'` es un no-op
   * (devuelve el estado sin cambios, no lanza error).
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

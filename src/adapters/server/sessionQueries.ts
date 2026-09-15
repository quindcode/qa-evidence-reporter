import { relative } from 'node:path';

import { InvalidStepTransitionError, SessionNotFoundError } from '../../core/types/errors.js';
import type { ParsedFeature } from '../../core/types/parser.js';
import type {
  ScenarioExecution,
  SessionEngine,
  SessionState,
  StepExecution,
} from '../../core/types/session.js';

/**
 * Id estable para un `ParsedFeature` TODAVÍA no seleccionado en ninguna
 * sesión (usado por `GET /api/features` y `POST /api/session/select`, ver
 * `routes/features.ts`). Antes de crear la sesión no existe un
 * `FeatureExecution.id` (ese id lo genera `SessionEngine.createSession` a
 * partir de la POSICIÓN dentro de las features ya seleccionadas, ver
 * `core/session/ids.ts`) — necesitamos un identificador que exista incluso
 * para features que el QA todavía no eligió correr.
 *
 * Se usa la ruta relativa a `featuresDir`, siempre con `/` (portable entre
 * OS): es estable mientras el archivo no se mueva/renombre, es única por
 * construcción del filesystem (dos archivos no pueden compartir ruta) y no
 * requiere mantener un índice aparte.
 */
export function buildFeatureRefId(featuresDir: string, feature: ParsedFeature): string {
  return refIdFromFilePath(featuresDir, feature.filePath);
}

/** Misma lógica que `buildFeatureRefId`, pero sobre una ruta de archivo suelta en vez de un `ParsedFeature` completo — la usa `alreadySelectedRefIds` sobre `FeatureExecution.sourceFilePath`. */
function refIdFromFilePath(featuresDir: string, filePath: string): string {
  return relative(featuresDir, filePath).split(/[\\/]/).join('/');
}

/**
 * Ref-ids (mismo formato que `buildFeatureRefId`/`FeatureSummary.id`, ver
 * `routes/features.ts`) de las features que YA forman parte de `session` —
 * a partir de `FeatureExecution.sourceFilePath` (ver su JSDoc en
 * `core/types/session.ts`). `session: null` o una sesión sin ninguna
 * `sourceFilePath` reconocible (persistida antes de que ese campo
 * existiera) produce un `Set` vacío — nunca lanza.
 */
export function alreadySelectedRefIds(featuresDir: string, session: SessionState | null): Set<string> {
  if (!session) return new Set();
  return new Set(
    session.selectedFeatures
      .map((feature) => feature.sourceFilePath)
      .filter((path): path is string => Boolean(path))
      .map((filePath) => refIdFromFilePath(featuresDir, filePath)),
  );
}

/**
 * Devuelve el `SessionState` actual, cargándolo desde disco si todavía no se
 * cargó en memoria en este proceso (p. ej. tras reiniciar el server con una
 * sesión ya persistida de una corrida anterior — ver ARCHITECTURE.md,
 * "debe permitir resumir tras cerrar el navegador"). `null` si genuinamente
 * no hay ninguna sesión (ni en memoria ni en disco).
 *
 * Decisión de diseño (por qué no siempre `load()`): `SessionEngine` guarda
 * su estado en una variable de closure (ver `core/session/sessionEngine.ts`)
 * que ya está actualizada en memoria después de cualquier mutación de este
 * mismo proceso (autosave). Volver a leer el archivo en cada request sería
 * I/O innecesario en el caso común; solo se recurre a `load()` cuando
 * `getState()` (síncrono) indica que este `SessionEngine` nunca cargó nada
 * todavía.
 */
export async function loadCurrentSessionOrNull(
  engine: SessionEngine,
): Promise<SessionState | null> {
  try {
    return engine.getState();
  } catch (error) {
    if (!(error instanceof SessionNotFoundError)) throw error;
  }

  try {
    return await engine.load();
  } catch (error) {
    if (error instanceof SessionNotFoundError) return null;
    throw error;
  }
}

/** Contexto de ancestros de un step, misma forma que `SessionEngine.getCurrentStep()` pero para un `stepId` ARBITRARIO (no solo el de `currentPosition`). */
export interface StepContext {
  featureId: string;
  scenarioId: string;
  step: StepExecution;
}

/**
 * Busca un `stepId` arbitrario en TODO el árbol de `state` y devuelve sus
 * ids de contexto (`featureId`/`scenarioId`) — necesarios para
 * `EvidenceStore.save` (ver `core/types/evidence.ts`, `SaveEvidenceInput`).
 *
 * Decisión de diseño (por qué no vive en `SessionEngine`): la interfaz
 * pública de `SessionEngine` solo expone esta terna para el step de
 * `currentPosition` (`getCurrentStep()`) — deliberado, ver su JSDoc en
 * `core/types/session.ts` ("`stepId` alcanza sin `scenarioId`/`featureId`
 * para desambiguar" en las operaciones de mutación). Pero la UX de "volver a
 * un step anterior para adjuntar/editar evidencia" (ARCHITECTURE.md) implica
 * que la ruta de subida (`POST /api/session/step/:stepId/evidence`) puede
 * apuntar a un step que NO es el actual. En vez de ensanchar el contrato de
 * `SessionEngine` para un caso de uso puramente de transporte, este helper
 * recorre `SessionState` (una estructura pública, ver `core/types/session.ts`)
 * con el mismo patrón que ya usa `core/report/reportGenerator.ts`
 * (`buildFeatureViews`) para recorrer ese mismo árbol — no es un acceso a
 * ningún detalle interno de `core/session`.
 */
export function findStepContext(state: SessionState, stepId: string): StepContext {
  for (const feature of state.selectedFeatures) {
    for (const scenario of feature.scenarios) {
      const step = scenario.steps.find((candidate) => candidate.id === stepId);
      if (step) return { featureId: feature.id, scenarioId: scenario.id, step };
    }
  }

  throw new InvalidStepTransitionError(`no existe un step con id "${stepId}" en la sesión actual.`);
}

/** Contexto de un scenario arbitrario — misma idea que `StepContext`, un nivel más arriba. */
export interface ScenarioContext {
  featureId: string;
  /** `FeatureExecution.sourceFilePath` de la feature dueña (ver su JSDoc en `core/types/session.ts`). */
  sourceFilePath: string | undefined;
  scenario: ScenarioExecution;
}

/**
 * Busca un `scenarioId` arbitrario en TODO el árbol de `state` y devuelve su
 * contexto — usado por `PATCH /api/session/scenario/:scenarioId`
 * (`routes/session.ts`) para saber en qué archivo `.feature` reescribir antes
 * de llamar a `SessionEngine.editScenario`. Mismo criterio que
 * `findStepContext`: vive acá (no en `SessionEngine`) porque es un caso de
 * uso puramente de transporte sobre la estructura pública `SessionState`.
 */
export function findScenarioContext(state: SessionState, scenarioId: string): ScenarioContext {
  for (const feature of state.selectedFeatures) {
    const scenario = feature.scenarios.find((candidate) => candidate.id === scenarioId);
    if (scenario) {
      return { featureId: feature.id, sourceFilePath: feature.sourceFilePath, scenario };
    }
  }

  throw new InvalidStepTransitionError(
    `no existe un escenario con id "${scenarioId}" en la sesión actual.`,
  );
}

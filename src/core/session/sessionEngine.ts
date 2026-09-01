import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { InvalidStepTransitionError, SessionNotFoundError } from '../types/errors.js';
import type { ParsedFeature, ParsedScenario, ParsedStep } from '../types/parser.js';
import type {
  CurrentStepInfo,
  FeatureExecution,
  ScenarioExecution,
  SessionEngine,
  SessionPosition,
  SessionState,
  SetStepResultOptions,
  StepExecution,
  StepResult,
} from '../types/session.js';
import { buildFeatureId, buildScenarioId, buildStepId } from './ids.js';

/**
 * Punto de extensión mínimo para inyectar dependencias en
 * `createSessionEngine`. `clock` es lo único inyectable: es la única fuente
 * de no-determinismo del motor (todo lo demás — ids, transiciones de
 * estado, orden de navegación — es una función pura de sus inputs). Sin
 * inyectarlo, los tests de timestamps tendrían que lidiar con `Date.now()`
 * real (flaky/no reproducible).
 */
export interface SessionEngineDeps {
  /** Por defecto `() => new Date().toISOString()`. */
  clock?: () => string;
}

/**
 * Factory del `SessionEngine` de referencia: persiste el estado como JSON
 * plano en `sessionFilePath`.
 *
 * Decisión de diseño (`sessionFilePath` como parámetro, no una convención
 * hardcodeada): en producción real este será
 * `.qa-evidence-reporter/session.json` dentro del proyecto del QA (ver
 * ARCHITECTURE.md), pero decidir esa ruta es responsabilidad del CLI (fase
 * 4), no de este motor — así este módulo es trivial de testear contra
 * carpetas temporales y no depende de "en qué proyecto estoy corriendo".
 *
 * Decisión de diseño (`status` inicial): `createSession` siempre deja la
 * sesión en `'in_progress'` (nunca produce `'not_started'`), porque crear
 * la sesión YA posiciona `currentPosition` en el primer step, listo para
 * ejecutarse — no hay un estado intermedio real entre "creada" y "arrancó".
 * `'not_started'` queda modelado en el tipo por si una fase futura (CLI)
 * decide escribir un `session.json` de "borrador" antes de que el usuario
 * confirme qué features correr; este motor no lo produce ni lo requiere.
 * `'paused'` tampoco lo produce este motor (no hay un método `pause()` en
 * el alcance de esta fase); queda reservado para una fase futura.
 */
export function createSessionEngine(
  sessionFilePath: string,
  deps: SessionEngineDeps = {},
): SessionEngine {
  const clock = deps.clock ?? (() => new Date().toISOString());
  let state: SessionState | undefined;

  async function createSession(
    features: ParsedFeature[],
    projectName: string,
  ): Promise<SessionState> {
    const now = clock();
    state = {
      version: 1,
      projectName,
      createdAt: now,
      updatedAt: now,
      selectedFeatures: features.map((feature, featureIndex) =>
        toFeatureExecution(feature, featureIndex),
      ),
      currentPosition: { featureIndex: 0, scenarioIndex: 0, stepIndex: 0 },
      status: 'in_progress',
    };

    await persist();
    return state;
  }

  async function addFeatures(features: ParsedFeature[]): Promise<SessionState> {
    const current = requireState();
    const startIndex = current.selectedFeatures.length;
    const added = features.map((feature, i) => toFeatureExecution(feature, startIndex + i));
    current.selectedFeatures.push(...added);

    // Hay trabajo pendiente de nuevo — si la sesión ya estaba 'completed'
    // antes de agregar, ya no lo está.
    if (current.status === 'completed') current.status = 'in_progress';

    // Aterriza al QA en el primer step de la primera feature agregada —
    // mismo criterio que `createSession`. Defensivo (`?.`): en la práctica
    // toda `ParsedFeature` real tiene al menos un scenario con al menos un
    // step, pero no se asume acá.
    const firstScenario = added[0]?.scenarios[0];
    if (firstScenario && firstScenario.steps.length > 0) {
      current.currentPosition = { featureIndex: startIndex, scenarioIndex: 0, stepIndex: 0 };
    }

    current.updatedAt = clock();
    await persist();
    return current;
  }

  async function load(): Promise<SessionState> {
    let raw: string;
    try {
      raw = await readFile(sessionFilePath, 'utf-8');
    } catch (error) {
      throw new SessionNotFoundError(sessionFilePath, { cause: error });
    }

    state = JSON.parse(raw) as SessionState;
    return state;
  }

  async function save(): Promise<void> {
    await persist();
  }

  function getState(): SessionState {
    return requireState();
  }

  function getCurrentStep(): CurrentStepInfo | null {
    const current = requireState();
    const feature = current.selectedFeatures[current.currentPosition.featureIndex];
    const scenario = feature?.scenarios[current.currentPosition.scenarioIndex];
    const step = scenario?.steps[current.currentPosition.stepIndex];
    if (!feature || !scenario || !step) return null;
    return { featureId: feature.id, scenarioId: scenario.id, step };
  }

  async function next(): Promise<SessionState> {
    const current = requireState();

    const advanced = adjacentPosition(current, current.currentPosition, 1);
    if (advanced) {
      current.currentPosition = advanced;
    } else {
      // Ya estábamos en el último step de la última feature: no hay a
      // dónde avanzar, la sesión se considera terminada.
      current.status = 'completed';
    }

    current.updatedAt = clock();
    await persist();
    return current;
  }

  async function previous(): Promise<SessionState> {
    const current = requireState();
    const moved = adjacentPosition(current, current.currentPosition, -1);
    if (!moved) return current; // ya estábamos en el primer step: no-op.

    current.currentPosition = moved;
    current.updatedAt = clock();
    await persist();
    return current;
  }

  async function goTo(position: SessionPosition): Promise<SessionState> {
    const current = requireState();
    if (!isValidPosition(current, position)) {
      throw new InvalidStepTransitionError(
        `la posición ${JSON.stringify(position)} está fuera de rango para esta sesión.`,
      );
    }

    current.currentPosition = position;
    current.updatedAt = clock();
    await persist();
    return current;
  }

  async function setStepResult(
    stepId: string,
    result: StepResult,
    options: SetStepResultOptions = {},
  ): Promise<SessionState> {
    const current = requireState();
    const step = findStep(current, stepId);

    let failedScenarioPosition: SessionPosition | undefined;

    if (result === 'fail') {
      const defectDescription = options.defectDescription?.trim();
      if (!defectDescription) {
        throw new InvalidStepTransitionError(
          'se intentó marcar un step como "fail" sin proveer "defectDescription".',
        );
      }
      step.defectDescription = defectDescription;

      // Igual que "skip" (ver más abajo), un scenario fallido queda
      // considerado fallido COMPLETO, no solo el step donde se detectó el
      // defecto — seguir recorriendo el resto de sus steps para marcarlos
      // pass/pending sería inconsistente, dado que el caso ya está roto.
      // Además, a diferencia de "skip", "fail" también salta directo al
      // siguiente SCENARIO (no al siguiente step) — no tiene sentido seguir
      // step a step un caso que ya sabemos que falló.
      const scenario = findScenarioContainingStep(current, stepId);
      const failedAt = clock();
      for (const sibling of scenario.steps) {
        if (sibling.id === stepId) continue;
        sibling.result = 'fail';
        sibling.defectDescription = defectDescription;
        sibling.timestamps = {
          startedAt: sibling.timestamps.startedAt ?? failedAt,
          completedAt: failedAt,
        };
      }
      failedScenarioPosition = findPositionOfStep(current, stepId);
    } else {
      step.defectDescription = undefined;
    }

    step.result = result;
    if (options.notes !== undefined) step.notes = options.notes;

    if (result === 'pending') {
      step.timestamps = {};
    } else {
      step.timestamps = {
        startedAt: step.timestamps.startedAt ?? clock(),
        completedAt: clock(),
      };
    }

    // "Skip" es una decisión sobre el SCENARIO completo ("se decidió no
    // ejecutar este caso de prueba"), no sobre un step aislado — omitir
    // el primer step y dejar a los demás en pass/pending sería un estado
    // incoherente (un caso "parcialmente omitido" no existe en QA manual).
    // Por eso, marcar cualquier step como skip cascada al resto de los
    // steps del mismo scenario, pisando cualquier resultado previo que
    // tuvieran — igual que arriba, sin `defectDescription` y con
    // timestamps consistentes.
    if (result === 'skip') {
      const scenario = findScenarioContainingStep(current, stepId);
      const skippedAt = clock();
      for (const sibling of scenario.steps) {
        if (sibling.id === stepId) continue;
        sibling.result = 'skip';
        sibling.defectDescription = undefined;
        sibling.timestamps = {
          startedAt: sibling.timestamps.startedAt ?? skippedAt,
          completedAt: skippedAt,
        };
      }
    }

    if (failedScenarioPosition) {
      const next = firstPositionAfterScenario(current, failedScenarioPosition);
      if (next) {
        current.currentPosition = next;
      } else {
        // Era el último scenario de la sesión: no hay a dónde saltar, mismo
        // criterio que `next()` al llegar al final.
        current.status = 'completed';
      }
    }

    current.updatedAt = clock();
    await persist();
    return current;
  }

  async function addEvidence(stepId: string, evidenceFileId: string): Promise<SessionState> {
    const current = requireState();
    const step = findStep(current, stepId);
    if (!step.evidenceFileIds.includes(evidenceFileId)) {
      step.evidenceFileIds.push(evidenceFileId);
    }
    current.updatedAt = clock();
    await persist();
    return current;
  }

  async function removeEvidence(stepId: string, evidenceFileId: string): Promise<SessionState> {
    const current = requireState();
    const step = findStep(current, stepId);
    step.evidenceFileIds = step.evidenceFileIds.filter((id) => id !== evidenceFileId);
    current.updatedAt = clock();
    await persist();
    return current;
  }

  async function addNotes(stepId: string, notes: string): Promise<SessionState> {
    const current = requireState();
    const step = findStep(current, stepId);
    step.notes = notes;
    current.updatedAt = clock();
    await persist();
    return current;
  }

  async function close(): Promise<void> {
    await rm(sessionFilePath, { force: true });
    state = undefined;
  }

  async function persist(): Promise<void> {
    const current = requireState();
    await mkdir(dirname(sessionFilePath), { recursive: true });
    await writeFile(sessionFilePath, JSON.stringify(current, null, 2), 'utf-8');
  }

  function requireState(): SessionState {
    if (!state) {
      throw new SessionNotFoundError(sessionFilePath, {
        cause: new Error('createSession()/load() no fue llamado todavía en este SessionEngine.'),
      });
    }
    return state;
  }

  return {
    createSession,
    addFeatures,
    load,
    save,
    getState,
    getCurrentStep,
    next,
    previous,
    goTo,
    setStepResult,
    addEvidence,
    removeEvidence,
    addNotes,
    close,
  };
}

function toFeatureExecution(feature: ParsedFeature, featureIndex: number): FeatureExecution {
  const featureId = buildFeatureId(featureIndex, feature);
  return {
    id: featureId,
    name: feature.name,
    tags: feature.tags,
    scenarios: feature.scenarios.map((scenario, scenarioIndex) =>
      toScenarioExecution(scenario, featureId, scenarioIndex),
    ),
    sourceFilePath: feature.filePath,
  };
}

function toScenarioExecution(
  scenario: ParsedScenario,
  featureId: string,
  scenarioIndex: number,
): ScenarioExecution {
  const scenarioId = buildScenarioId(featureId, scenarioIndex, scenario);
  return {
    id: scenarioId,
    name: scenario.name,
    tags: scenario.tags,
    steps: scenario.steps.map((step, stepIndex) => toStepExecution(step, scenarioId, stepIndex)),
  };
}

function toStepExecution(step: ParsedStep, scenarioId: string, stepIndex: number): StepExecution {
  return {
    id: buildStepId(scenarioId, stepIndex),
    step,
    result: 'pending',
    evidenceFileIds: [],
    timestamps: {},
  };
}

/**
 * Todas las posiciones válidas de `state`, en orden de ejecución (feature →
 * scenario → step). Se usa para resolver `next()`/`previous()` como "la
 * posición siguiente/anterior en esta lista", en vez de reimplementar a
 * mano el cruce de límites de scenario/feature (incluyendo el caso límite
 * de features o scenarios sin steps) con aritmética de índices propensa a
 * errores.
 */
function flattenPositions(state: SessionState): SessionPosition[] {
  const positions: SessionPosition[] = [];
  state.selectedFeatures.forEach((feature, featureIndex) => {
    feature.scenarios.forEach((scenario, scenarioIndex) => {
      scenario.steps.forEach((_step, stepIndex) => {
        positions.push({ featureIndex, scenarioIndex, stepIndex });
      });
    });
  });
  return positions;
}

/** La posición inmediatamente siguiente (`direction: 1`) o anterior (`direction: -1`) a `position`, o `null` si no existe. */
function adjacentPosition(
  state: SessionState,
  position: SessionPosition,
  direction: 1 | -1,
): SessionPosition | null {
  const positions = flattenPositions(state);
  const currentIndex = positions.findIndex((candidate) => positionsEqual(candidate, position));
  if (currentIndex === -1) return null;
  return positions[currentIndex + direction] ?? null;
}

/**
 * La primera posición (en orden de ejecución) que ya NO pertenece al mismo
 * scenario que `position` — es decir, el primer step del scenario
 * siguiente, cruzando el límite de feature si hace falta. `null` si
 * `position` era el último scenario de la sesión. La usa la cascada de
 * "fail" de `setStepResult` para saltar directo al próximo scenario en vez
 * de seguir recorriendo, step a step, un caso que ya se sabe que falló.
 */
function firstPositionAfterScenario(
  state: SessionState,
  position: SessionPosition,
): SessionPosition | null {
  const positions = flattenPositions(state);
  const currentIndex = positions.findIndex((candidate) => positionsEqual(candidate, position));
  if (currentIndex === -1) return null;

  for (let i = currentIndex + 1; i < positions.length; i += 1) {
    const candidate = positions[i]!;
    if (
      candidate.featureIndex !== position.featureIndex ||
      candidate.scenarioIndex !== position.scenarioIndex
    ) {
      return candidate;
    }
  }
  return null;
}

/** Posición (`featureIndex`/`scenarioIndex`/`stepIndex`) del step `stepId` — reconstruida por índice en vez de solo por id, ya que la cascada de "fail" necesita cruzar límites de scenario/feature en términos de índices numéricos (ver `firstPositionAfterScenario`). */
function findPositionOfStep(state: SessionState, stepId: string): SessionPosition {
  for (const [featureIndex, feature] of state.selectedFeatures.entries()) {
    for (const [scenarioIndex, scenario] of feature.scenarios.entries()) {
      const stepIndex = scenario.steps.findIndex((candidate) => candidate.id === stepId);
      if (stepIndex !== -1) return { featureIndex, scenarioIndex, stepIndex };
    }
  }
  throw new InvalidStepTransitionError(`no existe un step con id "${stepId}" en la sesión actual.`);
}

function positionsEqual(a: SessionPosition, b: SessionPosition): boolean {
  return (
    a.featureIndex === b.featureIndex &&
    a.scenarioIndex === b.scenarioIndex &&
    a.stepIndex === b.stepIndex
  );
}

function isValidPosition(state: SessionState, position: SessionPosition): boolean {
  return flattenPositions(state).some((candidate) => positionsEqual(candidate, position));
}

/**
 * Busca un step por `id` en TODO el árbol de la sesión. Alcanza con
 * recorrer todas las features/scenarios/steps (en vez de, por ejemplo,
 * mantener un `Map<string, StepExecution>` aparte) porque `stepId` ya es
 * único a nivel global (ver JSDoc de `StepExecution` en
 * `core/types/session.ts`) y el tamaño de una sesión de QA manual (decenas
 * a cientos de steps, nunca miles) hace irrelevante el costo de un
 * recorrido lineal en cada mutación.
 */
function findStep(state: SessionState, stepId: string): StepExecution {
  for (const feature of state.selectedFeatures) {
    for (const scenario of feature.scenarios) {
      const step = scenario.steps.find((candidate) => candidate.id === stepId);
      if (step) return step;
    }
  }

  throw new InvalidStepTransitionError(`no existe un step con id "${stepId}" en la sesión actual.`);
}

/** Mismo recorrido que `findStep`, pero devuelve el `ScenarioExecution` contenedor — lo usa la cascada de skip de `setStepResult` para llegar a los steps hermanos. */
function findScenarioContainingStep(state: SessionState, stepId: string): ScenarioExecution {
  for (const feature of state.selectedFeatures) {
    for (const scenario of feature.scenarios) {
      if (scenario.steps.some((candidate) => candidate.id === stepId)) return scenario;
    }
  }

  throw new InvalidStepTransitionError(`no existe un step con id "${stepId}" en la sesión actual.`);
}

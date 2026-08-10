/**
 * Tipos usados por `src/ui/`, DUPLICADOS deliberadamente de `core/types/*`
 * (no importados desde ahí).
 *
 * Regla de dependencia estricta (ARCHITECTURE.md): "`ui/**` solo llama a
 * `adapters/server` vía `fetch` HTTP. Nunca importa `core`." — ni siquiera
 * para tipos "solo de compilación" (un `import type` de `core/**` sigue
 * siendo un import de `core/**`, y `eslint.config.js` lo bloquea igual, ver
 * la regla agregada en fase 5b para `src/ui/**`). Estos tipos son un espejo
 * INTENCIONAL (y deliberadamente parcial: solo los campos que la UI
 * realmente consume) de la forma real que devuelve la API — la fuente de
 * verdad real sigue siendo `core/types/session.ts` / `core/types/evidence.ts`
 * / `core/types/parser.ts`; si esos contratos cambian, este archivo se
 * desincroniza en tiempo de compilación de TypeScript, no en runtime (la API
 * REST sigue devolviendo JSON tal cual, sin tipos) — el costo aceptado a
 * cambio de que `ui/` compile de forma completamente independiente del
 * árbol de `core/**`.
 */

export type StepResult = 'pass' | 'fail' | 'skip' | 'pending';

export interface ParsedStepSummary {
  keyword: 'Given' | 'When' | 'Then';
  text: string;
  fromBackground: boolean;
}

export interface StepExecution {
  id: string;
  step: ParsedStepSummary;
  result: StepResult;
  notes?: string;
  defectDescription?: string;
  evidenceFileIds: string[];
  timestamps: {
    startedAt?: string;
    completedAt?: string;
  };
}

export interface ScenarioExecution {
  id: string;
  name: string;
  tags: string[];
  steps: StepExecution[];
}

export interface FeatureExecution {
  id: string;
  name: string;
  tags: string[];
  scenarios: ScenarioExecution[];
}

export interface SessionPosition {
  featureIndex: number;
  scenarioIndex: number;
  stepIndex: number;
}

export interface SessionState {
  version: 1;
  projectName: string;
  createdAt: string;
  updatedAt: string;
  selectedFeatures: FeatureExecution[];
  currentPosition: SessionPosition;
  status: 'not_started' | 'in_progress' | 'completed' | 'paused';
}

export interface CurrentStepInfo {
  featureId: string;
  scenarioId: string;
  step: StepExecution;
}

export type EvidenceKind = 'image' | 'video' | 'pdf' | 'other';

export interface EvidenceFile {
  id: string;
  originalFilename: string;
  path: string;
  kind: EvidenceKind;
  sizeBytes: number;
  thumbnailPath?: string;
  uploadedAt: string;
}

/** Forma de cada elemento de `GET /api/features` -> `features[]` (ver `routes/features.ts`). */
export interface FeatureSummary {
  id: string;
  name: string;
  description: string;
  tags: string[];
  scenarioCount: number;
}

/** Forma de `GET /api/features` -> `session` (ver `routes/features.ts`). */
export type SessionSummary =
  { exists: false } | { exists: true; status: SessionState['status']; projectName: string };

/**
 * Deriva el resultado de un scenario a partir de sus steps — misma tabla de
 * prioridad que `core/types/session.ts` (`deriveScenarioResult`,
 * `fail > pending > skip > pass`), duplicada acá por la misma razón que el
 * resto de este archivo (la UI necesita pintar el árbol lateral de
 * features/scenarios/steps con un color de estado por nodo, y no puede
 * importar la función real de `core/**`).
 */
export function deriveScenarioResult(scenario: ScenarioExecution): StepResult {
  return deriveFromResults(scenario.steps.map((step) => step.result));
}

/** Ver `deriveScenarioResult`; misma tabla de prioridad, un nivel más arriba. */
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
 * Reconstruye `CurrentStepInfo` a partir de `SessionState.currentPosition` —
 * mismo cálculo que `SessionEngine.getCurrentStep()` (`core/session/`), pero
 * aplicado sobre la estructura PÚBLICA `SessionState` en vez del estado
 * interno del motor (que la UI, por regla, nunca puede tocar directamente).
 *
 * Necesario porque `POST .../evidence` y `DELETE .../evidence/:id` (ver
 * `api.ts`) devuelven `{ session }` sin un `currentStep` ya resuelto (a
 * diferencia de `select`/`result`/`navigate`, que sí lo devuelven) — subir o
 * borrar evidencia nunca mueve `currentPosition`, así que recalcularlo acá
 * con la posición ya conocida es equivalente y evita una request extra solo
 * para volver a pedir el step actual.
 */
export function getCurrentStepFromSession(session: SessionState): CurrentStepInfo | null {
  const { featureIndex, scenarioIndex, stepIndex } = session.currentPosition;
  const feature = session.selectedFeatures[featureIndex];
  const scenario = feature?.scenarios[scenarioIndex];
  const step = scenario?.steps[stepIndex];
  if (!feature || !scenario || !step) return null;
  return { featureId: feature.id, scenarioId: scenario.id, step };
}

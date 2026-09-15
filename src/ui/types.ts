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

/** Espejo de `SourceLocation` (`core/types/parser.ts`) — ver `ParsedStepSummary.sourceLocation`. */
export interface SourceLocation {
  line: number;
}

export interface ParsedStepSummary {
  keyword: 'Given' | 'When' | 'Then';
  text: string;
  fromBackground: boolean;
  /** `undefined` cuando el scenario dueño es un `Scenario Outline` expandido — ver `isStepEditable`. */
  sourceLocation?: SourceLocation;
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
  /** `true` si viene de una fila de `Examples` de un `Scenario Outline` — nunca editable, ver `isScenarioEditable`. */
  isOutlineExample: boolean;
  /** `undefined` cuando `isOutlineExample` es `true`. */
  sourceLocation?: SourceLocation;
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
  | { exists: false }
  | {
      exists: true;
      status: SessionState['status'];
      projectName: string;
      /** Ref-ids (mismo formato que `FeatureSummary.id`) de las features ya en la sesión viva — ver `FeatureSelect.tsx`. */
      selectedFeatureIds: string[];
    };

/**
 * Forma de `GET /api/features` -> `branding` (ver `routes/features.ts` y
 * `routes/branding.ts`). `logoUrl`, cuando no es `null`, es SIEMPRE
 * `/branding/logo` (una ruta del propio server, nunca una ruta de
 * filesystem) — se usa directamente como `<img src={logoUrl}>`.
 */
export interface Branding {
  logoUrl: string | null;
  primaryColor: string | null;
  accentColor: string | null;
  highlightColor: string | null;
  ctaColor: string | null;
}

/**
 * Forma de `GET /api/features` -> `jira` (ver `routes/features.ts`). Solo
 * booleanos derivados de `qa-config.json` -> `jira.baseUrl`/`jira.email` y
 * del token en memoria del server — ninguno de los valores en sí (ni el
 * token, que nunca sale del server) se expone a la UI. `enabled` decide si
 * mostrar el botón "Adjuntar a Jira"; `tokenConfigured` decide si mostrarlo
 * habilitado o avisar de antemano que falta el token (ver `Runner.tsx`).
 */
export interface JiraFeatureConfig {
  enabled: boolean;
  tokenConfigured: boolean;
}

/**
 * Forma de `GET /api/features` -> `azureDevOps` (ver `routes/features.ts`).
 * Mismo criterio que `JiraFeatureConfig`: solo booleanos derivados de
 * `qa-config.json` -> `azureDevOps.organizationUrl`/`azureDevOps.project` y
 * del PAT en memoria del server — ni esos valores ni el PAT en sí se
 * exponen a la UI.
 */
export interface AzureDevOpsFeatureConfig {
  enabled: boolean;
  tokenConfigured: boolean;
}

/**
 * Forma de `GET /api/settings` / `PATCH /api/settings` / `POST
 * /api/settings/jira-token` / `POST /api/settings/azure-token` (ver
 * `adapters/server/routes/settings.ts`). A diferencia de
 * `JiraFeatureConfig`/`AzureDevOpsFeatureConfig` (solo el booleano
 * derivado), acá SÍ viajan `baseUrl`/`email`/`organizationUrl`/`project`
 * completos — es la pantalla de Configuración, tiene que poder mostrarlos
 * para editarlos. El token/PAT en sí NUNCA viaja, ni siquiera acá:
 * `tokenConfigured` es lo único que la UI puede saber sobre él (ver
 * `settingsService.ts`, "no secreto" vs. "secreto, solo en memoria del
 * server").
 */
export interface Settings {
  projectName: string;
  jira: {
    baseUrl: string | null;
    email: string | null;
    tokenConfigured: boolean;
  };
  azureDevOps: {
    organizationUrl: string | null;
    project: string | null;
    tokenConfigured: boolean;
  };
}

/** Patch parcial aceptado por `PATCH /api/settings` — mismos campos que `Settings`, todos opcionales. */
export interface SettingsPatch {
  projectName?: string;
  jira?: { baseUrl?: string | null; email?: string | null };
  azureDevOps?: { organizationUrl?: string | null; project?: string | null };
}

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
 * `true` si `scenario` se puede editar desde la UI (nombre + texto de sus
 * steps propios) — mismo criterio que `assertScenarioEditable`
 * (`core/types/session.ts`), duplicado acá por la misma razón que el resto
 * de este archivo: ningún step tiene todavía un resultado asignado, y el
 * scenario no viene de un `Scenario Outline`. El server vuelve a validar
 * esto mismo en `PATCH /api/session/scenario/:scenarioId` — este helper solo
 * decide si mostrar el botón de edición.
 */
export function isScenarioEditable(scenario: ScenarioExecution): boolean {
  return (
    !scenario.isOutlineExample && scenario.steps.every((step) => step.result === 'pending')
  );
}

/**
 * `true` si `step` (dentro de `scenario`) se puede editar — mismo criterio
 * que `findEditableStep` (`core/types/session.ts`): el scenario completo debe
 * ser editable Y el step no debe provenir de un `Background` compartido.
 */
export function isStepEditable(scenario: ScenarioExecution, step: StepExecution): boolean {
  return isScenarioEditable(scenario) && !step.step.fromBackground;
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

/**
 * `true` si `session.currentPosition` apunta al último step del último
 * scenario de la última feature seleccionada — es decir, no hay a dónde
 * avanzar con `POST /api/session/navigate` (`{ direction: "next" }`, ver
 * `adjacentPosition` en `core/session/sessionEngine.ts`, la fuente real de
 * este mismo cálculo del lado del server). El runner (`Runner.tsx`) usa
 * esto para OCULTAR el botón "Siguiente" en vez de solo deshabilitarlo: en
 * ese step no hay nada más a lo que avanzar, mostrar un botón que no lleva
 * a ningún lado es confuso.
 */
export function isLastStepInSession(session: SessionState): boolean {
  const { featureIndex, scenarioIndex, stepIndex } = session.currentPosition;
  const feature = session.selectedFeatures[featureIndex];
  const scenario = feature?.scenarios[scenarioIndex];
  if (!feature || !scenario) return false;

  const isLastFeature = featureIndex === session.selectedFeatures.length - 1;
  const isLastScenario = scenarioIndex === feature.scenarios.length - 1;
  const isLastStep = stepIndex === scenario.steps.length - 1;
  return isLastFeature && isLastScenario && isLastStep;
}

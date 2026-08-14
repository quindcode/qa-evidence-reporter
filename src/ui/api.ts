import type {
  Branding,
  CurrentStepInfo,
  EvidenceFile,
  FeatureSummary,
  JiraFeatureConfig,
  SessionState,
  SessionSummary,
  StepResult,
} from './types';

/**
 * Error de API tipado: envuelve la forma `{ error: { code, message } }` que
 * devuelve TODO error del server (ver `adapters/server/errors.ts`,
 * `createErrorHandler`) para que los componentes puedan mostrar `message`
 * directamente y, si necesitan lógica especial por `code` (p. ej.
 * `SESSION_ALREADY_IN_PROGRESS`), la tengan disponible sin volver a parsear
 * el body.
 */
export class ApiRequestError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'ApiRequestError';
    this.code = code;
  }
}

interface ApiErrorBody {
  error: { code: string; message: string };
}

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  return (
    typeof value === 'object' &&
    value !== null &&
    'error' in value &&
    typeof (value as { error?: unknown }).error === 'object'
  );
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    throw new ApiRequestError(
      'NETWORK_ERROR',
      'No se pudo conectar con el servidor. Verificá que qa-evidence-reporter siga corriendo.',
    );
  }

  const contentType = response.headers.get('content-type') ?? '';
  const body: unknown = contentType.includes('application/json')
    ? await response.json().catch(() => null)
    : null;

  if (!response.ok) {
    if (isApiErrorBody(body)) {
      throw new ApiRequestError(body.error.code, body.error.message);
    }
    throw new ApiRequestError(
      'UNKNOWN_ERROR',
      `Ocurrió un error inesperado (HTTP ${response.status}).`,
    );
  }

  return body as T;
}

export interface FeaturesResponse {
  features: FeatureSummary[];
  session: SessionSummary;
  projectName: string;
  branding: Branding;
  jira: JiraFeatureConfig;
}

export interface SessionResponse {
  session: SessionState;
  currentStep: CurrentStepInfo | null;
}

export interface EvidenceUploadResponse {
  evidenceFiles: EvidenceFile[];
  session: SessionState;
}

export interface EvidenceListResponse {
  evidenceFiles: EvidenceFile[];
}

export interface ReportGenerateResponse {
  reportUrl: string;
}

export interface JiraPublishResponse {
  issueKey: string;
  issueUrl: string;
}

/**
 * Cliente HTTP hacia `adapters/server` (fetch nativo, sin librería) — ver
 * ARCHITECTURE.md, "Comunicación UI↔server": "REST puro (fetch), sin
 * WebSocket". Cada función corresponde 1:1 a una ruta real (ver
 * `src/adapters/server/routes/*.ts`), leídas del código fuente, no de
 * memoria.
 */
export const api = {
  getFeatures(): Promise<FeaturesResponse> {
    return request<FeaturesResponse>('/api/features');
  },

  selectFeatures(featureIds: string[], force = false): Promise<SessionResponse> {
    const query = force ? '?force=true' : '';
    return request<SessionResponse>(`/api/session/select${query}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ featureIds }),
    });
  },

  getSession(): Promise<SessionResponse> {
    return request<SessionResponse>('/api/session');
  },

  getStepEvidence(stepId: string): Promise<EvidenceListResponse> {
    return request<EvidenceListResponse>(
      `/api/session/step/${encodeURIComponent(stepId)}/evidence`,
    );
  },

  uploadEvidence(stepId: string, files: File[]): Promise<EvidenceUploadResponse> {
    const formData = new FormData();
    for (const file of files) formData.append('files', file);
    return request<EvidenceUploadResponse>(
      `/api/session/step/${encodeURIComponent(stepId)}/evidence`,
      { method: 'POST', body: formData },
    );
  },

  deleteEvidence(stepId: string, evidenceId: string): Promise<{ session: SessionState }> {
    return request<{ session: SessionState }>(
      `/api/session/step/${encodeURIComponent(stepId)}/evidence/${encodeURIComponent(evidenceId)}`,
      { method: 'DELETE' },
    );
  },

  setStepResult(
    stepId: string,
    result: StepResult,
    options: { defectDescription?: string; notes?: string } = {},
  ): Promise<SessionResponse> {
    return request<SessionResponse>(`/api/session/step/${encodeURIComponent(stepId)}/result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ result, ...options }),
    });
  },

  navigateNext(): Promise<SessionResponse> {
    return request<SessionResponse>('/api/session/navigate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ direction: 'next' }),
    });
  },

  navigatePrevious(): Promise<SessionResponse> {
    return request<SessionResponse>('/api/session/navigate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ direction: 'previous' }),
    });
  },

  navigateTo(position: {
    featureIndex: number;
    scenarioIndex: number;
    stepIndex: number;
  }): Promise<SessionResponse> {
    return request<SessionResponse>('/api/session/navigate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(position),
    });
  },

  generateReport(): Promise<ReportGenerateResponse> {
    return request<ReportGenerateResponse>('/api/report/generate', { method: 'POST' });
  },

  publishToJira(issueKey: string): Promise<JiraPublishResponse> {
    return request<JiraPublishResponse>('/api/report/publish-jira', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ issueKey }),
    });
  },

  closeSession(): Promise<{ closed: true }> {
    return request<{ closed: true }>('/api/session/close', { method: 'POST' });
  },
};

/** `GET /api/report/export-zip` no se llama con `fetch`: es una descarga de archivo real (ver `ExportZipButton`). */
export const EXPORT_ZIP_URL = '/api/report/export-zip';

/** Prefijos estáticos (ver `adapters/server/staticPrefixes.ts`), duplicados acá por la misma razón que `colors.ts`: `ui/` no puede importar `adapters/server`. */
export const EVIDENCE_STATIC_PREFIX = '/evidence-files';
export const REPORTS_STATIC_PREFIX = '/reports-static';

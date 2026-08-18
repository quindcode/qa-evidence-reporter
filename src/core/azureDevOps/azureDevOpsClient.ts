import {
  AzureDevOpsAuthenticationError,
  AzureDevOpsNotConfiguredError,
  AzureDevOpsRequestError,
  AzureDevOpsWorkItemNotFoundError,
} from '../types/errors.js';

/**
 * Datos necesarios para hablar con una organización de Azure DevOps.
 * `organizationUrl`/`project` vienen de `qa-config.json` → `azureDevOps`
 * (`core/types/config.ts`); `personalAccessToken` viene SIEMPRE de la
 * variable de entorno `AZURE_DEVOPS_PAT`, nunca del archivo de config — ver
 * `adapters/server/context.ts`.
 */
export interface AzureDevOpsClientConfig {
  organizationUrl: string | null;
  project: string | null;
  personalAccessToken: string | undefined;
}

export interface AzureDevOpsClientDeps {
  /** Por defecto el `fetch` global (Node >=18, vía `undici`). Inyectable para tests con un fake. */
  fetchImpl?: typeof fetch;
}

export interface AzureDevOpsClient {
  /**
   * Sube `fileBuffer` (nombrado `filename`) como adjunto de `workItemId` vía
   * la API REST de Azure DevOps (`wit/attachments` + una relación
   * `AttachedFile` en el work item). Devuelve la URL del work item en el
   * browser para que el caller pueda ofrecer un link directo, no la URL de
   * la API.
   *
   * ANTES de subir, busca los adjuntos que ya tiene `workItemId` y borra
   * (best-effort) las relaciones que se llamen igual que `filename` — así
   * publicar dos veces sobre el mismo work item REEMPLAZA el `.zip`
   * anterior en vez de ir acumulando copias con el mismo nombre.
   */
  attachReport(
    workItemId: number,
    fileBuffer: Buffer,
    filename: string,
  ): Promise<{ workItemUrl: string }>;

  /**
   * Agrega `html` (ver `buildQaSummaryCommentHtml`,
   * `core/azureDevOps/commentBuilder.ts`) como un comentario nuevo de
   * `workItemId` vía la API REST de Azure DevOps. Un comentario es aditivo
   * (no pisa nada que el equipo ya haya escrito ahí) y, si se publica más
   * de una vez, deja un historial de comentarios en vez de sobreescribir
   * el anterior.
   */
  addComment(workItemId: number, html: string): Promise<void>;
}

/** `api-version` de la mayoría de los endpoints usados acá (adjuntos, work items). */
const API_VERSION = '7.1';
/** La API de comentarios de work items todavía usa el sufijo "-preview" en su `api-version` documentada, aunque es la forma estable/recomendada (no un endpoint inestable de verdad). */
const COMMENTS_API_VERSION = '7.1-preview.4';

/**
 * Factory del cliente de Azure DevOps — mismo criterio que
 * `createJiraClient` (`core/jira/jiraClient.ts`): una factory SIN I/O, que
 * nunca lanza al construirse aunque `config` esté incompleto. La validación
 * de "¿está esto realmente configurado?" ocurre recién dentro de
 * `attachReport()`/`addComment()`, la primera vez que se necesita de
 * verdad — así un server puede arrancar sin Azure DevOps configurado sin
 * que eso sea un error.
 *
 * Nota de diseño (módulo hermano de `core/jira`, no una abstracción
 * compartida): ver la nota de diseño de `AzureDevOpsConfigSchema`
 * (`core/types/config.ts`) sobre por qué este archivo no reusa/extiende
 * `JiraClient` pese a la forma similar — las dos integraciones difieren
 * demasiado en protocolo (Basic auth con usuario vacío en vez de
 * `email:token`; adjuntar es un flujo de 2 pasos con JSON Patch en vez de
 * un único multipart; los comentarios son HTML plano en vez de ADF) como
 * para que compartir código valiera la pena antes de que exista una
 * tercera integración real que confirme qué parte es genuinamente común.
 */
export function createAzureDevOpsClient(
  config: AzureDevOpsClientConfig,
  deps: AzureDevOpsClientDeps = {},
): AzureDevOpsClient {
  const fetchImpl = deps.fetchImpl ?? fetch;

  /**
   * Requiere `config` completo (lanza `AzureDevOpsNotConfiguredError` si
   * no) y arma el header `Authorization: Basic` — un PAT de Azure DevOps
   * autentica con Basic auth de usuario VACÍO (`:PAT`), a diferencia de
   * Jira, que usa `email:token`.
   */
  function requireConfig(): {
    organizationUrl: string;
    project: string;
    apiBaseUrl: string;
    authHeader: string;
  } {
    if (!config.organizationUrl || !config.project || !config.personalAccessToken) {
      throw new AzureDevOpsNotConfiguredError();
    }
    const authHeader = `Basic ${Buffer.from(`:${config.personalAccessToken}`).toString('base64')}`;
    const apiBaseUrl = `${config.organizationUrl}/${encodeURIComponent(config.project)}`;
    return { organizationUrl: config.organizationUrl, project: config.project, apiBaseUrl, authHeader };
  }

  /**
   * Mismo mapeo de status HTTP a error de dominio para todas las
   * operaciones (401/403 → autenticación, 404 → work item inexistente/sin
   * permiso, cualquier otro no-2xx → error genérico con el detalle que
   * devolvió Azure DevOps). No lanza si `response.ok`.
   */
  async function assertOk(response: Response, workItemId: number): Promise<void> {
    if (response.ok) return;
    if (response.status === 401 || response.status === 403) {
      throw new AzureDevOpsAuthenticationError();
    }
    if (response.status === 404) {
      throw new AzureDevOpsWorkItemNotFoundError(workItemId);
    }
    const bodyText = await response.text().catch(() => '');
    throw new AzureDevOpsRequestError(
      `Azure DevOps respondió ${response.status}: ${bodyText || '(sin detalle)'}`,
    );
  }

  /** Sube el binario a `wit/attachments` (todavía sin ligar a ningún work item) y devuelve la URL del adjunto ya creado. */
  async function uploadAttachment(
    apiBaseUrl: string,
    authHeader: string,
    fileBuffer: Buffer,
    filename: string,
    workItemId: number,
  ): Promise<string> {
    const url = `${apiBaseUrl}/_apis/wit/attachments?fileName=${encodeURIComponent(filename)}&api-version=${API_VERSION}`;

    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: 'POST',
        headers: {
          Authorization: authHeader,
          Accept: 'application/json',
          'Content-Type': 'application/octet-stream',
        },
        body: fileBuffer,
      });
    } catch (error) {
      throw new AzureDevOpsRequestError('no se pudo conectar con Azure DevOps', { cause: error });
    }
    await assertOk(response, workItemId);

    const data = (await response.json()) as { url: string };
    return data.url;
  }

  /**
   * Busca las relaciones `AttachedFile` que ya tiene `workItemId` con
   * `attributes.name === filename` y arma sus operaciones de JSON Patch
   * `remove` — en orden DESCENDENTE de índice, porque un patch aplica sus
   * operaciones secuencialmente sobre el MISMO array: borrar primero el
   * índice más alto no corre los índices más bajos que todavía faltan
   * borrar dentro del mismo request.
   */
  async function buildRemoveOpsForExistingAttachment(
    apiBaseUrl: string,
    authHeader: string,
    workItemId: number,
    filename: string,
  ): Promise<Array<{ op: 'remove'; path: string }>> {
    const url = `${apiBaseUrl}/_apis/wit/workitems/${workItemId}?$expand=relations&api-version=${API_VERSION}`;

    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: 'GET',
        headers: { Authorization: authHeader, Accept: 'application/json' },
      });
    } catch (error) {
      throw new AzureDevOpsRequestError('no se pudo conectar con Azure DevOps', { cause: error });
    }
    await assertOk(response, workItemId);

    const data = (await response.json()) as {
      relations?: Array<{ rel: string; attributes?: { name?: string } }>;
    };
    const relations = data.relations ?? [];

    return relations
      .map((relation, index) => ({ relation, index }))
      .filter(({ relation }) => relation.rel === 'AttachedFile' && relation.attributes?.name === filename)
      .map(({ index }) => index)
      .sort((a, b) => b - a)
      .map((index) => ({ op: 'remove' as const, path: `/relations/${index}` }));
  }

  async function attachReport(
    workItemId: number,
    fileBuffer: Buffer,
    filename: string,
  ): Promise<{ workItemUrl: string }> {
    const { organizationUrl, project, apiBaseUrl, authHeader } = requireConfig();

    const attachmentUrl = await uploadAttachment(
      apiBaseUrl,
      authHeader,
      fileBuffer,
      filename,
      workItemId,
    );
    const removeOps = await buildRemoveOpsForExistingAttachment(
      apiBaseUrl,
      authHeader,
      workItemId,
      filename,
    );

    const patchOps = [
      ...removeOps,
      {
        op: 'add' as const,
        path: '/relations/-',
        value: {
          rel: 'AttachedFile',
          url: attachmentUrl,
          attributes: { comment: 'Reporte QA (qa-evidence-reporter)' },
        },
      },
    ];

    let response: Response;
    try {
      response = await fetchImpl(
        `${apiBaseUrl}/_apis/wit/workitems/${workItemId}?api-version=${API_VERSION}`,
        {
          method: 'PATCH',
          headers: {
            Authorization: authHeader,
            Accept: 'application/json',
            'Content-Type': 'application/json-patch+json',
          },
          body: JSON.stringify(patchOps),
        },
      );
    } catch (error) {
      throw new AzureDevOpsRequestError('no se pudo conectar con Azure DevOps', { cause: error });
    }
    await assertOk(response, workItemId);

    return { workItemUrl: `${organizationUrl}/${encodeURIComponent(project)}/_workitems/edit/${workItemId}` };
  }

  async function addComment(workItemId: number, html: string): Promise<void> {
    const { apiBaseUrl, authHeader } = requireConfig();

    const url = `${apiBaseUrl}/_apis/wit/workItems/${workItemId}/comments?api-version=${COMMENTS_API_VERSION}`;

    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: 'POST',
        headers: {
          Authorization: authHeader,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text: html }),
      });
    } catch (error) {
      throw new AzureDevOpsRequestError('no se pudo conectar con Azure DevOps', { cause: error });
    }
    await assertOk(response, workItemId);
  }

  return { attachReport, addComment };
}

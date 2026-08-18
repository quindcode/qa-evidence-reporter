import {
  JiraAuthenticationError,
  JiraIssueNotFoundError,
  JiraNotConfiguredError,
  JiraRequestError,
} from '../types/errors.js';
import { QA_SUMMARY_COMMENT_MARKER } from './commentBuilder.js';
import type { AdfDocument } from './commentBuilder.js';

/**
 * Datos necesarios para hablar con un sitio Jira Cloud. `baseUrl`/`email`
 * vienen de `qa-config.json` → `jira` (`core/types/config.ts`); `apiToken`
 * viene SIEMPRE de la variable de entorno `JIRA_API_TOKEN`, nunca del
 * archivo de config — ver `adapters/server/context.ts`.
 */
export interface JiraClientConfig {
  baseUrl: string | null;
  email: string | null;
  apiToken: string | undefined;
}

export interface JiraClientDeps {
  /** Por defecto el `fetch` global (Node >=18, vía `undici`). Inyectable para tests con un fake. */
  fetchImpl?: typeof fetch;
}

export interface JiraClient {
  /**
   * Sube `fileBuffer` (nombrado `filename`) como adjunto de `issueKey` vía
   * la API REST v3 de Jira Cloud. Devuelve la URL del issue en el browser
   * (`{baseUrl}/browse/{issueKey}`) para que el caller pueda ofrecer un
   * link directo, no la URL de la API.
   *
   * ANTES de subir, busca los adjuntos que ya tiene `issueKey` y borra
   * (best-effort) los que se llamen igual que `filename` — así publicar
   * dos veces sobre el mismo issue REEMPLAZA el `.zip` anterior en vez de
   * ir acumulando copias con el mismo nombre.
   */
  attachReport(
    issueKey: string,
    fileBuffer: Buffer,
    filename: string,
  ): Promise<{ issueUrl: string }>;

  /**
   * Agrega `body` (ver `buildQaSummaryComment`, `core/jira/commentBuilder.ts`)
   * como un comentario nuevo de `issueKey` vía la API REST v3 de Jira Cloud.
   * Nunca toca el campo "Description" del issue, ni ningún comentario
   * escrito a mano por una persona del equipo.
   *
   * ANTES de publicar, busca los comentarios que ya tiene `issueKey` y borra
   * (best-effort) los que lleven el marcador `QA_SUMMARY_COMMENT_MARKER` —
   * o sea, los que generó esta misma herramienta en una publicación
   * anterior. Publicar dos veces sobre el mismo issue deja SOLO el
   * comentario más reciente (a propósito: un historial de resúmenes que se
   * acumulan es difuso y confunde en vez de ayudar — el `.zip` adjunto ya
   * tiene el mismo criterio de "el último reemplaza al anterior").
   */
  addComment(issueKey: string, body: AdfDocument): Promise<void>;
}

/**
 * Factory del cliente de Jira — mismo criterio que `createReportGenerator`
 * (`core/report/reportGenerator.ts`): una factory SIN I/O, que nunca lanza
 * al construirse aunque `config` esté incompleto. La validación de "¿está
 * esto realmente configurado?" ocurre recién dentro de `attachReport()`, la
 * primera vez que se necesita de verdad — así un server puede arrancar sin
 * Jira configurado sin que eso sea un error.
 */
export function createJiraClient(config: JiraClientConfig, deps: JiraClientDeps = {}): JiraClient {
  const fetchImpl = deps.fetchImpl ?? fetch;

  /**
   * Requiere `config` completo (lanza `JiraNotConfiguredError` si no) y
   * arma el header `Authorization: Basic` — chequeo/armado compartido por
   * `attachReport`/`addComment`, las dos únicas operaciones que hablan con
   * Jira.
   */
  function requireConfig(): { baseUrl: string; authHeader: string } {
    if (!config.baseUrl || !config.email || !config.apiToken) {
      throw new JiraNotConfiguredError();
    }
    const auth = Buffer.from(`${config.email}:${config.apiToken}`).toString('base64');
    return { baseUrl: config.baseUrl, authHeader: `Basic ${auth}` };
  }

  /**
   * Mismo mapeo de status HTTP a error de dominio para `attachReport` y
   * `addComment` (401/403 → autenticación, 404 → issue inexistente/sin
   * permiso, cualquier otro no-2xx → error genérico con el detalle que
   * devolvió Jira). No lanza si `response.ok`.
   */
  async function assertOk(response: Response, issueKey: string): Promise<void> {
    if (response.ok) return;
    if (response.status === 401 || response.status === 403) {
      throw new JiraAuthenticationError();
    }
    if (response.status === 404) {
      throw new JiraIssueNotFoundError(issueKey);
    }
    const bodyText = await response.text().catch(() => '');
    throw new JiraRequestError(`Jira respondió ${response.status}: ${bodyText || '(sin detalle)'}`);
  }

  /**
   * Busca los adjuntos que ya tiene `issueKey` (vía `GET .../issue/{issueKey}
   * ?fields=attachment`) y borra (best-effort) los que se llamen `filename`.
   * Lanza los mismos errores de dominio que el resto del cliente si la
   * BÚSQUEDA falla (401/403/404/etc — mismo caso que fallaría igual al
   * intentar subir el adjunto después). Un fallo al BORRAR un adjunto en
   * particular (permisos insuficientes sobre ESE adjunto, red) en cambio se
   * ignora en silencio: es mejor terminar con un `.zip` duplicado que
   * bloquear todo el publish por una limpieza que es secundaria.
   */
  async function deleteAttachmentsNamed(
    issueKey: string,
    filename: string,
    baseUrl: string,
    authHeader: string,
  ): Promise<void> {
    const listUrl = `${baseUrl}/rest/api/3/issue/${encodeURIComponent(issueKey)}?fields=attachment`;

    let listResponse: Response;
    try {
      listResponse = await fetchImpl(listUrl, {
        method: 'GET',
        headers: { Authorization: authHeader, Accept: 'application/json' },
      });
    } catch (error) {
      throw new JiraRequestError('no se pudo conectar con Jira', { cause: error });
    }
    await assertOk(listResponse, issueKey);

    const data = (await listResponse.json()) as {
      fields?: { attachment?: Array<{ id: string; filename: string }> };
    };
    const existing = data.fields?.attachment?.filter((attachment) => attachment.filename === filename) ?? [];

    for (const attachment of existing) {
      try {
        await fetchImpl(`${baseUrl}/rest/api/3/attachment/${attachment.id}`, {
          method: 'DELETE',
          headers: { Authorization: authHeader, Accept: 'application/json' },
        });
      } catch {
        // Best-effort — ver JSDoc de esta función.
      }
    }
  }

  /**
   * Busca los comentarios que ya tiene `issueKey` (vía `GET .../comment`,
   * paginado — Jira devuelve `{comments: [...]}`) y borra (best-effort) los
   * que contengan `QA_SUMMARY_COMMENT_MARKER` en su `body` — mismo criterio
   * que `deleteAttachmentsNamed` arriba, pero filtrando por marcador de
   * texto en vez de por nombre de archivo, porque un comentario no tiene un
   * identificador tan directo como `filename`. Se busca el marcador sobre
   * el JSON completo del `body` (ADF) en vez de intentar parsear su árbol —
   * el marcador es un string literal fijo, un `includes` sobre el
   * `JSON.stringify` alcanza y es mucho más simple que recorrer nodos ADF.
   *
   * Un fallo al BORRAR un comentario en particular se ignora en silencio,
   * mismo criterio que con los adjuntos: mejor terminar con un comentario
   * viejo que no se pudo borrar que bloquear el publish entero por una
   * limpieza secundaria.
   */
  async function deleteAutoGeneratedComments(
    issueKey: string,
    baseUrl: string,
    authHeader: string,
  ): Promise<void> {
    const listUrl = `${baseUrl}/rest/api/3/issue/${encodeURIComponent(issueKey)}/comment`;

    let listResponse: Response;
    try {
      listResponse = await fetchImpl(listUrl, {
        method: 'GET',
        headers: { Authorization: authHeader, Accept: 'application/json' },
      });
    } catch (error) {
      throw new JiraRequestError('no se pudo conectar con Jira', { cause: error });
    }
    await assertOk(listResponse, issueKey);

    const data = (await listResponse.json()) as { comments?: Array<{ id: string; body: unknown }> };
    const existing = (data.comments ?? []).filter((comment) =>
      JSON.stringify(comment.body).includes(QA_SUMMARY_COMMENT_MARKER),
    );

    for (const comment of existing) {
      try {
        await fetchImpl(`${baseUrl}/rest/api/3/issue/${encodeURIComponent(issueKey)}/comment/${comment.id}`, {
          method: 'DELETE',
          headers: { Authorization: authHeader, Accept: 'application/json' },
        });
      } catch {
        // Best-effort — ver JSDoc de esta función.
      }
    }
  }

  async function attachReport(
    issueKey: string,
    fileBuffer: Buffer,
    filename: string,
  ): Promise<{ issueUrl: string }> {
    const { baseUrl, authHeader } = requireConfig();
    await deleteAttachmentsNamed(issueKey, filename, baseUrl, authHeader);

    const url = `${baseUrl}/rest/api/3/issue/${encodeURIComponent(issueKey)}/attachments`;
    const formData = new FormData();
    formData.append('file', new Blob([fileBuffer]), filename);

    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: 'POST',
        headers: {
          Authorization: authHeader,
          Accept: 'application/json',
          // Requerido por Jira Cloud para requests que no vienen del propio
          // browser de Atlassian (protección XSRF) — sin este header, Jira
          // devuelve 403 aunque las credenciales sean correctas.
          'X-Atlassian-Token': 'no-check',
          // Deliberadamente SIN "Content-Type": `fetch` calcula el boundary
          // multipart correcto solo cuando el `body` es un `FormData` real y
          // nadie lo pisa a mano.
        },
        body: formData,
      });
    } catch (error) {
      throw new JiraRequestError('no se pudo conectar con Jira', { cause: error });
    }

    await assertOk(response, issueKey);

    return { issueUrl: `${baseUrl}/browse/${issueKey}` };
  }

  async function addComment(issueKey: string, body: AdfDocument): Promise<void> {
    const { baseUrl, authHeader } = requireConfig();
    await deleteAutoGeneratedComments(issueKey, baseUrl, authHeader);

    const url = `${baseUrl}/rest/api/3/issue/${encodeURIComponent(issueKey)}/comment`;

    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: 'POST',
        headers: {
          Authorization: authHeader,
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'X-Atlassian-Token': 'no-check',
        },
        body: JSON.stringify({ body }),
      });
    } catch (error) {
      throw new JiraRequestError('no se pudo conectar con Jira', { cause: error });
    }

    await assertOk(response, issueKey);
  }

  return { attachReport, addComment };
}

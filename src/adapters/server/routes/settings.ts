import { Router } from 'express';

import { asyncHandler, INVALID_REQUEST_BODY } from '../errors.js';
import { QaError } from '../../../core/types/errors.js';
import type { CoreServices } from '../services.js';
import type { SettingsPatch } from '../settingsService.js';

/**
 * `GET /api/settings` + `PATCH /api/settings` + `POST /api/settings/jira-token`
 * + `POST /api/settings/azure-token` — "settings desde el UI" (ver
 * `settingsService.ts` para la distinción no-secreto/secreto que motiva que
 * estas rutas existan y por qué el token nunca aparece en las dos primeras).
 *
 * No recibe `ServerContext` (a diferencia del resto de los routers de esta
 * carpeta): todo lo que necesita ya vive en `services.settingsService`, que
 * es la única fuente de verdad para settings vigentes desde que arrancó el
 * server (ver JSDoc de `ServerContext.config`).
 */
export function createSettingsRouter(services: CoreServices): Router {
  const router = Router();

  router.get(
    '/settings',
    asyncHandler(async (_req, res) => {
      res.json(services.settingsService.getPublicSettings());
    }),
  );

  router.patch(
    '/settings',
    asyncHandler(async (req, res) => {
      const patch = parseSettingsPatch(req.body);
      const settings = await services.settingsService.updateSettings(patch);
      res.json(settings);
    }),
  );

  router.post(
    '/settings/jira-token',
    asyncHandler(async (req, res) => {
      const token = parseTokenBody(req.body);
      services.settingsService.setJiraToken(token);
      res.json(services.settingsService.getPublicSettings());
    }),
  );

  router.post(
    '/settings/azure-token',
    asyncHandler(async (req, res) => {
      const token = parseTokenBody(req.body);
      services.settingsService.setAzureToken(token);
      res.json(services.settingsService.getPublicSettings());
    }),
  );

  return router;
}

/**
 * `null`/`""` limpia el token vigente (ver `SettingsService.setJiraToken`);
 * cualquier otro valor no-string es un body inválido. No hay un mínimo de
 * longitud a propósito: no es responsabilidad de este server juzgar el
 * formato de un token de Jira/Azure DevOps, eso lo termina validando la API
 * externa en el primer intento real de publicar.
 */
function parseTokenBody(body: unknown): string | null {
  const value = (body as { token?: unknown } | null)?.token;
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') {
    throw new QaError('El campo "token" debe ser un string (o null para limpiarlo).', INVALID_REQUEST_BODY);
  }
  return value;
}

function parseSettingsPatch(body: unknown): SettingsPatch {
  const raw = (body ?? {}) as Record<string, unknown>;
  const patch: SettingsPatch = {};

  if (raw.projectName !== undefined) {
    if (typeof raw.projectName !== 'string' || raw.projectName.trim().length === 0) {
      throw new QaError('"projectName" debe ser un string no vacío.', INVALID_REQUEST_BODY);
    }
    patch.projectName = raw.projectName;
  }

  if (raw.jira !== undefined) {
    patch.jira = parseNullableStringFields(raw.jira, ['baseUrl', 'email'], 'jira');
  }

  if (raw.azureDevOps !== undefined) {
    patch.azureDevOps = parseNullableStringFields(
      raw.azureDevOps,
      ['organizationUrl', 'project'],
      'azureDevOps',
    );
  }

  return patch;
}

/** Valida que `raw[field]` (para cada `field` en `fields`) sea `string | null | undefined` — la validación de FORMATO real (URL válida, email válido) la hace `QaConfigSchema` dentro de `SettingsService.updateSettings`, esto solo descarta tipos claramente equivocados (número, boolean, objeto) antes de llegar ahí. */
function parseNullableStringFields<K extends string>(
  raw: unknown,
  fields: readonly K[],
  groupName: string,
): Partial<Record<K, string | null>> {
  const source = (raw ?? {}) as Record<string, unknown>;
  const result: Partial<Record<K, string | null>> = {};

  for (const field of fields) {
    const value = source[field];
    if (value === undefined) continue;
    if (value !== null && typeof value !== 'string') {
      throw new QaError(`"${groupName}.${field}" debe ser un string o null.`, INVALID_REQUEST_BODY);
    }
    result[field] = value === '' ? null : value;
  }

  return result;
}

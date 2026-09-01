import { join } from 'node:path';

import { ZipArchive, type ArchiverError } from 'archiver';
import { Router } from 'express';

import { buildQaSummaryCommentHtml, createAzureDevOpsClient } from '../../../core/azureDevOps/index.js';
import { buildQaSummaryComment, createJiraClient } from '../../../core/jira/index.js';
import {
  createHandlebarsTemplateEngine,
  createReportGenerator,
} from '../../../core/report/index.js';
import { QaError } from '../../../core/types/errors.js';
import type { SessionState } from '../../../core/types/session.js';
import type { ServerContext } from '../context.js';
import {
  INVALID_REQUEST_BODY,
  NOTHING_TO_REPORT,
  NO_REPORT_GENERATED,
  asyncHandler,
} from '../errors.js';
import { pathExists } from '../fsUtils.js';
import { buildReportZipBuffer } from '../reportZip.js';
import { REPORTS_STATIC_PREFIX } from '../staticPrefixes.js';
import { loadCurrentSessionOrNull } from '../sessionQueries.js';
import type { CoreServices } from '../services.js';

/**
 * `POST /api/report/generate` + `GET /api/report/export-zip` +
 * `POST /api/report/publish-jira` + `POST /api/report/publish-azure-devops`.
 *
 * Decisión de diseño (`reportUrl` relativo): la respuesta de `generate`
 * nunca devuelve una ruta absoluta del filesystem del server (irrelevante e
 * inutilizable para la UI, que corre en el browser) — devuelve la ruta bajo
 * el prefijo estático `REPORTS_STATIC_PREFIX` (ver `app.ts`, donde se monta
 * `express.static(context.reportsDir)` bajo ese mismo prefijo), para que la
 * UI pueda armar un link tipo `<a href="{reportUrl}">` o cargarlo en un
 * `<iframe>` de previsualización sin conocer ninguna ruta de filesystem.
 */
export function createReportRouter(context: ServerContext, services: CoreServices): Router {
  const router = Router();

  router.post(
    '/report/generate',
    asyncHandler(async (req, res) => {
      const session = await loadCurrentSessionOrNull(services.sessionEngine);
      if (!session) {
        throw new QaError(
          'No hay ninguna sesión guardada — no hay nada que reportar todavía. Seleccioná ' +
            'features (POST /api/session/select) y ejecutá al menos un step antes de generar el reporte.',
          NOTHING_TO_REPORT,
        );
      }

      const featureId = resolveFeatureIdFromBody(req.body?.featureId, session);

      const templateEngine = createHandlebarsTemplateEngine(context.templateDir);
      const generator = createReportGenerator(
        {
          // `settingsService`, no `context.config`: el nombre de proyecto
          // puede haber cambiado en caliente desde que arrancó el server
          // (ver `PATCH /api/settings`) — ver JSDoc de `ServerContext.config`.
          projectName: services.settingsService.getPublicSettings().projectName,
          evidenceBaseDir: context.evidenceBaseDir,
          branding: {
            logoAbsolutePath: context.brandingLogoAbsolutePath,
            primaryColor: context.config.branding.primaryColor,
            accentColor: context.config.branding.accentColor,
            highlightColor: context.config.branding.highlightColor,
            ctaColor: context.config.branding.ctaColor,
          },
        },
        templateEngine,
      );

      await generator.generate(session, context.reportsDir, {
        featureIds: featureId ? [featureId] : undefined,
      });

      context.logger.info('Reporte generado desde el server', {
        outputDir: context.reportsDir,
        featureId: featureId ?? 'all',
      });
      res.status(201).json({
        reportUrl: `${REPORTS_STATIC_PREFIX}/index.html`,
        featureId: featureId ?? null,
      });
    }),
  );

  router.get(
    '/report/export-zip',
    asyncHandler(async (_req, res, next) => {
      const indexPath = join(context.reportsDir, 'index.html');
      if (!(await pathExists(indexPath))) {
        throw new QaError(
          'Todavía no se generó ningún reporte — llamá primero a "POST /api/report/generate".',
          NO_REPORT_GENERATED,
        );
      }

      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', 'attachment; filename="qa-report.zip"');

      // `archiver@8` reescribió su API a clases ESM con nombre
      // (`ZipArchive`/`TarArchive`/`JsonArchive`, todas extendiendo
      // `Archiver`) en vez de la factory clásica `archiver(format, options)`
      // documentada en versiones anteriores del paquete — no hay export
      // default ni `export =` en `@types/archiver@8`. `new ZipArchive()` es
      // el equivalente exacto para el caso `'zip'`.
      const archive = new ZipArchive();
      // Una vez que empezamos a streamear la respuesta, ya no podemos
      // convertir un error a un JSON `{ error: {...} }` limpio (los headers
      // y parte del body ya pueden estar escritos) — lo único razonable es
      // cortar la conexión y dejar constancia en el logger, en vez de
      // intentar reenviarlo al `errorHandler` central (pensado para errores
      // ANTES de empezar a escribir la respuesta).
      archive.on('error', (error: ArchiverError) => {
        context.logger.error('Error generando el ZIP del reporte', { error: error.message });
        res.destroy(error);
      });

      archive.pipe(res);
      archive.directory(context.reportsDir, false);
      await archive.finalize().catch(next);
    }),
  );

  router.post(
    '/report/publish-jira',
    asyncHandler(async (req, res) => {
      const issueKey = req.body?.issueKey;
      if (typeof issueKey !== 'string' || issueKey.trim().length === 0) {
        throw new QaError('El campo "issueKey" es obligatorio.', INVALID_REQUEST_BODY);
      }

      const indexPath = join(context.reportsDir, 'index.html');
      if (!(await pathExists(indexPath))) {
        throw new QaError(
          'Todavía no se generó ningún reporte — llamá primero a "POST /api/report/generate".',
          NO_REPORT_GENERATED,
        );
      }

      const trimmedIssueKey = issueKey.trim();
      const zipBuffer = await buildReportZipBuffer(context.reportsDir);
      // Construido al vuelo con las credenciales VIGENTES (ver JSDoc de
      // `CoreServices` en `services.ts`) — nunca una instancia guardada de
      // antes, que congelaría el token/baseUrl del momento del boot.
      const jiraClient = createJiraClient(services.settingsService.getJiraCredentials());
      const { issueUrl } = await jiraClient.attachReport(trimmedIssueKey, zipBuffer, 'qa-report.zip');

      // Sin sesión guardada (caso raro: se cerró después de generar el
      // reporte) no hay de dónde sacar el resumen de scenarios — el adjunto
      // ya subió, así que igual respondemos éxito, solo sin comentario. Si
      // SÍ hay sesión pero `addComment` falla (red, credenciales, etc.), el
      // error se propaga y el request completo falla, mismo criterio que
      // cualquier otro fallo de `attachReport`.
      const session = await loadCurrentSessionOrNull(services.sessionEngine);
      if (session) {
        // `featureId` (opcional, mismo campo que `POST /report/generate`):
        // el ZIP recién adjuntado ya está acotado al scope con el que se
        // generó por última vez `context.reportsDir` — este comentario debe
        // describir exactamente ESE mismo scope, no la sesión completa, o
        // el comentario terminaría mencionando features que el adjunto no
        // contiene.
        const featureId = resolveFeatureIdFromBody(req.body?.featureId, session);
        await jiraClient.addComment(
          trimmedIssueKey,
          buildQaSummaryComment(session, featureId ? [featureId] : undefined),
        );
      }

      context.logger.info('Reporte adjuntado a Jira', { issueKey: trimmedIssueKey });
      res.status(201).json({ issueKey: trimmedIssueKey, issueUrl });
    }),
  );

  router.post(
    '/report/publish-azure-devops',
    asyncHandler(async (req, res) => {
      const workItemId = parseWorkItemId(req.body?.workItemId);
      if (workItemId === null) {
        throw new QaError(
          'El campo "workItemId" es obligatorio y debe ser un número entero positivo.',
          INVALID_REQUEST_BODY,
        );
      }

      const indexPath = join(context.reportsDir, 'index.html');
      if (!(await pathExists(indexPath))) {
        throw new QaError(
          'Todavía no se generó ningún reporte — llamá primero a "POST /api/report/generate".',
          NO_REPORT_GENERATED,
        );
      }

      const zipBuffer = await buildReportZipBuffer(context.reportsDir);
      // Ver el comentario equivalente en "publish-jira": construido al
      // vuelo con las credenciales vigentes, nunca una instancia guardada.
      const azureDevOpsClient = createAzureDevOpsClient(services.settingsService.getAzureCredentials());
      const { workItemUrl } = await azureDevOpsClient.attachReport(
        workItemId,
        zipBuffer,
        'qa-report.zip',
      );

      // Mismo criterio que "publish-jira": sin sesión guardada, el adjunto
      // ya subió, así que igual respondemos éxito, solo sin comentario. Si
      // SÍ hay sesión pero `addComment` falla, el error se propaga y el
      // request completo falla, igual que cualquier otro fallo de
      // `attachReport`.
      const session = await loadCurrentSessionOrNull(services.sessionEngine);
      if (session) {
        // Ver el comentario equivalente en "publish-jira": el comentario
        // debe describir el mismo scope con el que se generó el ZIP recién
        // adjuntado, no la sesión completa.
        const featureId = resolveFeatureIdFromBody(req.body?.featureId, session);
        await azureDevOpsClient.addComment(
          workItemId,
          buildQaSummaryCommentHtml(session, featureId ? [featureId] : undefined),
        );
      }

      context.logger.info('Reporte adjuntado a Azure DevOps', { workItemId });
      res.status(201).json({ workItemId, workItemUrl });
    }),
  );

  return router;
}

/**
 * Resuelve el `featureId` opcional de un body (`generate`/`publish-jira`/
 * `publish-azure-devops`) — `undefined`/ausente significa "todas las
 * features" (comportamiento por defecto, sin cambios respecto a antes de
 * esta opción). Si viene un valor, debe ser un string no vacío que
 * coincida con el `id` de alguna feature de `session.selectedFeatures` — de
 * lo contrario lanza `INVALID_REQUEST_BODY`, mismo criterio que la
 * validación existente de `issueKey`/`workItemId`.
 */
function resolveFeatureIdFromBody(value: unknown, session: SessionState): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new QaError('El campo "featureId" debe ser un string no vacío.', INVALID_REQUEST_BODY);
  }

  const trimmed = value.trim();
  const exists = session.selectedFeatures.some((feature) => feature.id === trimmed);
  if (!exists) {
    throw new QaError(
      `"featureId" (${trimmed}) no coincide con ninguna feature seleccionada en la sesión actual.`,
      INVALID_REQUEST_BODY,
    );
  }
  return trimmed;
}

/** `null` si `value` no es un entero positivo válido (ni como `number` ni como `string` numérica) — nunca lanza. */
function parseWorkItemId(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.trim()) : NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

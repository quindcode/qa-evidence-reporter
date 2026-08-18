import { join } from 'node:path';

import { ZipArchive, type ArchiverError } from 'archiver';
import { Router } from 'express';

import { buildQaSummaryCommentHtml } from '../../../core/azureDevOps/index.js';
import { buildQaSummaryComment } from '../../../core/jira/index.js';
import {
  createHandlebarsTemplateEngine,
  createReportGenerator,
} from '../../../core/report/index.js';
import { QaError } from '../../../core/types/errors.js';
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
    asyncHandler(async (_req, res) => {
      const session = await loadCurrentSessionOrNull(services.sessionEngine);
      if (!session) {
        throw new QaError(
          'No hay ninguna sesión guardada — no hay nada que reportar todavía. Seleccioná ' +
            'features (POST /api/session/select) y ejecutá al menos un step antes de generar el reporte.',
          NOTHING_TO_REPORT,
        );
      }

      const templateEngine = createHandlebarsTemplateEngine(context.templateDir);
      const generator = createReportGenerator(
        {
          projectName: context.config.projectName,
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

      await generator.generate(session, context.reportsDir);

      context.logger.info('Reporte generado desde el server', { outputDir: context.reportsDir });
      res.status(201).json({ reportUrl: `${REPORTS_STATIC_PREFIX}/index.html` });
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
      const { issueUrl } = await services.jiraClient.attachReport(
        trimmedIssueKey,
        zipBuffer,
        'qa-report.zip',
      );

      // Sin sesión guardada (caso raro: se cerró después de generar el
      // reporte) no hay de dónde sacar el resumen de scenarios — el adjunto
      // ya subió, así que igual respondemos éxito, solo sin comentario. Si
      // SÍ hay sesión pero `addComment` falla (red, credenciales, etc.), el
      // error se propaga y el request completo falla, mismo criterio que
      // cualquier otro fallo de `attachReport`.
      const session = await loadCurrentSessionOrNull(services.sessionEngine);
      if (session) {
        await services.jiraClient.addComment(trimmedIssueKey, buildQaSummaryComment(session));
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
      const { workItemUrl } = await services.azureDevOpsClient.attachReport(
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
        await services.azureDevOpsClient.addComment(
          workItemId,
          buildQaSummaryCommentHtml(session),
        );
      }

      context.logger.info('Reporte adjuntado a Azure DevOps', { workItemId });
      res.status(201).json({ workItemId, workItemUrl });
    }),
  );

  return router;
}

/** `null` si `value` no es un entero positivo válido (ni como `number` ni como `string` numérica) — nunca lanza. */
function parseWorkItemId(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.trim()) : NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

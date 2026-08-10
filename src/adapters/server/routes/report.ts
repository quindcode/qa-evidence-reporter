import { join } from 'node:path';

import { ZipArchive, type ArchiverError } from 'archiver';
import { Router } from 'express';

import {
  createHandlebarsTemplateEngine,
  createReportGenerator,
} from '../../../core/report/index.js';
import { QaError } from '../../../core/types/errors.js';
import type { ServerContext } from '../context.js';
import { NOTHING_TO_REPORT, NO_REPORT_GENERATED, asyncHandler } from '../errors.js';
import { pathExists } from '../fsUtils.js';
import { REPORTS_STATIC_PREFIX } from '../staticPrefixes.js';
import { loadCurrentSessionOrNull } from '../sessionQueries.js';
import type { CoreServices } from '../services.js';

/**
 * `POST /api/report/generate` + `GET /api/report/export-zip`.
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
        { projectName: context.config.projectName, evidenceBaseDir: context.evidenceBaseDir },
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

  return router;
}

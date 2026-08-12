import { Router } from 'express';

import { QaError } from '../../../core/types/errors.js';
import type { ServerContext } from '../context.js';
import { NO_BRANDING_LOGO, asyncHandler } from '../errors.js';
import { pathExists } from '../fsUtils.js';

/**
 * `GET /branding/logo` — sirve el archivo de logo configurado en
 * `qa-config.json` → `branding.logoPath`, para que `src/ui/` (que no puede
 * importar `core/**`/leer el filesystem del proyecto directamente) pueda
 * mostrarlo con un `<img src="/branding/logo">` simple.
 *
 * Decisión de diseño (ruta dedicada, no `express.static` sobre la carpeta
 * `branding/`): a diferencia de `EVIDENCE_STATIC_PREFIX`/`REPORTS_STATIC_PREFIX`
 * (carpetas enteras cuyo contenido varía y se necesita listar/navegar),
 * acá hay UN solo archivo conocido de antemano — exponer toda la carpeta
 * que lo contiene como estática filtraría de más (cualquier otro archivo
 * que el QA guarde ahí quedaría accesible sin querer).
 *
 * No vive bajo `/api` (a diferencia de las rutas de `features`/`session`/
 * `report`): es un recurso estático (una imagen), no una respuesta JSON de
 * la API — mismo criterio que `EVIDENCE_STATIC_PREFIX`/`REPORTS_STATIC_PREFIX`,
 * que tampoco viven bajo `/api`.
 */
export function createBrandingRouter(context: ServerContext): Router {
  const router = Router();

  router.get(
    '/branding/logo',
    asyncHandler(async (_req, res) => {
      const logoPath = context.brandingLogoAbsolutePath;
      if (!logoPath || !(await pathExists(logoPath))) {
        throw new QaError('No hay ningún logo de marca configurado.', NO_BRANDING_LOGO);
      }

      res.sendFile(logoPath);
    }),
  );

  return router;
}

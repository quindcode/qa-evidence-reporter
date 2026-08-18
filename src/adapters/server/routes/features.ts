import { Router } from 'express';

import type { ServerContext } from '../context.js';
import { asyncHandler } from '../errors.js';
import { buildFeatureRefId, loadCurrentSessionOrNull } from '../sessionQueries.js';
import type { CoreServices } from '../services.js';

/**
 * `GET /api/features` — features encontradas en `featuresDir` + estado
 * (mínimo) de la sesión actual.
 *
 * Decisión de diseño (NO crea una sesión automáticamente): a diferencia de
 * la propuesta original de ARCHITECTURE.md ("crea sesión si no existe"), se
 * decidió que esta ruta sea de solo lectura — crear una sesión es una
 * decisión explícita del QA (qué features correr), que se hace vía
 * `POST /api/session/select`. Auto-crear una sesión con TODAS las features
 * en este GET no tendría sentido con el flujo real de "seleccionar qué
 * correr" que pide la UI (ver la consigna de esta fase). Este es el primer
 * punto donde esta fase se desvía deliberadamente de la lista original de
 * ARCHITECTURE.md — ver su sección "Fase 5a".
 *
 * Decisión de diseño (parseo en cada request, sin cache): las features
 * viven en disco (`.feature` que el QA puede seguir editando entre
 * requests) y el volumen esperado (decenas de archivos) hace que
 * re-parsear en cada `GET` sea imperceptible; se prefiere esto a inventar
 * un cache con invalidación que ARCHITECTURE.md no pidió.
 */
export function createFeaturesRouter(context: ServerContext, services: CoreServices): Router {
  const router = Router();

  router.get(
    '/features',
    asyncHandler(async (_req, res) => {
      const features = await services.gherkinParser.parseDirectory(context.featuresDir);
      const session = await loadCurrentSessionOrNull(services.sessionEngine);

      res.json({
        features: features.map((feature) => ({
          id: buildFeatureRefId(context.featuresDir, feature),
          name: feature.name,
          description: feature.description,
          tags: feature.tags,
          scenarioCount: feature.scenarios.length,
        })),
        session: session
          ? { exists: true, status: session.status, projectName: session.projectName }
          : { exists: false },
        projectName: context.config.projectName,
        branding: {
          // `logoUrl` es la ruta servida por `createBrandingRouter`
          // (`/branding/logo`, ver `routes/branding.ts`), NUNCA una ruta de
          // filesystem — `null` si no hay logo configurado, para que la UI
          // sepa de antemano si debe pedirlo (y no dispare un 404 esperable
          // al vuelo con cada carga).
          logoUrl: context.brandingLogoAbsolutePath ? '/branding/logo' : null,
          primaryColor: context.config.branding.primaryColor,
          accentColor: context.config.branding.accentColor,
          highlightColor: context.config.branding.highlightColor,
          ctaColor: context.config.branding.ctaColor,
        },
        // Solo el booleano derivado: `baseUrl`/`email` (ni el token, que
        // nunca está en `config` — ver `JiraConfigSchema`) se exponen a la
        // UI, no hacen falta para decidir si mostrar el botón "Adjuntar a
        // Jira" (ver `Runner.tsx`).
        jira: {
          enabled: Boolean(context.config.jira.baseUrl && context.config.jira.email),
        },
        // Mismo criterio que `jira` de arriba: solo el booleano derivado
        // (ni `organizationUrl`/`project` ni el PAT) se expone a la UI.
        azureDevOps: {
          enabled: Boolean(
            context.config.azureDevOps.organizationUrl && context.config.azureDevOps.project,
          ),
        },
      });
    }),
  );

  return router;
}

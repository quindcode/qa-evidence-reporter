import { existsSync } from 'node:fs';
import { join } from 'node:path';

import express, { type Express } from 'express';

import { createEvidenceStore } from '../../core/evidence/index.js';
import { createGherkinParser } from '../../core/parser/index.js';
import { createSessionEngine } from '../../core/session/index.js';
import type { ServerContext } from './context.js';
import { createErrorHandler } from './errors.js';
import { createBrandingRouter } from './routes/branding.js';
import { createFeaturesRouter } from './routes/features.js';
import { createReportRouter } from './routes/report.js';
import { createSessionRouter } from './routes/session.js';
import type { CoreServices } from './services.js';
import { EVIDENCE_STATIC_PREFIX, REPORTS_STATIC_PREFIX } from './staticPrefixes.js';
import { UI_DIST_DIR, UI_NOT_BUILT_PLACEHOLDER_HTML } from './uiPaths.js';

/**
 * Factory del server Express (adapter — importa de `core/**`, nunca al
 * revés, ver ARCHITECTURE.md "Regla de dependencia estricta"). No levanta
 * ningún puerto TCP (eso es `startServer`, en `index.ts`): `createApp`
 * devuelve el `Express` ya armado para que los tests de integración
 * (`app.test.ts`) puedan golpearlo con `supertest` sin un socket real.
 *
 * Decisión de diseño (`SessionEngine`/`EvidenceStore`/`GherkinParser`
 * construidos ACÁ, una sola vez, a partir de `context`, y no recibidos ya
 * construidos): mismo patrón que ya usan los comandos de `adapters/cli`
 * (`run.ts`/`report.ts` construyen sus propias instancias a partir de rutas
 * resueltas) — `ServerContext` solo lleva configuración y rutas (fácil de
 * armar en un test con directorios temporales), y es este módulo el único
 * responsable de decidir cómo ensamblarlas. Se construyen una única vez
 * (no por request) porque `SessionEngine` mantiene su estado en una closure
 * interna — ver JSDoc de `CoreServices` en `services.ts`.
 */
export function createApp(context: ServerContext): Express {
  const services: CoreServices = {
    gherkinParser: createGherkinParser({ logger: context.logger }),
    sessionEngine: createSessionEngine(context.sessionFilePath),
    evidenceStore: createEvidenceStore(context.evidenceBaseDir),
  };

  const app = express();
  app.use(express.json());

  app.use('/api', createFeaturesRouter(context, services));
  app.use('/api', createSessionRouter(context, services));
  app.use('/api', createReportRouter(context, services));
  app.use(createBrandingRouter(context));

  // Estáticos: evidencia ya adjuntada (previews sin base64) y el último
  // reporte generado (previsualización sin descargar el ZIP) — ver
  // `staticPrefixes.ts`. `evidenceBaseDir`/`reportsDir` pueden no existir
  // todavía en un proyecto recién inicializado sin sesión/reporte; eso no es
  // un problema para `express.static`, que simplemente responde 404 a
  // cualquier ruta bajo un prefijo cuyo directorio (o archivo) no exista.
  app.use(EVIDENCE_STATIC_PREFIX, express.static(context.evidenceBaseDir));
  app.use(REPORTS_STATIC_PREFIX, express.static(context.reportsDir));

  // SPA (`src/ui/`, fase 5b): si el build ya existe, se sirve como
  // estáticos + fallback de `index.html` para cualquier ruta no-API (rutas
  // de cliente de una SPA). Si todavía no existe (el caso normal durante
  // toda esta fase), se sirve el placeholder en vez de un 404/crash — ver
  // `uiPaths.ts`.
  const uiBuildExists = existsSync(join(UI_DIST_DIR, 'index.html'));
  if (uiBuildExists) {
    app.use(express.static(UI_DIST_DIR));
  }

  // Catch-all: cualquier request que llegó hasta aquí no matcheó ninguna
  // ruta de API ni ningún archivo estático. Para rutas de API bajo `/api`
  // que no existen, es un 404 JSON normal (no tiene sentido devolver HTML de
  // la SPA); para cualquier otra ruta, se asume navegación de la SPA (o,
  // mientras `ui/` no exista, simplemente `/`) y se responde el
  // `index.html` real o el placeholder.
  app.use((req, res) => {
    if (req.path.startsWith('/api/')) {
      res.status(404).json({
        error: { code: 'NOT_FOUND', message: `No existe la ruta "${req.method} ${req.path}".` },
      });
      return;
    }

    if (uiBuildExists) {
      res.sendFile(join(UI_DIST_DIR, 'index.html'));
      return;
    }

    res.status(200).type('html').send(UI_NOT_BUILT_PLACEHOLDER_HTML);
  });

  app.use(createErrorHandler(context.logger));

  return app;
}

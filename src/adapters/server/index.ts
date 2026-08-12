import type { Server } from 'node:http';

import type { Express } from 'express';
import open from 'open';

import { QaError } from '../../core/types/errors.js';
import { createApp } from './app.js';
import type { ServerContext } from './context.js';

/**
 * Cuántos puertos consecutivos probar a partir del configurado antes de
 * rendirse (ver `listenWithPortFallback`). 20 es un margen generoso para el
 * caso real que motivó esto (varios proyectos de QA corriendo a la vez en
 * la misma máquina, cada uno con su propio `qa-config.json` — ver
 * ARCHITECTURE.md, "Cambios registrados") sin ser un rango tan amplio como
 * para tardar en fallar de verdad si no hay NINGÚN puerto libre.
 */
const MAX_PORT_ATTEMPTS = 20;

/**
 * Intenta `app.listen(port)`, y si el puerto está ocupado (`EADDRINUSE`),
 * prueba `port + 1`, `port + 2`, ... hasta `MAX_PORT_ATTEMPTS` puertos
 * consecutivos, antes de rendirse con un `QaError` claro.
 *
 * Decisión de diseño (agregado tras feedback real de un usuario): antes,
 * `config.server.port` ocupado hacía fallar `run` con un `EADDRINUSE`
 * crudo de Node — obligaba a editar `qa-config.json` a mano cada vez que
 * dos proyectos coincidían en el mismo puerto default (`3000`). Mismo
 * criterio que usan Vite/Storybook/etc.: probar el siguiente puerto libre
 * automáticamente. `startServer` sigue imprimiendo la URL REAL (con el
 * puerto que terminó usando, no el configurado) — `run.ts` ya lo hace bien
 * porque usa `result.url`, no `context.config.server.port`.
 */
async function listenWithPortFallback(app: Express, startPort: number): Promise<Server> {
  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_PORT_ATTEMPTS; attempt++) {
    const candidatePort = startPort + attempt;
    try {
      return await new Promise<Server>((resolvePromise, rejectPromise) => {
        const instance = app.listen(candidatePort);
        instance.once('listening', () => resolvePromise(instance));
        instance.once('error', rejectPromise);
      });
    } catch (error) {
      const isPortInUse =
        error instanceof Error && (error as NodeJS.ErrnoException).code === 'EADDRINUSE';
      if (!isPortInUse) throw error;
      lastError = error;
    }
  }

  throw new QaError(
    `No se encontró ningún puerto libre entre ${startPort} y ${startPort + MAX_PORT_ATTEMPTS - 1} ` +
      `(probá liberar alguno, o cambiar "server.port" en "qa-config.json").`,
    'PORT_UNAVAILABLE',
    { cause: lastError },
  );
}

export { createApp } from './app.js';
export { buildServerContext } from './context.js';
export type { ServerContext, BuildServerContextDeps } from './context.js';

export interface StartServerResult {
  /** `http://localhost:{puerto}`, el puerto real en el que quedó escuchando (útil si `config.server.port` era `0`). */
  url: string;
  /** Cierra el servidor HTTP. Resuelve cuando terminó de cerrar todas las conexiones. */
  close: () => Promise<void>;
}

/**
 * Levanta `createApp(context)` en `config.server.port` y, si
 * `config.server.openBrowser` es `true`, abre el navegador con `open`
 * (paquete instalado desde fase 4 — ver ARCHITECTURE.md, "Cambios
 * registrados", fase 4: "queda instalada pero SIN USO todavía [...] eso es
 * fase 5"). Esta es esa fase: el primer punto real donde `openBrowser` tiene
 * efecto.
 *
 * Decisión de diseño (no conectado todavía a `qa-evidence-reporter run`):
 * conectar este server al comando CLI `run` (para que `run` levante el
 * server real en vez de solo imprimir un resumen, ver
 * `adapters/cli/commands/run.ts`) queda para fase 5b o un ajuste final — no
 * es bloqueante para esta fase (ver la consigna: "el foco es que el server
 * funcione de forma standalone y testeable"). `startServer` es
 * completamente usable hoy contra un `ServerContext` armado a mano o con
 * `buildServerContext`.
 *
 * Decisión de diseño (fallo al abrir el navegador no rompe el arranque): si
 * `open()` falla (p. ej. no hay ningún navegador/display disponible — el
 * caso típico de CI o de un contenedor sin entorno gráfico), se loguea como
 * `warn` y el servidor sigue arriba igual; fallar el arranque completo del
 * server por esto sería peor que simplemente no abrir el navegador.
 */
export async function startServer(context: ServerContext): Promise<StartServerResult> {
  const app = createApp(context);
  const server = await listenWithPortFallback(app, context.config.server.port);

  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : context.config.server.port;
  const url = `http://localhost:${port}`;

  context.logger.info('Server iniciado', { url });

  if (context.config.server.openBrowser) {
    try {
      await open(url);
    } catch (error) {
      context.logger.warn('No se pudo abrir el navegador automáticamente', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    url,
    close: () =>
      new Promise<void>((resolveClose, rejectClose) => {
        server.close((error) => {
          if (error) rejectClose(error);
          else resolveClose();
        });
      }),
  };
}

import { createServer, type Server } from 'node:net';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { QaConfigSchema } from '../../core/types/config.js';
import type { QaConfig } from '../../core/types/config.js';
import type { Logger } from '../../core/types/logger.js';
import { startServer } from './index.js';
import type { ServerContext } from './context.js';
import { DEFAULT_TEMPLATE_DIR } from './templatePaths.js';

const noopLogger: Logger = { debug() {}, info() {}, warn() {}, error() {} };

/** Ocupa `port` con un socket TCP crudo (no HTTP) — alcanza para que `EADDRINUSE` dispare igual. */
function occupyPort(port: number): Promise<Server> {
  return new Promise((resolvePromise, rejectPromise) => {
    const server = createServer();
    server.once('error', rejectPromise);
    server.listen(port, () => resolvePromise(server));
  });
}

function closeRawServer(server: Server): Promise<void> {
  return new Promise((resolvePromise) => server.close(() => resolvePromise()));
}

async function buildContext(projectRoot: string, port: number): Promise<ServerContext> {
  const featuresDir = join(projectRoot, 'features');
  await mkdir(featuresDir, { recursive: true });

  const config: QaConfig = QaConfigSchema.parse({
    projectName: 'Puerto ocupado',
    server: { port, openBrowser: false },
  });

  return {
    config,
    logger: noopLogger,
    projectRoot,
    sessionFilePath: join(projectRoot, '.qa-evidence-reporter', 'session.json'),
    featuresDir,
    evidenceBaseDir: join(projectRoot, 'evidence'),
    reportsDir: join(projectRoot, 'reports'),
    templateDir: DEFAULT_TEMPLATE_DIR,
    brandingLogoAbsolutePath: null,
    jiraApiToken: undefined,
    azureDevOpsPat: undefined,
  };
}

describe('startServer — fallback de puerto ocupado', () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'qa-startserver-'));
    await writeFile(join(projectRoot, 'qa-config.json'), '{}', 'utf-8');
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it('si el puerto configurado está ocupado, prueba el siguiente y arranca igual', async () => {
    const occupiedPort = 41230;
    const rawServer = await occupyPort(occupiedPort);

    try {
      const context = await buildContext(projectRoot, occupiedPort);
      const result = await startServer(context);

      try {
        expect(result.url).toBe(`http://localhost:${occupiedPort + 1}`);
      } finally {
        await result.close();
      }
    } finally {
      await closeRawServer(rawServer);
    }
  });

  it('si varios puertos consecutivos están ocupados, sigue probando hasta encontrar uno libre', async () => {
    const occupiedPort = 41240;
    const rawServers = await Promise.all([
      occupyPort(occupiedPort),
      occupyPort(occupiedPort + 1),
      occupyPort(occupiedPort + 2),
    ]);

    try {
      const context = await buildContext(projectRoot, occupiedPort);
      const result = await startServer(context);

      try {
        expect(result.url).toBe(`http://localhost:${occupiedPort + 3}`);
      } finally {
        await result.close();
      }
    } finally {
      await Promise.all(rawServers.map(closeRawServer));
    }
  });

  it('si el puerto configurado está libre, lo usa directamente (comportamiento sin cambios)', async () => {
    const context = await buildContext(projectRoot, 41250);
    const result = await startServer(context);

    try {
      expect(result.url).toBe('http://localhost:41250');
    } finally {
      await result.close();
    }
  });

  it('si NINGÚN puerto del rango está libre (20 consecutivos ocupados), lanza QaError PORT_UNAVAILABLE', async () => {
    const occupiedPort = 41300;
    const ports = Array.from({ length: 20 }, (_, i) => occupiedPort + i);
    const rawServers = await Promise.all(ports.map(occupyPort));

    try {
      const context = await buildContext(projectRoot, occupiedPort);
      await expect(startServer(context)).rejects.toMatchObject({ code: 'PORT_UNAVAILABLE' });
    } finally {
      await Promise.all(rawServers.map(closeRawServer));
    }
  });
});

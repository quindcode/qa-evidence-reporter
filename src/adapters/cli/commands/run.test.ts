import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createGherkinParser } from '../../../core/parser/index.js';
import { createSessionEngine } from '../../../core/session/index.js';
import { ConfigNotFoundError, QaError } from '../../../core/types/errors.js';
import type { Logger } from '../../../core/types/logger.js';
import type { ServerContext, StartServerResult } from '../../server/index.js';
import { runInit } from './init.js';
import { runRun } from './run.js';

const noopLogger: Logger = { debug() {}, info() {}, warn() {}, error() {} };

/** Config mínima válida, escrita a mano para no depender de `runInit` en tests que solo necesitan un `qa-config.json` cualquiera. */
async function writeMinimalConfig(cwd: string): Promise<void> {
  await writeFile(
    join(cwd, 'qa-config.json'),
    JSON.stringify({ projectName: 'Proyecto de prueba' }),
    'utf-8',
  );
}

/**
 * `startServer`/`waitForShutdownSignal` fake para tests: nunca abre un
 * puerto TCP real ni espera una señal de proceso real. `close` se registra
 * en un spy para poder verificar que se llamó tras la "señal" simulada.
 */
function fakeServerDeps(): {
  startServer: (context: ServerContext) => Promise<StartServerResult>;
  waitForShutdownSignal: () => Promise<NodeJS.Signals>;
  close: ReturnType<typeof vi.fn>;
  contexts: ServerContext[];
} {
  const close = vi.fn().mockResolvedValue(undefined);
  const contexts: ServerContext[] = [];
  const startServer = vi.fn(async (context: ServerContext): Promise<StartServerResult> => {
    contexts.push(context);
    return { url: 'http://localhost:3000', close };
  });
  const waitForShutdownSignal = vi.fn(async (): Promise<NodeJS.Signals> => 'SIGINT');
  return { startServer, waitForShutdownSignal, close, contexts };
}

describe('runRun', () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), 'qa-run-'));
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it('lanza ConfigNotFoundError si no existe qa-config.json (sugiere correr init)', async () => {
    await expect(runRun(cwd, { logger: noopLogger })).rejects.toBeInstanceOf(ConfigNotFoundError);
  });

  it('lanza un QaError claro si featuresDir no existe', async () => {
    await writeMinimalConfig(cwd);
    // No se crea "features/" a propósito.

    await expect(runRun(cwd, { logger: noopLogger })).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(QaError);
      expect((error as QaError).code).toBe('FEATURES_DIR_NOT_FOUND');
      return true;
    });
  });

  it('carga config + features, reporta que no hay sesión previa, y levanta el server', async () => {
    await runInit(cwd, {}, { print: () => {}, logger: noopLogger });
    const { startServer, waitForShutdownSignal } = fakeServerDeps();

    const result = await runRun(cwd, {
      logger: noopLogger,
      print: () => {},
      startServer,
      waitForShutdownSignal,
    });

    expect(result.config.projectName).toBeTruthy();
    expect(result.features).toHaveLength(1); // el feature de ejemplo de "init".
    expect(result.features[0].name).toContain('Ejemplo');
    expect(result.session).toBeNull();
    expect(result.url).toBe('http://localhost:3000');
    expect(startServer).toHaveBeenCalledTimes(1);
  });

  it('carga una sesión existente si ya hay una guardada en .qa-evidence-reporter/session.json', async () => {
    await runInit(cwd, {}, { print: () => {}, logger: noopLogger });

    const features = await createGherkinParser().parseDirectory(join(cwd, 'features'));
    const sessionFilePath = join(cwd, '.qa-evidence-reporter', 'session.json');
    const engine = createSessionEngine(sessionFilePath);
    const created = await engine.createSession(features, 'Proyecto de prueba');

    const { startServer, waitForShutdownSignal } = fakeServerDeps();
    const result = await runRun(cwd, {
      logger: noopLogger,
      print: () => {},
      startServer,
      waitForShutdownSignal,
    });

    expect(result.session).not.toBeNull();
    expect(result.session?.createdAt).toBe(created.createdAt);
    expect(result.session?.status).toBe('in_progress');
  });

  it('crea el directorio .qa-evidence-reporter/ si todavía no existe', async () => {
    await runInit(cwd, {}, { print: () => {}, logger: noopLogger });
    const { startServer, waitForShutdownSignal } = fakeServerDeps();

    await runRun(cwd, { logger: noopLogger, print: () => {}, startServer, waitForShutdownSignal });

    const dirStat = await stat(join(cwd, '.qa-evidence-reporter'));
    expect(dirStat.isDirectory()).toBe(true);
  });

  it('construye el ServerContext con las mismas rutas resueltas que usan run/report (evidenceDir, reportsDir, templateDir)', async () => {
    await runInit(cwd, {}, { print: () => {}, logger: noopLogger });
    const { startServer, waitForShutdownSignal, contexts } = fakeServerDeps();

    await runRun(cwd, { logger: noopLogger, print: () => {}, startServer, waitForShutdownSignal });

    expect(contexts).toHaveLength(1);
    const context = contexts[0];
    expect(context.projectRoot).toBe(cwd);
    expect(context.featuresDir).toBe(join(cwd, 'features'));
    expect(context.evidenceBaseDir).toBe(join(cwd, 'evidence'));
    expect(context.reportsDir).toBe(join(cwd, 'reports'));
    expect(context.sessionFilePath).toBe(join(cwd, '.qa-evidence-reporter', 'session.json'));
    expect(context.templateDir).toMatch(/templates[/\\]default$/);
  });

  it('imprime la URL del server para que el usuario la vea', async () => {
    await runInit(cwd, {}, { print: () => {}, logger: noopLogger });
    const { startServer, waitForShutdownSignal } = fakeServerDeps();
    const messages: string[] = [];

    await runRun(cwd, {
      logger: noopLogger,
      print: (message) => messages.push(message),
      startServer,
      waitForShutdownSignal,
    });

    expect(messages.some((message) => message.includes('http://localhost:3000'))).toBe(true);
  });

  it('espera la señal de apagado y cierra el server limpiamente antes de resolver', async () => {
    await runInit(cwd, {}, { print: () => {}, logger: noopLogger });
    const { startServer, waitForShutdownSignal, close } = fakeServerDeps();

    await runRun(cwd, { logger: noopLogger, print: () => {}, startServer, waitForShutdownSignal });

    expect(waitForShutdownSignal).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('usa startServer real de adapters/server por defecto (no requiere inyectarlo para funcionar)', async () => {
    await runInit(cwd, {}, { print: () => {}, logger: noopLogger });
    // Sin `startServer` inyectado, con un puerto fijo poco común (para evitar
    // colisiones con otros servicios locales) y `openBrowser: false` (no hay
    // entorno gráfico en CI) y `waitForShutdownSignal` inyectado para no
    // depender de una señal real de proceso: ejercita el `startServer` real
    // de punta a punta, incluyendo abrir un socket TCP real, sin bloquear el
    // test.
    await writeFile(
      join(cwd, 'qa-config.json'),
      JSON.stringify({
        projectName: 'Proyecto real',
        server: { port: 34_217, openBrowser: false },
      }),
      'utf-8',
    );

    const result = await runRun(cwd, {
      logger: noopLogger,
      print: () => {},
      waitForShutdownSignal: async () => 'SIGINT',
    });

    expect(result.url).toBe('http://localhost:34217');
  });
});

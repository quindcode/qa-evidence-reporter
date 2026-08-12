import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { QaError } from '../../../core/types/errors.js';
import type { Logger } from '../../../core/types/logger.js';
import { DEFAULT_BRANDING, DEFAULT_BRANDING_LOGO_PATH } from '../defaultBrandingPaths.js';
import { runInit } from './init.js';

/**
 * Logger no-op inyectado en TODOS los tests de este archivo. Sin esto,
 * `runInit` usaría por defecto `createLogger('info')` real (`core/logger`),
 * que arranca un worker thread de `pino-pretty` y ensucia la salida de los
 * tests con logs de verdad — nada de eso es lo que este archivo quiere
 * verificar (ver `logger.test.ts` de `core/logger` para los tests del
 * logger real).
 */
const noopLogger: Logger = { debug() {}, info() {}, warn() {}, error() {} };

describe('runInit', () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), 'qa-init-'));
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it('crea features/, evidence/, reports/ y un qa-config.json válido con los defaults documentados', async () => {
    const messages: string[] = [];
    const result = await runInit(
      cwd,
      {},
      { print: (message) => messages.push(message), logger: noopLogger },
    );

    const configRaw = await readFile(join(cwd, 'qa-config.json'), 'utf-8');
    const config = JSON.parse(configRaw) as Record<string, unknown>;

    expect(config).toMatchObject({
      projectName: basename(cwd),
      team: [],
      featuresDir: 'features',
      evidenceDir: 'evidence',
      reportsDir: 'reports',
      server: { port: 3000, openBrowser: true },
      evidence: {
        maxFileSizeMB: 50,
        allowedFormats: ['png', 'jpg', 'jpeg', 'gif', 'mp4', 'webm', 'pdf'],
      },
      logging: { level: 'info' },
      branding: {
        logoPath: 'branding/logo.png',
        ...DEFAULT_BRANDING,
      },
      reportTemplate: null,
    });

    // El logo estándar de Quind debe quedar copiado dentro del proyecto,
    // no solo referenciado — "run"/"report" leen branding.logoPath relativo
    // al proyecto, no a la instalación del paquete.
    const copiedLogo = await readFile(join(cwd, 'branding', 'logo.png'));
    const sourceLogo = await readFile(DEFAULT_BRANDING_LOGO_PATH);
    expect(copiedLogo.equals(sourceLogo)).toBe(true);

    // El feature de ejemplo debe ser Gherkin real (no un placeholder roto),
    // para que "run" tenga algo válido para parsear inmediatamente.
    const exampleFeature = await readFile(join(cwd, 'features', 'example.feature'), 'utf-8');
    expect(exampleFeature).toContain('Feature:');
    expect(exampleFeature).toContain('Scenario:');

    await expect(readFile(join(cwd, 'evidence', '.gitkeep'), 'utf-8')).resolves.toBe('');
    await expect(readFile(join(cwd, 'reports', '.gitkeep'), 'utf-8')).resolves.toBe('');

    expect(result.projectName).toBe(basename(cwd));
    expect(result.configFilePath).toBe(join(cwd, 'qa-config.json'));

    // Debe haber impreso próximos pasos accionables, no quedar en silencio.
    expect(messages.join('\n')).toMatch(/próximos pasos/i);
  });

  it('usa --name para el projectName en vez del nombre de la carpeta', async () => {
    const result = await runInit(
      cwd,
      { name: 'Checkout QA' },
      { print: () => {}, logger: noopLogger },
    );

    expect(result.projectName).toBe('Checkout QA');
    const config = JSON.parse(await readFile(join(cwd, 'qa-config.json'), 'utf-8')) as {
      projectName: string;
    };
    expect(config.projectName).toBe('Checkout QA');
  });

  it('no sobreescribe un qa-config.json existente sin --force', async () => {
    await writeFile(join(cwd, 'qa-config.json'), JSON.stringify({ projectName: 'Original' }));

    await expect(runInit(cwd, {}, { print: () => {}, logger: noopLogger })).rejects.toSatisfy(
      (error: unknown) => {
        expect(error).toBeInstanceOf(QaError);
        expect((error as QaError).code).toBe('CONFIG_ALREADY_EXISTS');
        return true;
      },
    );

    // No debe haber tocado el archivo existente.
    const config = JSON.parse(await readFile(join(cwd, 'qa-config.json'), 'utf-8')) as {
      projectName: string;
    };
    expect(config.projectName).toBe('Original');
    // Tampoco debe haber creado las carpetas: falla ANTES de escribir nada.
    await expect(readFile(join(cwd, 'features', 'example.feature'), 'utf-8')).rejects.toThrow();
  });

  it('sobreescribe qa-config.json cuando se pasa --force', async () => {
    await writeFile(join(cwd, 'qa-config.json'), JSON.stringify({ projectName: 'Original' }));
    await mkdir(join(cwd, 'features'), { recursive: true });

    const result = await runInit(
      cwd,
      { name: 'Nuevo Nombre', force: true },
      { print: () => {}, logger: noopLogger },
    );

    expect(result.projectName).toBe('Nuevo Nombre');
    const config = JSON.parse(await readFile(join(cwd, 'qa-config.json'), 'utf-8')) as {
      projectName: string;
    };
    expect(config.projectName).toBe('Nuevo Nombre');
  });
});

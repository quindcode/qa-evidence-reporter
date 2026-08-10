import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createGherkinParser } from '../../../core/parser/index.js';
import { createSessionEngine } from '../../../core/session/index.js';
import { QaError } from '../../../core/types/errors.js';
import type { Logger } from '../../../core/types/logger.js';
import { runInit } from './init.js';
import { runReport } from './report.js';

const noopLogger: Logger = { debug() {}, info() {}, warn() {}, error() {} };

describe('runReport', () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), 'qa-report-'));
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it('lanza un QaError claro (NOTHING_TO_REPORT) si no hay sesión guardada', async () => {
    await runInit(cwd, {}, { print: () => {}, logger: noopLogger });

    await expect(runReport(cwd, { logger: noopLogger })).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(QaError);
      expect((error as QaError).code).toBe('NOTHING_TO_REPORT');
      expect((error as QaError).message).toMatch(/run/);
      return true;
    });
  });

  it('propaga ConfigNotFoundError si ni siquiera hay qa-config.json', async () => {
    await expect(runReport(cwd, { logger: noopLogger })).rejects.toMatchObject({
      code: 'CONFIG_NOT_FOUND',
    });
  });

  it('flujo completo: init -> sesión con resultados -> genera un reporte HTML real', async () => {
    await runInit(cwd, { name: 'Proyecto E2E' }, { print: () => {}, logger: noopLogger });

    const features = await createGherkinParser().parseDirectory(join(cwd, 'features'));
    const sessionFilePath = join(cwd, '.qa-evidence-reporter', 'session.json');
    const engine = createSessionEngine(sessionFilePath);
    await engine.createSession(features, 'Proyecto E2E');

    // Marca todos los steps del primer (único) escenario del feature de
    // ejemplo: 2 en pass, el último en fail con su defecto obligatorio.
    let current = engine.getCurrentStep();
    while (current) {
      const isLast = current.step.id.endsWith('_st2');
      await engine.setStepResult(
        current.step.id,
        isLast ? 'fail' : 'pass',
        isLast ? { defectDescription: 'La sesión no persiste tras refrescar.' } : {},
      );
      const state = await engine.next();
      if (state.status === 'completed') break;
      current = engine.getCurrentStep();
    }

    const messages: string[] = [];
    const result = await runReport(cwd, {
      logger: noopLogger,
      print: (message) => messages.push(message),
    });

    expect(result.outputDir).toBe(join(cwd, 'reports'));
    expect(result.indexPath).toBe(join(cwd, 'reports', 'index.html'));

    const indexHtml = await readFile(result.indexPath, 'utf-8');
    expect(indexHtml).toContain('Proyecto E2E');
    // El dashboard debe reflejar al menos un fail (helper resultLabel -> "Fallido").
    expect(indexHtml).toContain('Fallido');

    const featureDetailFiles = await import('node:fs/promises').then((fs) =>
      fs.readdir(join(cwd, 'reports', 'features')),
    );
    expect(featureDetailFiles.length).toBeGreaterThan(0);

    const detailHtml = await readFile(
      join(cwd, 'reports', 'features', featureDetailFiles[0]),
      'utf-8',
    );
    expect(detailHtml).toContain('La sesión no persiste tras refrescar.');

    expect(messages.join('\n')).toMatch(/Reporte generado/i);
  });

  it('usa un templateDir custom cuando "reportTemplate" apunta a uno relativo al proyecto', async () => {
    await runInit(cwd, {}, { print: () => {}, logger: noopLogger });

    // Copia el template embebido a una carpeta del proyecto y lo referencia
    // desde qa-config.json, para probar la resolución de "reportTemplate"
    // relativa a cwd (ver `resolveTemplateDir` en `report.ts`).
    const { DEFAULT_TEMPLATE_DIR } = await import('../templatePaths.js');
    const { cp } = await import('node:fs/promises');
    await cp(DEFAULT_TEMPLATE_DIR, join(cwd, 'mi-template'), { recursive: true });

    const config = JSON.parse(await readFile(join(cwd, 'qa-config.json'), 'utf-8')) as Record<
      string,
      unknown
    >;
    config.reportTemplate = './mi-template';
    await writeFile(join(cwd, 'qa-config.json'), JSON.stringify(config), 'utf-8');

    const features = await createGherkinParser().parseDirectory(join(cwd, 'features'));
    const sessionFilePath = join(cwd, '.qa-evidence-reporter', 'session.json');
    await createSessionEngine(sessionFilePath).createSession(features, 'Proyecto de prueba');

    const result = await runReport(cwd, { logger: noopLogger, print: () => {} });
    const indexHtml = await readFile(result.indexPath, 'utf-8');
    expect(indexHtml.length).toBeGreaterThan(0);
  });
});

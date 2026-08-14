import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildReportZipBuffer } from './reportZip.js';

describe('buildReportZipBuffer', () => {
  let reportsDir: string;

  beforeEach(async () => {
    reportsDir = await mkdtemp(join(tmpdir(), 'qa-report-zip-'));
    await writeFile(join(reportsDir, 'index.html'), '<html>reporte</html>', 'utf-8');
    await mkdir(join(reportsDir, 'features'), { recursive: true });
    await writeFile(join(reportsDir, 'features', 'f0-login.html'), '<html>login</html>', 'utf-8');
  });

  afterEach(async () => {
    await rm(reportsDir, { recursive: true, force: true });
  });

  it('devuelve un Buffer no vacío con la firma ZIP ("PK")', async () => {
    const buffer = await buildReportZipBuffer(reportsDir);

    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.subarray(0, 2).toString('latin1')).toBe('PK');
  });

  it('incluye el contenido de reportsDir (nombres de archivo legibles en los bytes del zip)', async () => {
    const buffer = await buildReportZipBuffer(reportsDir);
    const asLatin1 = buffer.toString('latin1');

    // Los nombres de entrada de un zip (sin compresión de nombre) quedan
    // legibles tal cual dentro de los bytes del archivo central de
    // directorio — suficiente para confirmar que este archivo específico
    // quedó empaquetado, sin necesitar una librería de descompresión nueva.
    expect(asLatin1).toContain('index.html');
    expect(asLatin1).toContain('features/f0-login.html');
  });
});

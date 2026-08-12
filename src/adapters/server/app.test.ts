import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Jimp } from 'jimp';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { QaConfigSchema } from '../../core/types/config.js';
import type { QaConfig } from '../../core/types/config.js';
import type { Logger } from '../../core/types/logger.js';
import { createApp } from './app.js';
import type { ServerContext } from './context.js';
import { DEFAULT_TEMPLATE_DIR } from './templatePaths.js';
import { UI_DIST_DIR } from './uiPaths.js';

const noopLogger: Logger = { debug() {}, info() {}, warn() {}, error() {} };

const FEATURE_SOURCE = `Feature: Inicio de sesión
  Scenario: Login exitoso
    Given un usuario registrado
    When ingresa credenciales válidas
`;

async function makePngBuffer(sizeHint: 'small' | 'large' = 'small'): Promise<Buffer> {
  const size = sizeHint === 'small' ? 10 : 400;
  const image = new Jimp({ width: size, height: size, color: 0xff0000ff });
  return image.getBuffer('image/png');
}

async function buildContext(
  projectRoot: string,
  overrides: Partial<QaConfig> = {},
  brandingLogoAbsolutePath: string | null = null,
): Promise<ServerContext> {
  const featuresDir = join(projectRoot, 'features');
  const evidenceBaseDir = join(projectRoot, 'evidence');
  const reportsDir = join(projectRoot, 'reports');

  await mkdir(featuresDir, { recursive: true });
  await writeFile(join(featuresDir, 'login.feature'), FEATURE_SOURCE, 'utf-8');

  const config = QaConfigSchema.parse({
    projectName: 'Proyecto de prueba',
    ...overrides,
  });

  return {
    config,
    logger: noopLogger,
    projectRoot,
    sessionFilePath: join(projectRoot, '.qa-evidence-reporter', 'session.json'),
    featuresDir,
    evidenceBaseDir,
    reportsDir,
    templateDir: DEFAULT_TEMPLATE_DIR,
    brandingLogoAbsolutePath,
  };
}

describe('createApp (integración, sin puerto TCP real — ver Bash/curl para la prueba con socket real)', () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'qa-server-'));
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it('GET /api/features sin sesión previa: lista la feature y session.exists es false', async () => {
    const app = createApp(await buildContext(projectRoot));

    const response = await request(app).get('/api/features').expect(200);

    expect(response.body.features).toHaveLength(1);
    expect(response.body.features[0].id).toBe('login.feature');
    expect(response.body.features[0].name).toContain('Inicio de sesión');
    expect(response.body.session).toEqual({ exists: false });
    expect(response.body.projectName).toBe('Proyecto de prueba');
  });

  describe('branding', () => {
    it('GET /api/features sin branding configurado: todos los campos en null, logoUrl null', async () => {
      const app = createApp(await buildContext(projectRoot));

      const response = await request(app).get('/api/features').expect(200);

      expect(response.body.branding).toEqual({
        logoUrl: null,
        primaryColor: null,
        accentColor: null,
        highlightColor: null,
        ctaColor: null,
      });
    });

    it('GET /api/features con branding configurado: expone los colores y logoUrl apunta a /branding/logo', async () => {
      const logoPath = join(projectRoot, 'branding', 'logo.png');
      await mkdir(join(projectRoot, 'branding'), { recursive: true });
      await writeFile(logoPath, await makePngBuffer());

      const app = createApp(
        await buildContext(
          projectRoot,
          {
            branding: {
              logoPath: 'branding/logo.png',
              primaryColor: '#1e3543',
              accentColor: '#00c4e9',
              highlightColor: '#ffb91c',
              ctaColor: '#ff5530',
            },
          },
          logoPath,
        ),
      );

      const response = await request(app).get('/api/features').expect(200);

      expect(response.body.branding).toEqual({
        logoUrl: '/branding/logo',
        primaryColor: '#1e3543',
        accentColor: '#00c4e9',
        highlightColor: '#ffb91c',
        ctaColor: '#ff5530',
      });
    });

    it('GET /branding/logo sirve el archivo real cuando está configurado', async () => {
      const logoPath = join(projectRoot, 'branding', 'logo.png');
      await mkdir(join(projectRoot, 'branding'), { recursive: true });
      const logoBuffer = await makePngBuffer();
      await writeFile(logoPath, logoBuffer);

      const app = createApp(await buildContext(projectRoot, {}, logoPath));

      const response = await request(app).get('/branding/logo').expect(200);

      expect(response.headers['content-type']).toContain('image/png');
      expect(Buffer.compare(response.body as Buffer, logoBuffer)).toBe(0);
    });

    it('GET /branding/logo sin logo configurado -> 404 NO_BRANDING_LOGO', async () => {
      const app = createApp(await buildContext(projectRoot));

      const response = await request(app).get('/branding/logo').expect(404);

      expect(response.body.error.code).toBe('NO_BRANDING_LOGO');
    });

    it('GET /branding/logo con logoPath configurado pero el archivo no existe en disco -> 404 NO_BRANDING_LOGO', async () => {
      const app = createApp(
        await buildContext(projectRoot, {}, join(projectRoot, 'branding', 'no-existe.png')),
      );

      const response = await request(app).get('/branding/logo').expect(404);

      expect(response.body.error.code).toBe('NO_BRANDING_LOGO');
    });
  });

  it('GET / responde el placeholder (o la SPA real, si ya se corrió "npm run build:ui")', async () => {
    // `UI_DIST_DIR` (`uiPaths.ts`) es una ruta fija del paquete instalado,
    // NO inyectable vía `ServerContext` — no depende de `projectRoot`
    // (temporal, aislado por test) como el resto de este archivo. Desde
    // fase 5b, `dist/ui/index.html` existe de verdad después de `npm run
    // build`/`build:ui`, así que este test (escrito en fase 5a, cuando
    // `ui/` todavía no existía) ya no puede asumir un único resultado fijo
    // sin acoplarse al estado del filesystem global del repo en el momento
    // de correr `npm run test` — se verifica en cambio que la respuesta sea
    // CONSISTENTE con si ese build existe o no en este momento, que es
    // exactamente lo que decide `app.ts` (ver `uiBuildExists`).
    const app = createApp(await buildContext(projectRoot));

    const response = await request(app).get('/').expect(200);

    if (existsSync(join(UI_DIST_DIR, 'index.html'))) {
      expect(response.text).toContain('<div id="app">');
      expect(response.text).not.toContain('UI aún no construida');
    } else {
      expect(response.text).toContain('UI aún no construida');
    }
  });

  it('GET /api/session sin sesión previa responde 404 con SESSION_NOT_FOUND', async () => {
    const app = createApp(await buildContext(projectRoot));

    const response = await request(app).get('/api/session').expect(404);

    expect(response.body.error.code).toBe('SESSION_NOT_FOUND');
  });

  it('flujo completo: select -> evidencia -> resultado -> navigate -> report generate -> export-zip', async () => {
    const context = await buildContext(projectRoot);
    const app = createApp(context);

    // 1. Seleccionar la feature -> crea la sesión.
    const selectResponse = await request(app)
      .post('/api/session/select')
      .send({ featureIds: ['login.feature'] })
      .expect(201);
    expect(selectResponse.body.session.status).toBe('in_progress');
    const firstStepId: string = selectResponse.body.currentStep.step.id;

    // 2. GET /api/session refleja el step actual ya resuelto.
    const sessionResponse = await request(app).get('/api/session').expect(200);
    expect(sessionResponse.body.currentStep.step.id).toBe(firstStepId);
    expect(sessionResponse.body.currentStep.step.step.keyword).toBe('Given');

    // 3. Subir evidencia real para el step actual.
    const pngBuffer = await makePngBuffer();
    const evidenceResponse = await request(app)
      .post(`/api/session/step/${firstStepId}/evidence`)
      .attach('files', pngBuffer, 'captura.png')
      .expect(201);

    expect(evidenceResponse.body.evidenceFiles).toHaveLength(1);
    const evidenceFile = evidenceResponse.body.evidenceFiles[0];
    expect(evidenceFile.originalFilename).toBe('captura.png');
    expect(
      evidenceResponse.body.session.selectedFeatures[0].scenarios[0].steps[0].evidenceFileIds,
    ).toContain(evidenceFile.id);

    // El archivo debe quedar físicamente en evidenceBaseDir.
    const physicalPath = join(context.evidenceBaseDir, evidenceFile.path);
    expect(existsSync(physicalPath)).toBe(true);
    const onDisk = await readFile(physicalPath);
    expect(onDisk.length).toBe(pngBuffer.length);

    // 4. Marcar el primer step como pass.
    await request(app)
      .post(`/api/session/step/${firstStepId}/result`)
      .send({ result: 'pass' })
      .expect(200);

    // 5. Avanzar al siguiente step.
    const navigateResponse = await request(app)
      .post('/api/session/navigate')
      .send({ direction: 'next' })
      .expect(200);
    const secondStepId: string = navigateResponse.body.currentStep.step.id;
    expect(secondStepId).not.toBe(firstStepId);

    // 6. Marcar el segundo (y último) step como pass.
    await request(app)
      .post(`/api/session/step/${secondStepId}/result`)
      .send({ result: 'pass' })
      .expect(200);

    // 7. Avanzar de nuevo: no queda ningún step siguiente -> la sesión pasa a 'completed'.
    const completeResponse = await request(app)
      .post('/api/session/navigate')
      .send({ direction: 'next' })
      .expect(200);
    expect(completeResponse.body.session.status).toBe('completed');

    // 8. Generar el reporte.
    const generateResponse = await request(app).post('/api/report/generate').expect(201);
    expect(generateResponse.body.reportUrl).toBe('/reports-static/index.html');
    expect(existsSync(join(context.reportsDir, 'index.html'))).toBe(true);

    // El reporte también debe poder previsualizarse vía el estático montado,
    // y NUNCA cacheado (ver regresión dedicada más abajo).
    const previewResponse = await request(app).get('/reports-static/index.html').expect(200);
    expect(previewResponse.headers['cache-control']).toBe('no-store');

    // 9. Exportar el ZIP: verificar que el buffer es un ZIP válido (firma "PK").
    const zipResponse = await request(app)
      .get('/api/report/export-zip')
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      })
      .expect(200);

    expect(zipResponse.headers['content-disposition']).toContain('attachment');
    expect(zipResponse.headers['content-disposition']).toContain('qa-report.zip');
    const zipBuffer = zipResponse.body as Buffer;
    expect(zipBuffer.subarray(0, 2).toString('latin1')).toBe('PK');
  }, 15_000);

  it('DELETE evidencia la quita de la lista del step Y borra el archivo físico (+ thumbnail)', async () => {
    const context = await buildContext(projectRoot);
    const app = createApp(context);

    const selectResponse = await request(app)
      .post('/api/session/select')
      .send({ featureIds: ['login.feature'] })
      .expect(201);
    const stepId: string = selectResponse.body.currentStep.step.id;

    const pngBuffer = await makePngBuffer();
    const evidenceResponse = await request(app)
      .post(`/api/session/step/${stepId}/evidence`)
      .attach('files', pngBuffer, 'captura.png')
      .expect(201);
    const evidenceId: string = evidenceResponse.body.evidenceFiles[0].id;
    const physicalPath = join(context.evidenceBaseDir, evidenceResponse.body.evidenceFiles[0].path);
    const thumbnailPath = join(
      context.evidenceBaseDir,
      evidenceResponse.body.evidenceFiles[0].thumbnailPath,
    );
    expect(existsSync(physicalPath)).toBe(true);
    expect(existsSync(thumbnailPath)).toBe(true);

    const deleteResponse = await request(app)
      .delete(`/api/session/step/${stepId}/evidence/${evidenceId}`)
      .expect(200);

    expect(
      deleteResponse.body.session.selectedFeatures[0].scenarios[0].steps[0].evidenceFileIds,
    ).not.toContain(evidenceId);
    // Bug real reportado por un usuario probando la UI: el archivo (y su
    // thumbnail) deben desaparecer del disco, no solo de `session.json` —
    // de lo contrario `GET .../evidence` (que escanea el filesystem, ver
    // `EvidenceStore.list`) lo vuelve a mostrar como si nunca se hubiera
    // borrado.
    expect(existsSync(physicalPath)).toBe(false);
    expect(existsSync(thumbnailPath)).toBe(false);

    // Y no reaparece al refrescar la lista (el flujo real que la UI dispara tras un delete).
    const listAfterDelete = await request(app).get(`/api/session/step/${stepId}/evidence`).expect(200);
    expect(listAfterDelete.body.evidenceFiles).toEqual([]);

    // DELETE repetido sobre el mismo id (ya borrado) no debe fallar (idempotente).
    await request(app)
      .delete(`/api/session/step/${stepId}/evidence/${evidenceId}`)
      .expect(200);
  });

  it('GET evidencia de un step devuelve metadata completa (kind, thumbnailPath, sizeBytes)', async () => {
    const context = await buildContext(projectRoot);
    const app = createApp(context);

    const selectResponse = await request(app)
      .post('/api/session/select')
      .send({ featureIds: ['login.feature'] })
      .expect(201);
    const stepId: string = selectResponse.body.currentStep.step.id;

    const pngBuffer = await makePngBuffer();
    const uploadResponse = await request(app)
      .post(`/api/session/step/${stepId}/evidence`)
      .attach('files', pngBuffer, 'captura.png')
      .expect(201);
    const uploadedId: string = uploadResponse.body.evidenceFiles[0].id;

    const listResponse = await request(app).get(`/api/session/step/${stepId}/evidence`).expect(200);

    expect(listResponse.body.evidenceFiles).toHaveLength(1);
    const evidenceFile = listResponse.body.evidenceFiles[0];
    expect(evidenceFile.id).toBe(uploadedId);
    expect(evidenceFile.kind).toBe('image');
    expect(evidenceFile.originalFilename).toBe('captura.png');
    expect(typeof evidenceFile.thumbnailPath).toBe('string');
    expect(evidenceFile.sizeBytes).toBe(pngBuffer.length);
  });

  it('GET evidencia NO muestra archivos "huérfanos" de una sesión anterior cerrada y re-creada', async () => {
    // Bug real reportado por un usuario: cerrar una sesión y volver a
    // seleccionar la MISMA feature reproduce los mismos stepId
    // determinísticos (ver `core/session/ids.ts`) — si el step ya tenía
    // evidencia física en disco de la sesión anterior (nunca se borra, ver
    // `SessionEngine.close()`), `EvidenceStore.list()` la encuentra igual,
    // aunque la sesión NUEVA no la referencie en absoluto. Este endpoint
    // debe filtrar por `step.evidenceFileIds` (la fuente de verdad real),
    // igual que ya hace `reportGenerator.ts` — antes de este fix, no lo
    // hacía, y la evidencia vieja "reaparecía" en el runner.
    const app = createApp(await buildContext(projectRoot));

    const firstSelect = await request(app)
      .post('/api/session/select')
      .send({ featureIds: ['login.feature'] })
      .expect(201);
    const stepId: string = firstSelect.body.currentStep.step.id;

    await request(app)
      .post(`/api/session/step/${stepId}/evidence`)
      .attach('files', await makePngBuffer(), 'vieja.png')
      .expect(201);

    await request(app).post('/api/session/close').expect(200);
    await request(app)
      .post('/api/session/select')
      .send({ featureIds: ['login.feature'] })
      .expect(201);

    // Mismo stepId (misma feature, misma posición) — el archivo físico
    // "vieja.png" del paso anterior sigue en disco, pero la sesión nueva
    // no lo referencia.
    const listResponse = await request(app).get(`/api/session/step/${stepId}/evidence`).expect(200);
    expect(listResponse.body.evidenceFiles).toEqual([]);
  });

  it('GET evidencia de un stepId inexistente -> 400 INVALID_STEP_TRANSITION', async () => {
    const app = createApp(await buildContext(projectRoot));

    await request(app)
      .post('/api/session/select')
      .send({ featureIds: ['login.feature'] })
      .expect(201);

    const response = await request(app).get('/api/session/step/no-existe/evidence').expect(400);

    expect(response.body.error.code).toBe('INVALID_STEP_TRANSITION');
  });

  it('POST result "fail" sin defectDescription -> 400 con INVALID_STEP_TRANSITION', async () => {
    const app = createApp(await buildContext(projectRoot));

    const selectResponse = await request(app)
      .post('/api/session/select')
      .send({ featureIds: ['login.feature'] })
      .expect(201);
    const stepId: string = selectResponse.body.currentStep.step.id;

    const response = await request(app)
      .post(`/api/session/step/${stepId}/result`)
      .send({ result: 'fail' })
      .expect(400);

    expect(response.body.error.code).toBe('INVALID_STEP_TRANSITION');
    expect(response.body.error.message).toBeTruthy();
  });

  it('POST result "fail" con defectDescription funciona y queda registrado', async () => {
    const app = createApp(await buildContext(projectRoot));

    const selectResponse = await request(app)
      .post('/api/session/select')
      .send({ featureIds: ['login.feature'] })
      .expect(201);
    const stepId: string = selectResponse.body.currentStep.step.id;

    const response = await request(app)
      .post(`/api/session/step/${stepId}/result`)
      .send({ result: 'fail', defectDescription: 'El botón de login no responde.' })
      .expect(200);

    expect(response.body.session.selectedFeatures[0].scenarios[0].steps[0].result).toBe('fail');
    expect(response.body.session.selectedFeatures[0].scenarios[0].steps[0].defectDescription).toBe(
      'El botón de login no responde.',
    );
  });

  it('evidencia que excede evidence.maxFileSizeMB -> 413 EVIDENCE_FILE_TOO_LARGE', async () => {
    const context = await buildContext(projectRoot, {
      evidence: { maxFileSizeMB: 0.001, allowedFormats: ['png'] },
    });
    const app = createApp(context);

    const selectResponse = await request(app)
      .post('/api/session/select')
      .send({ featureIds: ['login.feature'] })
      .expect(201);
    const stepId: string = selectResponse.body.currentStep.step.id;

    const largeBuffer = await makePngBuffer('large');
    expect(largeBuffer.length).toBeGreaterThan(0.001 * 1024 * 1024);

    const response = await request(app)
      .post(`/api/session/step/${stepId}/evidence`)
      .attach('files', largeBuffer, 'grande.png')
      .expect(413);

    expect(response.body.error.code).toBe('EVIDENCE_FILE_TOO_LARGE');
  });

  it('evidencia con formato no permitido -> 415 UNSUPPORTED_EVIDENCE_FORMAT', async () => {
    const app = createApp(await buildContext(projectRoot));

    const selectResponse = await request(app)
      .post('/api/session/select')
      .send({ featureIds: ['login.feature'] })
      .expect(201);
    const stepId: string = selectResponse.body.currentStep.step.id;

    const response = await request(app)
      .post(`/api/session/step/${stepId}/evidence`)
      .attach('files', Buffer.from('contenido de texto plano'), 'notas.txt')
      .expect(415);

    expect(response.body.error.code).toBe('UNSUPPORTED_EVIDENCE_FORMAT');
  });

  it('POST /api/session/select sobre una sesión con progreso registrado sin ?force=true -> 409', async () => {
    // Regresión: el chequeo original usaba `status !== 'completed'`, no si
    // había progreso de verdad — ver JSDoc de `createSessionRouter` en
    // `routes/session.ts` para el incidente real que esto corrige. Acá se
    // marca un resultado real (no alcanza con solo crear la sesión) antes
    // de reintentar el select, para probar la condición real.
    const app = createApp(await buildContext(projectRoot));

    const selectResponse = await request(app)
      .post('/api/session/select')
      .send({ featureIds: ['login.feature'] })
      .expect(201);
    const stepId: string = selectResponse.body.currentStep.step.id;
    await request(app)
      .post(`/api/session/step/${stepId}/result`)
      .send({ result: 'pass' })
      .expect(200);

    const conflictResponse = await request(app)
      .post('/api/session/select')
      .send({ featureIds: ['login.feature'] })
      .expect(409);
    expect(conflictResponse.body.error.code).toBe('SESSION_ALREADY_IN_PROGRESS');

    await request(app)
      .post('/api/session/select?force=true')
      .send({ featureIds: ['login.feature'] })
      .expect(201);
  });

  it('POST /api/session/select sobre una sesión recién creada SIN progreso (todo pending) no exige ?force=true', async () => {
    // Complemento del test anterior: crear la sesión por sí sola no cuenta
    // como "progreso" (todos los steps quedan 'pending' hasta que alguien
    // marca algo) — reseleccionar antes de tocar nada es genuinamente
    // inofensivo, no debería pedir confirmación.
    const app = createApp(await buildContext(projectRoot));

    await request(app)
      .post('/api/session/select')
      .send({ featureIds: ['login.feature'] })
      .expect(201);

    await request(app)
      .post('/api/session/select')
      .send({ featureIds: ['login.feature'] })
      .expect(201);
  });

  it('POST /api/session/select sobre una sesión "completed" CON progreso (evidencia) sin ?force=true -> 409', async () => {
    // El incidente real: una sesión puede llegar a 'completed' con
    // evidencia ya adjunta y SIN que se haya generado un reporte todavía
    // (es el estado normal justo antes de generar el reporte). El chequeo
    // original permitía descartar esto sin pedir confirmación solo porque
    // `status === 'completed'`, perdiendo la evidencia de un usuario real.
    const app = createApp(await buildContext(projectRoot));

    const selectResponse = await request(app)
      .post('/api/session/select')
      .send({ featureIds: ['login.feature'] })
      .expect(201);
    const stepId: string = selectResponse.body.currentStep.step.id;

    await request(app)
      .post(`/api/session/step/${stepId}/evidence`)
      .attach('files', await makePngBuffer(), 'captura.png')
      .expect(201);

    // Navega hasta completar la sesión sin marcar más resultados (alcanza
    // con evidencia adjunta en un step para que cuente como "progreso").
    let status = 'in_progress';
    while (status !== 'completed') {
      const navResponse = await request(app)
        .post('/api/session/navigate')
        .send({ direction: 'next' })
        .expect(200);
      status = navResponse.body.session.status;
    }

    const conflictResponse = await request(app)
      .post('/api/session/select')
      .send({ featureIds: ['login.feature'] })
      .expect(409);
    expect(conflictResponse.body.error.code).toBe('SESSION_ALREADY_IN_PROGRESS');
  });

  it('POST /api/session/select sobre una sesión "completed" SIN progreso (navegada sin marcar nada) no exige ?force=true', async () => {
    const app = createApp(await buildContext(projectRoot));

    await request(app)
      .post('/api/session/select')
      .send({ featureIds: ['login.feature'] })
      .expect(201);

    let status = 'in_progress';
    while (status !== 'completed') {
      const navResponse = await request(app)
        .post('/api/session/navigate')
        .send({ direction: 'next' })
        .expect(200);
      status = navResponse.body.session.status;
    }

    await request(app)
      .post('/api/session/select')
      .send({ featureIds: ['login.feature'] })
      .expect(201);
  });

  it('POST /api/session/close cierra la sesión: después, select ya no exige ?force=true', async () => {
    const app = createApp(await buildContext(projectRoot));

    const selectResponse = await request(app)
      .post('/api/session/select')
      .send({ featureIds: ['login.feature'] })
      .expect(201);
    const stepId: string = selectResponse.body.currentStep.step.id;
    await request(app)
      .post(`/api/session/step/${stepId}/result`)
      .send({ result: 'pass' })
      .expect(200);

    await request(app).post('/api/session/close').expect(200);

    // Sin close(), esto daría 409 (hay progreso: el step marcado "pass").
    await request(app)
      .post('/api/session/select')
      .send({ featureIds: ['login.feature'] })
      .expect(201);
  });

  it('POST /api/session/close es no-op (200, no lanza) si no hay ninguna sesión', async () => {
    const app = createApp(await buildContext(projectRoot));

    await request(app).post('/api/session/close').expect(200);
  });

  it('POST /api/report/generate sin sesión guardada -> 404 NOTHING_TO_REPORT', async () => {
    const app = createApp(await buildContext(projectRoot));

    const response = await request(app).post('/api/report/generate').expect(404);

    expect(response.body.error.code).toBe('NOTHING_TO_REPORT');
  });

  it('GET /api/report/export-zip sin reporte generado -> 404 NO_REPORT_GENERATED', async () => {
    const app = createApp(await buildContext(projectRoot));

    const response = await request(app).get('/api/report/export-zip').expect(404);

    expect(response.body.error.code).toBe('NO_REPORT_GENERATED');
  });

  it('regenerar el reporte sobre la MISMA URL refleja notas/evidencia nuevas, sin caché de por medio', async () => {
    // Regresión real: un usuario reportó que, tras generar el reporte,
    // volver a la sesión, agregar evidencia/notas, y regenerar, "Ver
    // reporte" seguía mostrando la versión vieja. Se confirmó que el
    // archivo en disco SÍ se regeneraba bien (no era un bug de
    // ReportGenerator) — el problema era que `express.static` permitía
    // que el navegador cacheara `/reports-static/index.html`. Este test
    // ejercita exactamente el flujo reportado a nivel HTTP: generar,
    // cambiar notas, regenerar, pedir la MISMA URL de nuevo sin ningún
    // header de cache condicional propio (como haría un navegador con
    // Cache-Control: no-store) y confirmar que el contenido es el nuevo.
    const app = createApp(await buildContext(projectRoot));

    const selectResponse = await request(app)
      .post('/api/session/select')
      .send({ featureIds: ['login.feature'] })
      .expect(201);
    const stepId: string = selectResponse.body.currentStep.step.id;

    await request(app)
      .post(`/api/session/step/${stepId}/result`)
      .send({ result: 'pass', notes: 'version UNO' })
      .expect(200);
    await request(app).post('/api/report/generate').expect(201);

    const firstView = await request(app)
      .get('/reports-static/features/f0-inicio-de-sesion.html')
      .expect(200);
    expect(firstView.text).toContain('version UNO');
    expect(firstView.text).not.toContain('version DOS');

    await request(app)
      .post(`/api/session/step/${stepId}/result`)
      .send({ result: 'pass', notes: 'version DOS' })
      .expect(200);
    await request(app).post('/api/report/generate').expect(201);

    const secondView = await request(app)
      .get('/reports-static/features/f0-inicio-de-sesion.html')
      .expect(200);
    expect(secondView.headers['cache-control']).toBe('no-store');
    expect(secondView.text).toContain('version DOS');
    expect(secondView.text).not.toContain('version UNO');
  });
});

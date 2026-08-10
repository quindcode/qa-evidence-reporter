import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Jimp } from 'jimp';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../src/adapters/server/app.js';
import type { ServerContext } from '../src/adapters/server/context.js';
import { DEFAULT_TEMPLATE_DIR } from '../src/adapters/server/templatePaths.js';
import { createGherkinParser } from '../src/core/parser/index.js';
import { QaConfigSchema } from '../src/core/types/config.js';
import type { Logger } from '../src/core/types/logger.js';

/**
 * Test de integración end-to-end REAL (ver ARCHITECTURE.md, "Orden de
 * construcción", fase 6): parsea las features REALES de `sample-project/`
 * con `createGherkinParser` (sin mocks), ejercita el server REAL
 * (`createApp`, la misma factory que usa `adapters/cli/commands/run.ts` a
 * través de `startServer`) vía `supertest` — mismo patrón ya establecido en
 * `src/adapters/server/app.test.ts`, pero sobre las features reales del
 * sample project en vez de una feature de prueba mínima — y verifica el
 * reporte HTML y el ZIP exportado.
 *
 * Decisión de diseño (`supertest` contra `createApp()`, sin puerto TCP
 * real): igual criterio que `app.test.ts` (fase 5a) — `supertest` ejercita
 * el `Express` real de punta a punta (incluyendo multer, el error handler,
 * los estáticos) sin la fragilidad de un socket real en CI. La prueba de
 * "proceso real escuchando un puerto real" es responsabilidad de la
 * verificación manual del binario empaquetado (ver el reporte de esta
 * fase), no de este archivo.
 *
 * Decisión de diseño (verificación del ZIP con el binario `unzip` del
 * sistema, vía `child_process`): no hay ninguna dependencia de lectura de
 * ZIP en el proyecto (`archiver`, la única dependency de ZIP, solo puede
 * ESCRIBIR archivos). Se eligió `unzip -l`/`unzip -p` (el mismo binario y
 * las mismas flags ya usadas para la verificación manual de fase 5a, ver
 * ARCHITECTURE.md) en vez de agregar una devDependency nueva solo para
 * poder leer el `Buffer` recibido en el test.
 */
const __dirname = dirname(fileURLToPath(import.meta.url));
const SAMPLE_PROJECT_FEATURES_DIR = join(__dirname, '..', 'sample-project', 'features');

const noopLogger: Logger = { debug() {}, info() {}, warn() {}, error() {} };

async function makePngBuffer(color: number, size = 160): Promise<Buffer> {
  const image = new Jimp({ width: size, height: size, color });
  return image.getBuffer('image/png');
}

async function buildContext(workDir: string): Promise<ServerContext> {
  const config = QaConfigSchema.parse({ projectName: 'Tienda Online Quind — QA Manual (e2e)' });
  return {
    config,
    logger: noopLogger,
    projectRoot: workDir,
    sessionFilePath: join(workDir, '.qa-evidence-reporter', 'session.json'),
    featuresDir: SAMPLE_PROJECT_FEATURES_DIR,
    evidenceBaseDir: join(workDir, 'evidence'),
    reportsDir: join(workDir, 'reports'),
    templateDir: DEFAULT_TEMPLATE_DIR,
  };
}

describe('e2e: sample-project de punta a punta (parser real + server real + reporte + zip)', () => {
  let workDir: string;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'qa-e2e-'));
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it('createGherkinParser real parsea las 3 features del sample-project (español e inglés, Scenario Outline)', async () => {
    const parser = createGherkinParser({ logger: noopLogger });
    const features = await parser.parseDirectory(SAMPLE_PROJECT_FEATURES_DIR);

    expect(features.map((feature) => feature.name).sort()).toEqual(
      ['Carrito de compras', 'Inicio de sesión', 'Product search'].sort(),
    );

    const cart = features.find((feature) => feature.name === 'Carrito de compras')!;
    expect(cart.language).toBe('es');
    // El Esquema del escenario ("Aplicar un cupón...") tiene 2 filas de Ejemplos.
    expect(cart.scenarios.filter((scenario) => scenario.isOutlineExample)).toHaveLength(2);

    const search = features.find((feature) => feature.name === 'Product search')!;
    expect(search.language).toBe('en');
    expect(search.scenarios.filter((scenario) => scenario.isOutlineExample)).toHaveLength(3);

    const login = features.find((feature) => feature.name === 'Inicio de sesión')!;
    expect(login.tags).toEqual([]);
    expect(login.scenarios.map((scenario) => scenario.tags).flat()).toContain('@smoke');
  });

  it('flujo completo vía HTTP real: selección -> evidencia real -> resultados mixtos -> navegación -> reporte -> zip', async () => {
    const context = await buildContext(workDir);
    const app = createApp(context);

    // 1. GET /api/features expone las 3 features reales del sample-project.
    const featuresResponse = await request(app).get('/api/features').expect(200);
    const featureIds: string[] = featuresResponse.body.features.map(
      (feature: { id: string }) => feature.id,
    );
    expect(featureIds.sort()).toEqual(
      ['busqueda.feature', 'carrito-compras.feature', 'login.feature'].sort(),
    );
    expect(featuresResponse.body.session).toEqual({ exists: false });

    // 2. Seleccionar TODAS las features -> crea la sesión.
    const selectResponse = await request(app)
      .post('/api/session/select')
      .send({ featureIds })
      .expect(201);
    let session = selectResponse.body.session;
    let currentStep = selectResponse.body.currentStep;
    const firstStepId: string = currentStep.step.id;

    // 3. Adjuntar evidencia real (imagen PNG real, generada con Jimp — sin
    // mocks) al primer step.
    const evidenceBuffer = await makePngBuffer(0x1565c0ff);
    const evidenceResponse = await request(app)
      .post(`/api/session/step/${firstStepId}/evidence`)
      .attach('files', evidenceBuffer, 'pantalla-inicial.png')
      .expect(201);
    expect(evidenceResponse.body.evidenceFiles[0].kind).toBe('image');
    expect(typeof evidenceResponse.body.evidenceFiles[0].thumbnailPath).toBe('string');

    // 4. Recorrer TODOS los steps navegando "next", marcando una mezcla
    // real de pass/fail(con defecto)/skip, hasta completar la sesión.
    let stepCount = 0;
    let sawFail = false;
    let sawSkip = false;
    let defectText = '';

    while (session.status !== 'completed') {
      stepCount += 1;
      const stepId: string = currentStep.step.id;
      const result = stepCount % 7 === 0 ? 'skip' : stepCount % 5 === 0 ? 'fail' : 'pass';
      const body: { result: string; defectDescription?: string } = { result };
      if (result === 'fail') {
        defectText = `Defecto e2e #${stepCount}: comportamiento inesperado detectado en un step real del sample-project.`;
        body.defectDescription = defectText;
        sawFail = true;
      }
      if (result === 'skip') sawSkip = true;

      await request(app).post(`/api/session/step/${stepId}/result`).send(body).expect(200);

      const navigateResponse = await request(app)
        .post('/api/session/navigate')
        .send({ direction: 'next' })
        .expect(200);
      session = navigateResponse.body.session;
      currentStep = navigateResponse.body.currentStep;
    }

    expect(sawFail).toBe(true);
    expect(sawSkip).toBe(true);
    expect(session.status).toBe('completed');
    // Los 52 steps reales del sample-project (login: 13, busqueda: 17, carrito: 22).
    expect(stepCount).toBe(52);

    // 5. Navegación hacia atrás también funciona sobre una sesión completada.
    const previousResponse = await request(app)
      .post('/api/session/navigate')
      .send({ direction: 'previous' })
      .expect(200);
    expect(previousResponse.body.currentStep).not.toBeNull();
    await request(app).post('/api/session/navigate').send({ direction: 'next' }).expect(200);

    // 6. Generar el reporte HTML.
    const generateResponse = await request(app).post('/api/report/generate').expect(201);
    expect(generateResponse.body.reportUrl).toBe('/reports-static/index.html');
    await request(app).get('/reports-static/index.html').expect(200);

    // 7. Verificar el HTML generado en disco: dashboard con nombres reales
    // de features/scenarios, badges de estado, y el defecto de un step
    // fallido real.
    const indexHtml = await readFile(join(context.reportsDir, 'index.html'), 'utf-8');
    expect(indexHtml).toContain('Tienda Online Quind — QA Manual (e2e)');
    expect(indexHtml).toContain('Inicio de sesión');
    expect(indexHtml).toContain('Product search');
    expect(indexHtml).toContain('Carrito de compras');
    expect(indexHtml).toContain('qa-badge--fail');
    expect(indexHtml).toContain('Fallido');
    // Offline (re-confirmado sobre el reporte real del sample-project, ver
    // fase 3 para la verificación original): ningún `src`/`href` externo
    // (CDN de CSS/JS/fuentes). El SVG inline sí usa `xmlns="http://..."`
    // como namespace, que no es una carga de recurso externo — por eso se
    // busca específicamente `src=`/`href=` apuntando a `http(s)://`, no
    // cualquier substring `http`.
    expect(indexHtml).not.toMatch(/(?:src|href)=["']https?:\/\//);
    expect(indexHtml).not.toContain('cdn.');

    const featureDetailFiles = await readdir(join(context.reportsDir, 'features'));
    expect(featureDetailFiles).toHaveLength(3);
    let foundDefect = false;
    let foundEvidenceReference = false;
    for (const file of featureDetailFiles) {
      const html = await readFile(join(context.reportsDir, 'features', file), 'utf-8');
      expect(html).not.toMatch(/(?:src|href)=["']https?:\/\//);
      if (html.includes(defectText)) foundDefect = true;
      if (html.includes('pantalla-inicial')) foundEvidenceReference = true;
    }
    expect(foundDefect).toBe(true);
    expect(foundEvidenceReference).toBe(true);

    // 8. Exportar el ZIP y verificar que es un archivo válido con los
    // archivos esperados adentro (descomprimiéndolo de verdad).
    const zipResponse = await request(app)
      .get('/api/report/export-zip')
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      })
      .expect(200);
    const zipBuffer = zipResponse.body as Buffer;
    expect(zipBuffer.subarray(0, 2).toString('latin1')).toBe('PK');

    const zipPath = join(workDir, 'export.zip');
    await writeFile(zipPath, zipBuffer);

    const listing = execFileSync('unzip', ['-l', zipPath], { encoding: 'utf-8' });
    expect(listing).toContain('index.html');
    expect(listing).toContain('f0-product-search.html');
    expect(listing).toContain('f1-carrito-de-compras.html');
    expect(listing).toContain('f2-inicio-de-sesion.html');
    expect(listing).toContain('pantalla-inicial.png');

    const extractedIndexHtml = execFileSync('unzip', ['-p', zipPath, 'index.html'], {
      encoding: 'utf-8',
    });
    expect(extractedIndexHtml).toContain('Tienda Online Quind — QA Manual (e2e)');
  }, 20_000);

  it('permite pausar (cerrar) y retomar una sesión sin perder estado (SessionEngine.load() real)', async () => {
    const context = await buildContext(workDir);

    // "Sesión 1": se selecciona una feature, se avanza un paso y se sube evidencia.
    const app1 = createApp(context);
    const selectResponse = await request(app1)
      .post('/api/session/select')
      .send({ featureIds: ['login.feature'] })
      .expect(201);
    const firstStepId: string = selectResponse.body.currentStep.step.id;

    const evidenceBuffer = await makePngBuffer(0x2e7d32ff);
    await request(app1)
      .post(`/api/session/step/${firstStepId}/evidence`)
      .attach('files', evidenceBuffer, 'antes-de-cerrar.png')
      .expect(201);
    await request(app1)
      .post(`/api/session/step/${firstStepId}/result`)
      .send({ result: 'pass' })
      .expect(200);
    const navigateResponse = await request(app1)
      .post('/api/session/navigate')
      .send({ direction: 'next' })
      .expect(200);
    const secondStepId: string = navigateResponse.body.currentStep.step.id;

    // "Cerrar la sesión/navegador": se crea una instancia de `createApp`
    // completamente nueva (un `SessionEngine` fresco, sin nada en memoria)
    // sobre EL MISMO `sessionFilePath`/`evidenceBaseDir` — el mismo
    // `ServerContext` que usaría `qa-evidence-reporter run` si se volviera a
    // ejecutar sobre el mismo proyecto. Si el estado sobrevive, esto prueba
    // el autosave + `SessionEngine.load()` reales, no solo un mock.
    const app2 = createApp(context);

    const resumedResponse = await request(app2).get('/api/session').expect(200);
    expect(resumedResponse.body.session.status).toBe('in_progress');
    expect(resumedResponse.body.currentStep.step.id).toBe(secondStepId);
    const resumedFirstStep = resumedResponse.body.session.selectedFeatures[0].scenarios[0].steps[0];
    expect(resumedFirstStep.result).toBe('pass');
    expect(resumedFirstStep.evidenceFileIds).toHaveLength(1);

    // La evidencia adjuntada ANTES de "cerrar" sigue siendo consultable en la
    // sesión retomada, con su metadata completa.
    const evidenceListResponse = await request(app2)
      .get(`/api/session/step/${firstStepId}/evidence`)
      .expect(200);
    expect(evidenceListResponse.body.evidenceFiles).toHaveLength(1);
    expect(evidenceListResponse.body.evidenceFiles[0].originalFilename).toBe('antes-de-cerrar.png');
  });
});

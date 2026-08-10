#!/usr/bin/env node
/**
 * Simula una sesión completa de QA manual sobre `sample-project/` usando la
 * API HTTP REAL del server (`adapters/server`, fase 5) — exactamente los
 * mismos endpoints que consume la UI de `src/ui/`. No importa nada de
 * `core/**` directamente: todo pasa por `fetch` contra un `startServer` real,
 * igual que haría un navegador.
 *
 * Requiere que el paquete ya esté compilado (`npm run build` desde la raíz
 * del repo, que genera `dist/`) — este script importa el server compilado
 * desde `../dist/adapters/server/index.js`, no desde `src/`.
 *
 * Decisión de diseño (dónde queda la evidencia/sesión/reporte generados):
 * este script NUNCA escribe dentro de `sample-project/` (más allá de leer
 * sus `.feature` reales, de solo lectura). Cada corrida crea un directorio
 * de trabajo nuevo y aislado bajo el directorio temporal del sistema
 * (`os.tmpdir()/qa-evidence-reporter-sample-<random>/`), con su propio
 * `qa-config.json`, `.qa-evidence-reporter/session.json`, `evidence/` y
 * `reports/`. Así, correr este script muchas veces nunca ensucia el repo ni
 * dos corridas pueden pisarse entre sí. El `qa-config.json` de ese
 * directorio de trabajo apunta `featuresDir` con una ruta ABSOLUTA a
 * `sample-project/features` (en vez de relativa a `sample-project/`), así
 * que el resto de las rutas (`evidenceDir`/`reportsDir`, relativas) se
 * resuelven bajo el directorio de trabajo sin necesitar tocar
 * `buildServerContext`/`ServerContext` de ninguna forma especial.
 *
 * Uso: node sample-project/simulate-session.mjs
 */
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Jimp } from 'jimp';

import { buildServerContext, startServer } from '../dist/adapters/server/index.js';

const SAMPLE_PROJECT_DIR = dirname(fileURLToPath(import.meta.url));
const SERVER_PORT = 4610;

async function main() {
  console.log('=== qa-evidence-reporter — simulación de sesión sobre sample-project ===\n');

  const workDir = await mkdtemp(join(tmpdir(), 'qa-evidence-reporter-sample-'));
  console.log(`Directorio de trabajo (aislado, fuera de sample-project/): ${workDir}`);

  const realConfig = JSON.parse(
    await readFile(join(SAMPLE_PROJECT_DIR, 'qa-config.json'), 'utf-8'),
  );

  await writeFile(
    join(workDir, 'qa-config.json'),
    JSON.stringify(
      {
        projectName: realConfig.projectName,
        team: realConfig.team,
        // Ruta ABSOLUTA: no depende de cuál sea projectRoot (workDir) para
        // encontrar las features reales del sample project (ver nota de
        // diseño arriba).
        featuresDir: join(SAMPLE_PROJECT_DIR, 'features'),
        evidenceDir: 'evidence',
        reportsDir: 'reports',
        server: { port: SERVER_PORT, openBrowser: false },
        evidence: realConfig.evidence,
        logging: { level: 'warn' },
        reportTemplate: null,
      },
      null,
      2,
    ),
    'utf-8',
  );

  const context = await buildServerContext(workDir);
  const { url, close } = await startServer(context);
  console.log(`Server real levantado en ${url} (proyecto de features: sample-project/features)\n`);

  try {
    await runSimulation(url, workDir);
  } finally {
    await close();
    console.log('\nServer cerrado.');
  }
}

async function runSimulation(url, workDir) {
  // 1. Descubrir features disponibles y seleccionarlas TODAS.
  const featuresResponse = await fetchJson(`${url}/api/features`);
  const featureIds = featuresResponse.features.map((feature) => feature.id);
  console.log(`Features encontradas: ${featureIds.length}`);
  for (const feature of featuresResponse.features) {
    console.log(`  - [${feature.id}] ${feature.name} (${feature.scenarioCount} escenarios)`);
  }

  const selectResponse = await fetchJson(`${url}/api/session/select`, {
    method: 'POST',
    body: { featureIds },
  });
  console.log(`\nSesión creada. Total de steps a ejecutar en todos los scenarios seleccionados.\n`);

  // 2. Recorrer step a step, adjuntando evidencia real y marcando una mezcla
  // de pass/fail(+defecto)/skip, hasta que la sesión quede 'completed'.
  let session = selectResponse.session;
  let currentStep = selectResponse.currentStep;
  let stepCounter = 0;
  const tally = { pass: 0, fail: 0, skip: 0 };
  let attachedFailEvidence = false;
  let attachedSkipEvidence = false;

  while (session.status !== 'completed') {
    stepCounter += 1;
    const stepId = currentStep.step.id;
    const stepText = `${currentStep.step.step.keyword} ${currentStep.step.step.text}`;
    const result = pickResult(stepCounter);

    // Evidencia real: siempre en el primer step, y una vez más en el primer
    // step marcado 'fail' y en el primer 'skip' (documentando el "porqué").
    const needsEvidence =
      stepCounter === 1 ||
      (result === 'fail' && !attachedFailEvidence) ||
      (result === 'skip' && !attachedSkipEvidence);
    if (needsEvidence) {
      await attachEvidence(url, stepId, `${result}-step-${stepCounter}`, result);
      if (result === 'fail') attachedFailEvidence = true;
      if (result === 'skip') attachedSkipEvidence = true;
    }

    const resultBody = { result };
    if (result === 'fail') {
      resultBody.defectDescription =
        `Defecto simulado en el step #${stepCounter} ("${stepText}"): ` +
        'comportamiento inesperado detectado durante la sesión de ejemplo ' +
        '(dato generado por simulate-session.mjs, no un bug real).';
    }
    await fetchJson(`${url}/api/session/step/${stepId}/result`, {
      method: 'POST',
      body: resultBody,
    });
    tally[result] += 1;

    const navigateResponse = await fetchJson(`${url}/api/session/navigate`, {
      method: 'POST',
      body: { direction: 'next' },
    });
    session = navigateResponse.session;
    currentStep = navigateResponse.currentStep;
  }

  console.log(
    `Sesión completada: ${stepCounter} steps ejecutados ` +
      `(pass: ${tally.pass}, fail: ${tally.fail}, skip: ${tally.skip}).\n`,
  );

  // 3. Generar el reporte HTML y exportar el ZIP.
  const generateResponse = await fetchJson(`${url}/api/report/generate`, { method: 'POST' });
  console.log(`Reporte generado: ${url}${generateResponse.reportUrl}`);
  console.log(`  (en disco: ${join(workDir, 'reports', 'index.html')})`);

  const zipResponse = await fetch(`${url}/api/report/export-zip`);
  if (!zipResponse.ok) {
    throw new Error(`No se pudo exportar el ZIP: HTTP ${zipResponse.status}`);
  }
  const zipBuffer = Buffer.from(await zipResponse.arrayBuffer());
  const zipPath = join(workDir, 'qa-report.zip');
  await mkdir(workDir, { recursive: true });
  await writeFile(zipPath, zipBuffer);
  console.log(`ZIP exportado (${zipBuffer.length} bytes): ${zipPath}`);

  console.log('\n=== Resumen ===');
  console.log(`Proyecto: ${session.projectName}`);
  console.log(`Features ejecutadas: ${featureIds.length}`);
  console.log(
    `Steps: ${stepCounter} (pass: ${tally.pass}, fail: ${tally.fail}, skip: ${tally.skip})`,
  );
  console.log(`Reporte HTML: ${join(workDir, 'reports', 'index.html')}`);
  console.log(`ZIP: ${zipPath}`);
  console.log(`Directorio de trabajo completo: ${workDir}`);
  console.log(
    '\nAbrí el reporte con tu navegador (file://) o con un servidor estático — es ' +
      'auto-contenido y funciona offline, sin depender de este server.',
  );
}

/** Genera una imagen PNG real (Jimp, sin binarios nativos) y la sube como evidencia del step. */
async function attachEvidence(url, stepId, label, kind) {
  const colorByKind = { pass: 0x2e7d32ff, fail: 0xc62828ff, skip: 0xf9a825ff };
  const image = new Jimp({ width: 320, height: 200, color: colorByKind[kind] ?? 0x455a64ff });
  const buffer = await image.getBuffer('image/png');

  const formData = new FormData();
  formData.append('files', new Blob([buffer], { type: 'image/png' }), `${label}.png`);

  const response = await fetch(`${url}/api/session/step/${stepId}/evidence`, {
    method: 'POST',
    body: formData,
  });
  if (!response.ok) {
    throw new Error(`No se pudo subir evidencia para el step ${stepId}: HTTP ${response.status}`);
  }
  const body = await response.json();
  console.log(
    `  Evidencia adjuntada (${label}.png) al step ${stepId} -> ${body.evidenceFiles[0].path}`,
  );
}

/** Mezcla determinística de resultados: mayoría 'pass', 'fail' cada 5 steps, 'skip' cada 7. */
function pickResult(stepCounter) {
  if (stepCounter % 7 === 0) return 'skip';
  if (stepCounter % 5 === 0) return 'fail';
  return 'pass';
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    method: options.method ?? 'GET',
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const body = await response.json().catch(() => undefined);
  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status} en ${url}: ${body?.error?.message ?? JSON.stringify(body)}`,
    );
  }
  return body;
}

main().catch((error) => {
  console.error('\nLa simulación falló:', error);
  process.exitCode = 1;
});

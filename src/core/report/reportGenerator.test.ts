import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Jimp } from 'jimp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createEvidenceStore } from '../evidence/index.js';
import { createSessionEngine } from '../session/index.js';
import { ReportGenerationError } from '../types/errors.js';
import type { ParsedFeature } from '../types/parser.js';
import type { EvidenceFile } from '../types/evidence.js';
import type { SessionState } from '../types/session.js';
import { createHandlebarsTemplateEngine } from './templateEngine.js';
import { createReportGenerator, pickReadableTextColor } from './reportGenerator.js';

/** Carpeta real de templates del paquete (`templates/default`), usada tal cual la usaría el CLI en fases futuras. */
const DEFAULT_TEMPLATE_DIR = fileURLToPath(new URL('../../../templates/default', import.meta.url));

const FIXED_GENERATED_AT = '2026-01-15T10:00:00.000Z';

/** PNG sintético de 10x10, igual approach que `evidenceStore.test.ts`. */
async function makePngBuffer(): Promise<Buffer> {
  const image = new Jimp({ width: 10, height: 10, color: 0x2266ffff });
  return image.getBuffer('image/png');
}

/**
 * Dos features con evidencia e íconos de resultado mezclados (pass/fail/skip),
 * suficiente para probar el pipeline completo evidence → session → report:
 * - "Login" / "Successful login": step 0 en pass (con evidencia de imagen),
 *   step 1 en skip.
 * - "Checkout" / "Pay with card": step 0 en pass, step 1 en fail (con
 *   defectDescription y evidencia de imagen) — así el HTML de detalle de
 *   "Checkout" debe mostrar tanto el defecto resaltado como una evidencia.
 */
function makeFeatures(): ParsedFeature[] {
  return [
    {
      name: 'Login',
      description: '',
      tags: [],
      language: 'en',
      filePath: 'login.feature',
      scenarios: [
        {
          name: 'Successful login',
          tags: [],
          isOutlineExample: false,
          steps: [
            { keyword: 'Given', text: 'a registered user', fromBackground: false },
            { keyword: 'When', text: 'they submit valid credentials', fromBackground: false },
          ],
        },
      ],
    },
    {
      name: 'Checkout',
      description: '',
      tags: [],
      language: 'en',
      filePath: 'checkout.feature',
      scenarios: [
        {
          name: 'Pay with card',
          tags: [],
          isOutlineExample: false,
          steps: [
            { keyword: 'Given', text: 'items in the cart', fromBackground: false },
            { keyword: 'When', text: 'they submit a valid card', fromBackground: false },
          ],
        },
      ],
    },
  ];
}

describe('createReportGenerator + createHandlebarsTemplateEngine (integración con evidence/session reales)', () => {
  let workDir: string;
  let evidenceBaseDir: string;
  let outputDir: string;
  let sessionState: SessionState;
  let loginEvidence: EvidenceFile;
  let defectEvidence: EvidenceFile;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'qa-report-'));
    evidenceBaseDir = join(workDir, 'project');
    outputDir = join(workDir, 'reports', 'latest');

    const sessionEngine = createSessionEngine(
      join(evidenceBaseDir, '.qa-evidence-reporter/session.json'),
    );
    const created = await sessionEngine.createSession(makeFeatures(), 'Proyecto Demo');

    const loginStep0 = created.selectedFeatures[0]!.scenarios[0]!.steps[0]!;
    const loginStep1 = created.selectedFeatures[0]!.scenarios[0]!.steps[1]!;
    const checkoutStep0 = created.selectedFeatures[1]!.scenarios[0]!.steps[0]!;
    const checkoutStep1 = created.selectedFeatures[1]!.scenarios[0]!.steps[1]!;
    const checkoutFeatureId = created.selectedFeatures[1]!.id;
    const checkoutScenarioId = created.selectedFeatures[1]!.scenarios[0]!.id;
    const loginFeatureId = created.selectedFeatures[0]!.id;
    const loginScenarioId = created.selectedFeatures[0]!.scenarios[0]!.id;

    // Evidencia real, guardada con el EvidenceStore de fase 2 (integración
    // real evidence → report, no un mock de archivos).
    const evidenceStore = createEvidenceStore(evidenceBaseDir);
    loginEvidence = await evidenceStore.save({
      featureId: loginFeatureId,
      scenarioId: loginScenarioId,
      stepId: loginStep0.id,
      originalFilename: 'login-ok.png',
      buffer: await makePngBuffer(),
    });
    defectEvidence = await evidenceStore.save({
      featureId: checkoutFeatureId,
      scenarioId: checkoutScenarioId,
      stepId: checkoutStep1.id,
      originalFilename: 'boton-roto.png',
      buffer: await makePngBuffer(),
    });

    await sessionEngine.setStepResult(loginStep0.id, 'pass');
    await sessionEngine.addEvidence(loginStep0.id, loginEvidence.id);
    await sessionEngine.setStepResult(loginStep1.id, 'skip');
    await sessionEngine.setStepResult(checkoutStep0.id, 'pass');
    await sessionEngine.setStepResult(checkoutStep1.id, 'fail', {
      defectDescription: 'El botón de pago no responde al hacer click.',
    });
    await sessionEngine.addEvidence(checkoutStep1.id, defectEvidence.id);

    sessionState = sessionEngine.getState();
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it('genera index.html y features/{slug}.html para cada feature', async () => {
    const templateEngine = createHandlebarsTemplateEngine(DEFAULT_TEMPLATE_DIR);
    const generator = createReportGenerator(
      { projectName: 'Proyecto Demo', evidenceBaseDir },
      templateEngine,
      { clock: () => FIXED_GENERATED_AT },
    );

    await generator.generate(sessionState, outputDir);

    expect(existsSync(join(outputDir, 'index.html'))).toBe(true);
    for (const feature of sessionState.selectedFeatures) {
      expect(existsSync(join(outputDir, 'features', `${feature.id}.html`))).toBe(true);
    }
  });

  it('una corrida posterior con menos features seleccionadas borra las páginas de detalle huérfanas de la corrida anterior', async () => {
    const templateEngine = createHandlebarsTemplateEngine(DEFAULT_TEMPLATE_DIR);
    const generator = createReportGenerator(
      { projectName: 'Proyecto Demo', evidenceBaseDir },
      templateEngine,
      { clock: () => FIXED_GENERATED_AT },
    );

    // Primera corrida: Login + Checkout seleccionados (sessionState del
    // beforeEach) -> genera ambas páginas de detalle.
    await generator.generate(sessionState, outputDir);
    expect(existsSync(join(outputDir, 'features', 'f0-login.html'))).toBe(true);
    expect(existsSync(join(outputDir, 'features', 'f1-checkout.html'))).toBe(true);
    expect(existsSync(join(outputDir, 'assets', loginEvidence.path))).toBe(true);

    // Segunda corrida: sesión nueva con SOLO Login seleccionado (como pasa
    // al volver a `run` con una selección más chica que la sesión previa).
    // Antes de este fix, `f1-checkout.html` y la evidencia de Checkout
    // sobrevivían en `outputDir` — ver Priority Issue P0 de
    // /impeccable critique: dos versiones del reporte conviviendo en el
    // mismo directorio entregable.
    const narrowerSessionEngine = createSessionEngine(
      join(evidenceBaseDir, '.qa-evidence-reporter/session-2.json'),
    );
    const narrowerSession = await narrowerSessionEngine.createSession(
      [makeFeatures()[0]!],
      'Proyecto Demo',
    );

    await generator.generate(narrowerSession, outputDir);

    expect(existsSync(join(outputDir, 'features', 'f0-login.html'))).toBe(true);
    expect(existsSync(join(outputDir, 'features', 'f1-checkout.html'))).toBe(false);
    expect(existsSync(join(outputDir, 'assets', defectEvidence.path))).toBe(false);

    const indexHtml = await readFile(join(outputDir, 'index.html'), 'utf-8');
    expect(indexHtml).not.toContain('Checkout');
  });

  it('el dashboard y el detalle de feature ofrecen un link "Ver primer fallo" al primer scenario fallido, y no aparece donde no hay fallos', async () => {
    const templateEngine = createHandlebarsTemplateEngine(DEFAULT_TEMPLATE_DIR);
    const generator = createReportGenerator(
      { projectName: 'Proyecto Demo', evidenceBaseDir },
      templateEngine,
      { clock: () => FIXED_GENERATED_AT },
    );
    await generator.generate(sessionState, outputDir);

    // Checkout es el único feature con un fallo (ver beforeEach:
    // checkoutStep1 en 'fail'), en su único scenario.
    const checkoutScenarioId = sessionState.selectedFeatures[1]!.scenarios[0]!.id;
    const expectedAnchor = `scenario-${checkoutScenarioId}`;

    const indexHtml = await readFile(join(outputDir, 'index.html'), 'utf-8');
    expect(indexHtml).toContain(
      `class="qa-jump-to-failure" href="features/f1-checkout.html#${expectedAnchor}"`,
    );

    const checkoutHtml = await readFile(join(outputDir, 'features', 'f1-checkout.html'), 'utf-8');
    expect(checkoutHtml).toContain(`id="${expectedAnchor}"`);
    expect(checkoutHtml).toContain(`class="qa-jump-to-failure" href="#${expectedAnchor}"`);

    // Login no tiene ningún fallo -> sin link "Ver primer fallo" en su página
    // (la clase SÍ aparece en el <style> embebido de toda página, ver
    // styles.hbs — se busca el <a> real, no el nombre de la clase).
    const loginHtml = await readFile(join(outputDir, 'features', 'f0-login.html'), 'utf-8');
    expect(loginHtml).not.toContain('class="qa-jump-to-failure"');
  });

  it('el index.html muestra los nombres de feature, badges de resultado y % correcto', async () => {
    const templateEngine = createHandlebarsTemplateEngine(DEFAULT_TEMPLATE_DIR);
    const generator = createReportGenerator(
      { projectName: 'Proyecto Demo', evidenceBaseDir },
      templateEngine,
      { clock: () => FIXED_GENERATED_AT },
    );
    await generator.generate(sessionState, outputDir);

    const indexHtml = await readFile(join(outputDir, 'index.html'), 'utf-8');

    expect(indexHtml).toContain('Proyecto Demo');
    expect(indexHtml).toContain('Login');
    expect(indexHtml).toContain('Checkout');
    // Métrica a nivel SCENARIO, no de steps (ver nota de diseño en
    // `buildReportData`): el único scenario de "Login" tiene 1 step pass y 1
    // skip -> deriva a "skip" completo (0% de éxito para esa feature); el
    // único scenario de "Checkout" tiene 1 pass y 1 fail -> deriva a "fail"
    // (0% también). Ninguno de los 2 scenarios de la sesión terminó "pass"
    // -> 0% global, aunque a nivel de steps sueltos hubiera 2 pass de 4.
    expect(indexHtml).toContain('<p class="qa-hero__number">0<span>%</span></p>');
    // Ambas features muestran "0/1 scenarios" en su fila — si el conteo
    // siguiera siendo por steps, Login mostraría "1/2" (su step en pass sí
    // cuenta ahí), no "0/1".
    expect(indexHtml).toContain('<span class="qa-feature-row__count">0/1 scenarios</span>');
    expect(indexHtml).toMatch(/qa-badge--fail/);
    expect(indexHtml).toContain('features/f0-login.html');
    expect(indexHtml).toContain('features/f1-checkout.html');
  });

  it('el detalle de Checkout muestra el badge fail, la descripción del defecto resaltada y la evidencia copiada', async () => {
    const templateEngine = createHandlebarsTemplateEngine(DEFAULT_TEMPLATE_DIR);
    const generator = createReportGenerator(
      { projectName: 'Proyecto Demo', evidenceBaseDir },
      templateEngine,
      { clock: () => FIXED_GENERATED_AT },
    );
    await generator.generate(sessionState, outputDir);

    const checkoutHtml = await readFile(join(outputDir, 'features', 'f1-checkout.html'), 'utf-8');

    expect(checkoutHtml).toContain('Pay with card');
    expect(checkoutHtml).toMatch(/qa-badge--fail/);
    expect(checkoutHtml).toContain('El botón de pago no responde al hacer click.');
    expect(checkoutHtml).toMatch(/class="qa-defect"/);

    // La evidencia referenciada aparece en el HTML con una ruta relativa
    // (basePath '../' porque esta página vive en outputDir/features/).
    const expectedEvidenceHref = `../assets/${defectEvidence.path}`;
    expect(checkoutHtml).toContain(expectedEvidenceHref);

    // Y existe físicamente copiada dentro de outputDir/assets/...
    expect(existsSync(join(outputDir, 'assets', defectEvidence.path))).toBe(true);
    expect(existsSync(join(outputDir, 'assets', defectEvidence.thumbnailPath!))).toBe(true);
  });

  it('el detalle de Login muestra la evidencia de imagen del step en pass', async () => {
    const templateEngine = createHandlebarsTemplateEngine(DEFAULT_TEMPLATE_DIR);
    const generator = createReportGenerator(
      { projectName: 'Proyecto Demo', evidenceBaseDir },
      templateEngine,
      { clock: () => FIXED_GENERATED_AT },
    );
    await generator.generate(sessionState, outputDir);

    const loginHtml = await readFile(join(outputDir, 'features', 'f0-login.html'), 'utf-8');
    expect(loginHtml).toContain('login-ok.png');
    expect(existsSync(join(outputDir, 'assets', loginEvidence.path))).toBe(true);
  });

  it('no genera ninguna referencia http(s):// ni a CDNs externos en el HTML generado', async () => {
    const templateEngine = createHandlebarsTemplateEngine(DEFAULT_TEMPLATE_DIR);
    const generator = createReportGenerator(
      { projectName: 'Proyecto Demo', evidenceBaseDir },
      templateEngine,
      { clock: () => FIXED_GENERATED_AT },
    );
    await generator.generate(sessionState, outputDir);

    const indexHtml = await readFile(join(outputDir, 'index.html'), 'utf-8');
    const checkoutHtml = await readFile(join(outputDir, 'features', 'f1-checkout.html'), 'utf-8');

    for (const html of [indexHtml, checkoutHtml]) {
      // El namespace XML del SVG (`xmlns="http://www.w3.org/2000/svg"`) es
      // una declaración estática, no una petición de red — se descarta antes
      // de buscar URLs externas reales (`<script src="http...">`,
      // `<link href="http...">`, etc.).
      const withoutSvgNamespace = html.replace(/xmlns="http:\/\/www\.w3\.org\/2000\/svg"/g, '');
      expect(withoutSvgNamespace).not.toMatch(/https?:\/\//i);
      expect(html.toLowerCase()).not.toContain('cdn.');
    }
  });

  it('los SVG del dashboard (donut y barra de progreso) tienen CSS que los hace responsivos', async () => {
    // Regresión: charts.ts genera los SVG con width/height fijos en px (ver
    // su JSDoc). Sin un override de CSS que los deje escalar dentro de su
    // contenedor, en pantallas angostas la barra de progreso (480px) se sale
    // del .qa-card del dashboard — bug real reportado por un usuario.
    const templateEngine = createHandlebarsTemplateEngine(DEFAULT_TEMPLATE_DIR);
    const generator = createReportGenerator(
      { projectName: 'Proyecto Demo', evidenceBaseDir },
      templateEngine,
      { clock: () => FIXED_GENERATED_AT },
    );
    await generator.generate(sessionState, outputDir);

    const indexHtml = await readFile(join(outputDir, 'index.html'), 'utf-8');
    expect(indexHtml).toMatch(/\.qa-hero\s+svg\s*\{[^}]*max-width:\s*100%/);
  });

  describe('branding', () => {
    it('sin branding configurado, el header es el neutro de siempre (sin .qa-brandbar)', async () => {
      const templateEngine = createHandlebarsTemplateEngine(DEFAULT_TEMPLATE_DIR);
      const generator = createReportGenerator(
        { projectName: 'Proyecto Demo', evidenceBaseDir },
        templateEngine,
        { clock: () => FIXED_GENERATED_AT },
      );
      await generator.generate(sessionState, outputDir);

      const indexHtml = await readFile(join(outputDir, 'index.html'), 'utf-8');
      expect(indexHtml).toContain('class="qa-topbar"');
      expect(indexHtml).not.toContain('qa-brandbar');
      expect(existsSync(join(outputDir, 'assets', 'branding'))).toBe(false);
    });

    it('con logo + colores configurados, copia el logo y renderiza el header de marca en index y en feature-detail', async () => {
      const logoPath = join(workDir, 'logo.png');
      await writeFile(logoPath, await makePngBuffer());

      const templateEngine = createHandlebarsTemplateEngine(DEFAULT_TEMPLATE_DIR);
      const generator = createReportGenerator(
        {
          projectName: 'Proyecto Demo',
          evidenceBaseDir,
          branding: {
            logoAbsolutePath: logoPath,
            primaryColor: '#1e3543',
            accentColor: '#00c4e9',
            highlightColor: '#ffb91c',
            ctaColor: '#ff5530',
          },
        },
        templateEngine,
        { clock: () => FIXED_GENERATED_AT },
      );
      await generator.generate(sessionState, outputDir);

      expect(existsSync(join(outputDir, 'assets', 'branding', 'logo.png'))).toBe(true);

      const indexHtml = await readFile(join(outputDir, 'index.html'), 'utf-8');
      expect(indexHtml).toContain('class="qa-brandbar"');
      expect(indexHtml).not.toContain('class="qa-topbar"');
      expect(indexHtml).toContain('src="assets/branding/logo.png"');
      expect(indexHtml).toContain('background: #1e3543;');
      // Navy es oscuro → el texto legible sobre esa franja es blanco (ver `pickReadableTextColor`).
      expect(indexHtml).toContain('color: #ffffff;');
      expect(indexHtml).toContain('--qa-link: #00c4e9 !important;');
      expect(indexHtml).toMatch(/linear-gradient\(\s*90deg,\s*#00c4e9,\s*#ffb91c,\s*#ff5530/);

      const featureHtml = await readFile(
        join(outputDir, 'features', 'f0-login.html'),
        'utf-8',
      );
      expect(featureHtml).toContain('class="qa-brandbar"');
      // Un nivel más abajo (`basePath = '../'`): el logo se referencia con ese prefijo.
      expect(featureHtml).toContain('src="../assets/branding/logo.png"');
    });

    it('con un logoPath configurado que no existe en disco, no falla generate() — sigue sin logo (best-effort)', async () => {
      const templateEngine = createHandlebarsTemplateEngine(DEFAULT_TEMPLATE_DIR);
      const generator = createReportGenerator(
        {
          projectName: 'Proyecto Demo',
          evidenceBaseDir,
          branding: {
            logoAbsolutePath: join(workDir, 'no-existe.png'),
            primaryColor: '#1e3543',
          },
        },
        templateEngine,
        { clock: () => FIXED_GENERATED_AT },
      );

      await expect(generator.generate(sessionState, outputDir)).resolves.toBeUndefined();

      const indexHtml = await readFile(join(outputDir, 'index.html'), 'utf-8');
      expect(indexHtml).toContain('class="qa-brandbar"'); // isBranded=true igual (primaryColor sí está configurado)
      expect(indexHtml).not.toContain('<img class="qa-brand-logo"');
    });

    it('nunca toca los colores semánticos de resultado (pass/fail/skip/pending) aunque haya branding configurado', async () => {
      const templateEngine = createHandlebarsTemplateEngine(DEFAULT_TEMPLATE_DIR);
      const generator = createReportGenerator(
        {
          projectName: 'Proyecto Demo',
          evidenceBaseDir,
          branding: {
            primaryColor: '#1e3543',
            accentColor: '#00c4e9',
            highlightColor: '#ffb91c',
            ctaColor: '#ff5530',
          },
        },
        templateEngine,
        { clock: () => FIXED_GENERATED_AT },
      );
      await generator.generate(sessionState, outputDir);

      const featureHtml = await readFile(
        join(outputDir, 'features', 'f1-checkout.html'),
        'utf-8',
      );
      // El defecto sigue resaltado en rojo semántico (`--qa-fail-on-tint`,
      // variante con contraste garantizado en oscuro del mismo `--qa-fail`
      // que comparte hex con `RESULT_COLORS`, ver charts.ts), NUNCA con un
      // color de marca.
      expect(featureHtml).toContain('color: var(--qa-fail-on-tint);');
      expect(featureHtml).not.toContain('color: #ff5530');
    });
  });

  describe('pickReadableTextColor', () => {
    it('elige blanco sobre un fondo oscuro (navy de marca)', () => {
      expect(pickReadableTextColor('#1e3543')).toBe('#ffffff');
    });

    it('elige texto oscuro sobre un fondo claro/vívido (cian de marca) donde blanco no tendría contraste suficiente', () => {
      expect(pickReadableTextColor('#00c4e9')).toBe('#111111');
    });

    it('acepta hex de 3 dígitos', () => {
      expect(pickReadableTextColor('#000')).toBe('#ffffff');
      expect(pickReadableTextColor('#fff')).toBe('#111111');
    });

    it('devuelve texto oscuro (opción defensiva) si el color no es un hex válido', () => {
      expect(pickReadableTextColor('no-es-un-color')).toBe('#111111');
    });
  });

  it('copia el ícono genérico de video y otros assets estáticos del template a outputDir/assets/', async () => {
    const templateEngine = createHandlebarsTemplateEngine(DEFAULT_TEMPLATE_DIR);
    const generator = createReportGenerator(
      { projectName: 'Proyecto Demo', evidenceBaseDir },
      templateEngine,
      { clock: () => FIXED_GENERATED_AT },
    );
    await generator.generate(sessionState, outputDir);

    expect(existsSync(join(outputDir, 'assets', 'video-icon.svg'))).toBe(true);
  });

  it('rechaza (con ReportGenerationError) si el templateDir no provee los templates obligatorios', async () => {
    const emptyTemplateDir = join(workDir, 'templates-vacios');
    const templateEngine = createHandlebarsTemplateEngine(emptyTemplateDir);
    const generator = createReportGenerator(
      { projectName: 'Proyecto Demo', evidenceBaseDir },
      templateEngine,
    );

    await expect(generator.generate(sessionState, outputDir)).rejects.toBeInstanceOf(
      ReportGenerationError,
    );
  });

  it('envuelve un error de I/O real (outputDir no se puede crear) en ReportGenerationError', async () => {
    // Un archivo regular en el lugar donde generate() necesita crear un
    // directorio produce un ENOTDIR real de node:fs — se usa esto en vez de
    // un mock para probar el envoltorio con una causa de I/O genuina.
    const { writeFile } = await import('node:fs/promises');
    const blockerPath = join(workDir, 'blocker');
    await writeFile(blockerPath, 'no soy un directorio');

    const templateEngine = createHandlebarsTemplateEngine(DEFAULT_TEMPLATE_DIR);
    const generator = createReportGenerator(
      { projectName: 'Proyecto Demo', evidenceBaseDir },
      templateEngine,
    );

    await expect(
      generator.generate(sessionState, join(blockerPath, 'reports')),
    ).rejects.toBeInstanceOf(ReportGenerationError);
  });
});

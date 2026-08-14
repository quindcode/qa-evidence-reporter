import { copyFile, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';

import { createEvidenceStore } from '../evidence/index.js';
import { ReportGenerationError } from '../types/errors.js';
import type { EvidenceFile, EvidenceStore } from '../types/evidence.js';
import type {
  BrandingInput,
  BrandingMeta,
  EvidenceReportView,
  FeatureDetailPageData,
  FeatureReportView,
  IndexPageData,
  ReportData,
  ReportGenerator,
  ResultCounts,
  ResultSummary,
  ScenarioReportView,
  StepReportView,
  TemplateEngine,
} from '../types/report.js';
import { REQUIRED_REPORT_TEMPLATES } from '../types/report.js';
import {
  deriveFeatureResult,
  deriveScenarioResult,
  type FeatureExecution,
  type ScenarioExecution,
  type SessionState,
  type StepExecution,
} from '../types/session.js';
import { renderDonutChart, renderProgressBar } from './charts.js';
import { createHandlebarsTemplateEngine } from './templateEngine.js';

/** Configuración fija de `createReportGenerator` (no cambia entre llamadas a `generate()`). */
export interface ReportGeneratorConfig {
  projectName: string;
  /**
   * MISMO `baseDir` que se le pasó a `createEvidenceStore` (ver
   * `core/evidence/evidenceStore.ts`) cuando se guardó la evidencia de esta
   * sesión — es decir, la raíz del proyecto del QA, NO la carpeta
   * `evidence/` en sí (`EvidenceStore` antepone ese segmento internamente).
   * `ReportGenerator` reconstruye su propio `EvidenceStore` sobre este mismo
   * `baseDir` para poder listar/copiar los archivos referenciados por cada
   * step (ver nota de diseño en `generate()` más abajo sobre por qué no se
   * inyecta un `EvidenceStore` completo).
   */
  evidenceBaseDir: string;
  /** Branding opcional (logo + paleta) — ver `BrandingInput`/`BrandingMeta` en `core/types/report.ts`. Ausente/vacío por defecto: el reporte se ve igual que siempre. */
  branding?: BrandingInput;
}

/** Dependencias inyectables de `createReportGenerator` (mismo patrón que `SessionEngineDeps`/`EvidenceStoreDeps` de fase 2: opcionales, con default de producción). */
export interface ReportGeneratorDeps {
  /** Por defecto `() => new Date().toISOString()`. Inyectable para que `project.generatedAt` sea determinístico en tests. */
  clock?: () => string;
  /**
   * Factory para construir un `TemplateEngine` alternativo cuando
   * `generate()` recibe `options.templateDir` (ver
   * `GenerateReportOptions` en `core/types/report.ts`). Por defecto
   * `createHandlebarsTemplateEngine`.
   *
   * Existe como dependencia inyectable — en vez de que `generate()` importe
   * y llame `createHandlebarsTemplateEngine` a secas — únicamente para que
   * los TESTS de `reportGenerator.ts` puedan verificar la rama de
   * `options.templateDir` sin necesitar `.hbs` reales en disco. En
   * producción, el default ya cubre el caso real: sigue sin haber ningún
   * `new Handlebars.create()` ni `require('handlebars')` en este archivo
   * (ver ARCHITECTURE.md: "no instanciar Handlebars directamente dentro del
   * generador" — la instancia real vive únicamente en `templateEngine.ts`).
   */
  templateEngineFactory?: (templateDir: string) => TemplateEngine;
}

/**
 * Factory del `ReportGenerator` de referencia.
 *
 * Decisión de diseño (`templateEngine` inyectado, no `templateDir`): a
 * diferencia de `evidenceBaseDir` (una ruta), el motor de templates se
 * recibe ya construido. Esto es lo que hace cumplir la regla de
 * arquitectura "no instanciar Handlebars directamente dentro del
 * generador": quien ensambla la aplicación (en fases futuras, el CLI)
 * decide con qué `templateDir` construir `createHandlebarsTemplateEngine`
 * ANTES de pasárselo aquí, y `reportGenerator.ts` nunca importa el paquete
 * `handlebars` — solo la interfaz `TemplateEngine`. El único punto donde
 * SÍ se termina llamando a `createHandlebarsTemplateEngine` desde este
 * módulo es la rama de `options.templateDir` en `generate()` (ver
 * `ReportGeneratorDeps.templateEngineFactory`), y es a través de esa
 * dependencia inyectable, nunca instanciando `handlebars` directamente.
 *
 * Decisión de diseño (reconstruir un `EvidenceStore` propio en vez de
 * recibirlo inyectado): `ReportGenerator` necesita LEER la evidencia ya
 * guardada (para copiarla a `outputDir/assets/evidence/...`), pero el
 * contrato de esta fase (ver la consigna) fija la firma de
 * `createReportGenerator` como `(config, templateEngine)` — sin un tercer
 * parámetro de `EvidenceStore`. Como `createEvidenceStore` es una factory
 * sin I/O en el momento de crearla (ver `core/evidence/evidenceStore.ts`),
 * reconstruirla acá con `config.evidenceBaseDir` es equivalente en
 * comportamiento a que un caller externo la construya y la pase, sin
 * ensanchar la firma pública. Si una fase futura necesita inyectar un
 * `EvidenceStore` con comportamiento distinto al de referencia (p. ej. en
 * un test), puede hacerlo agregando ese campo a `ReportGeneratorDeps` sin
 * romper compatibilidad — no fue necesario para los tests de esta fase.
 */
export function createReportGenerator(
  config: ReportGeneratorConfig,
  templateEngine: TemplateEngine,
  deps: ReportGeneratorDeps = {},
): ReportGenerator {
  const clock = deps.clock ?? (() => new Date().toISOString());
  const templateEngineFactory = deps.templateEngineFactory ?? createHandlebarsTemplateEngine;

  async function generate(
    sessionState: SessionState,
    outputDir: string,
    options: { templateDir?: string } = {},
  ): Promise<void> {
    const engine = options.templateDir
      ? templateEngineFactory(options.templateDir)
      : templateEngine;
    assertEngineSupportsRequiredTemplates(engine);

    try {
      const evidenceStore = createEvidenceStore(config.evidenceBaseDir);

      // `generate()` reescribe TODO el output de un run anterior, no lo
      // fusiona con el nuevo — ver README, "Qué NO hacer": "generar uno
      // nuevo sobreescribe reports/". Sin este borrado, una corrida previa
      // con más features seleccionadas dejaba sus páginas de detalle
      // (`features/*.html`) y evidencia copiada huérfanas: no referenciadas
      // por el `index.html` nuevo, pero físicamente presentes en el mismo
      // directorio que se comparte/zippea como "el reporte" — dos sistemas
      // visuales (uno viejo, uno nuevo) conviviendo en el mismo entregable
      // si el template cambió entre corridas. Se borra ANTES de reconstruir
      // para que ningún archivo pueda sobrevivir a la sesión que lo generó.
      await rm(join(outputDir, 'features'), { recursive: true, force: true });
      await rm(join(outputDir, 'assets'), { recursive: true, force: true });

      await mkdir(outputDir, { recursive: true });
      await mkdir(join(outputDir, 'assets', 'evidence'), { recursive: true });
      await mkdir(join(outputDir, 'features'), { recursive: true });

      const reportData = await buildReportData(
        sessionState,
        config,
        evidenceStore,
        outputDir,
        clock,
      );

      await copyStaticAssets(engine.getStaticAssetsDir(), outputDir);

      const indexData: IndexPageData = { ...reportData, basePath: '' };
      await writeFile(join(outputDir, 'index.html'), engine.render('index', indexData), 'utf-8');

      for (const feature of reportData.features) {
        const featureData: FeatureDetailPageData = {
          project: reportData.project,
          feature,
          basePath: '../',
        };
        await writeFile(
          join(outputDir, feature.detailPath),
          engine.render('feature-detail', featureData),
          'utf-8',
        );
      }
    } catch (error) {
      if (error instanceof ReportGenerationError) throw error;
      throw new ReportGenerationError(error instanceof Error ? error.message : String(error), {
        cause: error,
      });
    }
  }

  return { generate };
}

/**
 * Valida, ANTES de tocar el filesystem, que `engine` provee los templates
 * mínimos (ver `REQUIRED_REPORT_TEMPLATES` en `core/types/report.ts`). Falla
 * rápido con un mensaje claro en vez de generar un `outputDir` a medias
 * (p. ej. con `assets/` copiados pero sin `index.html`) si un `templateDir`
 * custom está incompleto.
 */
function assertEngineSupportsRequiredTemplates(engine: TemplateEngine): void {
  const available = new Set(engine.getAvailableTemplateNames());
  const missing = REQUIRED_REPORT_TEMPLATES.filter((name) => !available.has(name));
  if (missing.length > 0) {
    throw new ReportGenerationError(
      `el motor de templates no provee los templates obligatorios: ${missing.join(', ')} ` +
        `(disponibles: ${available.size > 0 ? [...available].join(', ') : 'ninguno'}).`,
    );
  }
}

/** Copia recursivamente todo lo que haya bajo `assetsDir` (si existe) a `outputDir/assets/`. No-op si `assetsDir` es `null` (el motor/template no ship ningún asset propio). */
async function copyStaticAssets(assetsDir: string | null, outputDir: string): Promise<void> {
  if (!assetsDir) return;
  await copyDirRecursive(assetsDir, join(outputDir, 'assets'));
}

async function copyDirRecursive(src: string, dest: string): Promise<void> {
  await mkdir(dest, { recursive: true });
  const entries = await readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDirRecursive(srcPath, destPath);
    } else if (entry.isFile()) {
      await copyFile(srcPath, destPath);
    }
  }
}

/**
 * Copia un único archivo de evidencia (original o thumbnail) desde
 * `evidenceBaseDir` hacia `outputDir/assets/...`. `relativePath` es la ruta
 * tal cual la devuelve `EvidenceStore` (`EvidenceFile.path`/`.thumbnailPath`
 * en `core/types/evidence.ts`, relativa a `evidenceBaseDir`), así que el
 * destino queda en `outputDir/assets/{relativePath}` sin necesitar
 * recomponer la ruta a mano.
 */
async function copyEvidenceAsset(
  evidenceBaseDir: string,
  outputDir: string,
  relativePath: string,
): Promise<void> {
  const src = join(evidenceBaseDir, relativePath);
  const dest = join(outputDir, 'assets', relativePath);
  await mkdir(dirname(dest), { recursive: true });
  await copyFile(src, dest);
}

/** `"assets/" + relativePath`, siempre con `/` (portable), para usar como `EvidenceReportView.path`/`.thumbnailPath`. */
function toAssetPath(relativePath: string): string {
  return `assets/${relativePath}`;
}

/**
 * Copia la evidencia de un step a `outputDir` y devuelve las
 * `EvidenceReportView` correspondientes, en el mismo orden que
 * `step.evidenceFileIds` (el orden en que el QA las fue adjuntando).
 *
 * Usa `evidenceStore.list(step.id)` (que reconstruye la metadata escaneando
 * el filesystem, ver `core/evidence/evidenceStore.ts`) y la filtra contra
 * `step.evidenceFileIds` en vez de copiar TODO lo que encuentre en esa
 * carpeta: `SessionEngine.removeEvidence` (fase 2) no borra el archivo
 * físico, solo quita el id de la lista del step — si se ignorara ese
 * filtro, evidencia "quitada" por el QA volvería a aparecer en el reporte.
 * Un id referenciado que ya no existe en disco se omite silenciosamente
 * (no rompe el reporte por un archivo borrado a mano fuera del flujo normal).
 */
async function buildEvidenceViews(
  step: StepExecution,
  evidenceStore: EvidenceStore,
  evidenceBaseDir: string,
  outputDir: string,
): Promise<EvidenceReportView[]> {
  if (step.evidenceFileIds.length === 0) return [];

  const filesById = new Map<string, EvidenceFile>(
    (await evidenceStore.list(step.id)).map((file) => [file.id, file]),
  );

  const views: EvidenceReportView[] = [];
  for (const evidenceFileId of step.evidenceFileIds) {
    const file = filesById.get(evidenceFileId);
    if (!file) continue;

    await copyEvidenceAsset(evidenceBaseDir, outputDir, file.path);
    if (file.thumbnailPath) {
      await copyEvidenceAsset(evidenceBaseDir, outputDir, file.thumbnailPath);
    }

    views.push({
      id: file.id,
      originalFilename: file.originalFilename,
      kind: file.kind,
      path: toAssetPath(file.path),
      thumbnailPath: file.thumbnailPath ? toAssetPath(file.thumbnailPath) : undefined,
    });
  }
  return views;
}

function toStepView(step: StepExecution, evidence: EvidenceReportView[]): StepReportView {
  return {
    id: step.id,
    keyword: step.step.keyword,
    text: step.step.text,
    fromBackground: step.step.fromBackground,
    result: step.result,
    notes: step.notes,
    defectDescription: step.defectDescription,
    evidence,
  };
}

function toScenarioView(scenario: ScenarioExecution, steps: StepReportView[]): ScenarioReportView {
  return {
    id: scenario.id,
    name: scenario.name,
    tags: scenario.tags,
    result: deriveScenarioResult(scenario),
    steps,
  };
}

/**
 * `slug` de `FeatureReportView` es directamente `feature.id` (no un slug
 * recalculado a partir de `feature.name`): `FeatureExecution.id` (ver
 * `core/session/ids.ts`) ya es `"f{featureIndex}-{slug(name)}"`, es decir,
 * ya ES un slug único y estable dentro de la sesión. Volver a
 * "sluggificar" el nombre acá produciría potencialmente OTRO valor (dos
 * features con el mismo nombre pero distinto índice generan el mismo slug
 * de nombre pero distinto `id`) y sería una segunda fuente de verdad para
 * el mismo concepto.
 */
function toFeatureView(
  feature: FeatureExecution,
  scenarios: ScenarioReportView[],
): FeatureReportView {
  const counts = buildResultCounts(flattenFeatureSteps(feature));
  return {
    id: feature.id,
    slug: feature.id,
    name: feature.name,
    tags: feature.tags,
    result: deriveFeatureResult(feature),
    summary: buildResultSummary(counts),
    scenarios,
    detailPath: `features/${feature.id}.html`,
    firstFailedScenarioId: scenarios.find((scenario) => scenario.result === 'fail')?.id,
  };
}

async function buildFeatureViews(
  state: SessionState,
  evidenceStore: EvidenceStore,
  evidenceBaseDir: string,
  outputDir: string,
): Promise<FeatureReportView[]> {
  const featureViews: FeatureReportView[] = [];

  for (const feature of state.selectedFeatures) {
    const scenarioViews: ScenarioReportView[] = [];

    for (const scenario of feature.scenarios) {
      const stepViews: StepReportView[] = [];

      for (const step of scenario.steps) {
        const evidence = await buildEvidenceViews(step, evidenceStore, evidenceBaseDir, outputDir);
        stepViews.push(toStepView(step, evidence));
      }

      scenarioViews.push(toScenarioView(scenario, stepViews));
    }

    featureViews.push(toFeatureView(feature, scenarioViews));
  }

  return featureViews;
}

function flattenFeatureSteps(feature: FeatureExecution): StepExecution[] {
  return feature.scenarios.flatMap((scenario) => scenario.steps);
}

function flattenAllSteps(state: SessionState): StepExecution[] {
  return state.selectedFeatures.flatMap((feature) => flattenFeatureSteps(feature));
}

function buildResultCounts(steps: StepExecution[]): ResultCounts {
  const counts: ResultCounts = { pass: 0, fail: 0, skip: 0, pending: 0 };
  for (const step of steps) counts[step.result] += 1;
  return counts;
}

function buildResultSummary(counts: ResultCounts): ResultSummary {
  const total = counts.pass + counts.fail + counts.skip + counts.pending;
  return {
    ...counts,
    total,
    passRatePercent: total === 0 ? 0 : Math.round((counts.pass / total) * 100),
    completionPercent:
      total === 0 ? 0 : Math.round(((counts.pass + counts.fail + counts.skip) / total) * 100),
  };
}

async function buildReportData(
  state: SessionState,
  config: ReportGeneratorConfig,
  evidenceStore: EvidenceStore,
  outputDir: string,
  clock: () => string,
): Promise<ReportData> {
  const features = await buildFeatureViews(state, evidenceStore, config.evidenceBaseDir, outputDir);
  const summary = buildResultSummary(buildResultCounts(flattenAllSteps(state)));
  const branding = await buildBrandingMeta(config.branding, outputDir);

  return {
    project: {
      projectName: config.projectName,
      generatedAt: clock(),
      branding,
    },
    summary,
    dashboard: {
      // Tamaño reducido respecto al default (220px): en el rediseño del
      // dashboard el protagonista es el % en texto grande (`.qa-hero__number`,
      // ver templates/default/index.hbs) — el donut queda como visual de
      // acompañamiento, no como el elemento principal. `showCenterLabel`
      // solo se activa sin datos ("Sin datos" no repite nada); con datos
      // reales el hero grande de al lado ya es ese mismo número, así que el
      // centro del anillo se deja limpio en vez de duplicarlo.
      distributionDonutSvg: renderDonutChart(summary, {
        size: 200,
        strokeWidth: 30,
        showCenterLabel: summary.total === 0,
      }),
      // Altura reducida respecto al default (28px): sin texto embebido (ver
      // JSDoc de `renderProgressBar`), un track más fino lee como un
      // indicador de progreso, no como una segunda etiqueta de porcentaje.
      progressBarSvg: renderProgressBar(summary.completionPercent, { height: 14 }),
    },
    features,
    firstFailureHref: buildFirstFailureHref(features),
  };
}

/**
 * `detailPath` del primer feature fallido + ancla a su primer scenario
 * fallido (ver `FeatureReportView.firstFailedScenarioId`), o `undefined` si
 * nada falló en toda la sesión. Ver `ReportData.firstFailureHref`.
 */
function buildFirstFailureHref(features: FeatureReportView[]): string | undefined {
  const feature = features.find((candidate) => candidate.firstFailedScenarioId);
  if (!feature?.firstFailedScenarioId) return undefined;
  return `${feature.detailPath}#scenario-${feature.firstFailedScenarioId}`;
}

/** Carpeta (relativa a `outputDir`) donde queda copiado el logo de marca, si hay uno configurado. */
const BRANDING_ASSETS_DIR = 'branding';

/**
 * Resuelve `BrandingInput` (crudo, tal como lo pasó el caller) a
 * `BrandingMeta` (listo para el template): copia el logo a
 * `outputDir/assets/branding/logo{ext}` si está configurado y el archivo
 * existe, y calcula el color de texto legible sobre `primaryColor`/
 * `accentColor` (ver `pickReadableTextColor`).
 *
 * Decisión de diseño (best-effort, nunca lanza): igual que
 * `tryGenerateThumbnail` en `core/evidence/evidenceStore.ts`, un logo
 * configurado con una ruta que no existe (typo, archivo movido) NO debe
 * hacer fallar todo `generate()` — el reporte sigue siendo válido y útil
 * sin logo, solo pierde ese detalle visual. `qa-config.json` valida el
 * FORMATO de los colores (hex) en `core/config`, pero no que el archivo del
 * logo exista — esa comprobación solo es posible acá, con acceso real al
 * filesystem del proyecto.
 */
async function buildBrandingMeta(
  branding: BrandingInput | undefined,
  outputDir: string,
): Promise<BrandingMeta> {
  const logoAssetPath = await copyLogoAsset(branding?.logoAbsolutePath ?? null, outputDir);
  const primaryColor = branding?.primaryColor ?? null;
  const accentColor = branding?.accentColor ?? null;
  const highlightColor = branding?.highlightColor ?? null;
  const ctaColor = branding?.ctaColor ?? null;

  return {
    logoAssetPath,
    primaryColor,
    primaryContrast: primaryColor ? pickReadableTextColor(primaryColor) : null,
    accentColor,
    accentContrast: accentColor ? pickReadableTextColor(accentColor) : null,
    highlightColor,
    ctaColor,
    isBranded: Boolean(logoAssetPath || primaryColor || accentColor || highlightColor || ctaColor),
  };
}

/** Copia el logo a `outputDir/assets/branding/logo{ext}` y devuelve su ruta relativa a `outputDir`, o `null` si no hay logo configurado o no se pudo copiar (ver nota de diseño en `buildBrandingMeta`). */
async function copyLogoAsset(
  logoAbsolutePath: string | null,
  outputDir: string,
): Promise<string | null> {
  if (!logoAbsolutePath) return null;

  try {
    await stat(logoAbsolutePath);
    const destDir = join(outputDir, 'assets', BRANDING_ASSETS_DIR);
    await mkdir(destDir, { recursive: true });
    const destFilename = `logo${extname(logoAbsolutePath)}`;
    await copyFile(logoAbsolutePath, join(destDir, destFilename));
    return toAssetPath(`${BRANDING_ASSETS_DIR}/${destFilename}`);
  } catch {
    return null;
  }
}

/**
 * Elige `#ffffff` o `#111111` como color de texto sobre un fondo `hexColor`,
 * comparando el ratio de contraste WCAG de cada candidato contra el fondo y
 * devolviendo el que tenga mayor contraste (fórmula de luminancia relativa
 * estándar, la misma que usa cualquier verificador de contraste WCAG). No
 * asume ningún color de marca específico — funciona igual de bien para un
 * navy oscuro (devuelve blanco) que para un cian claro (devuelve casi negro,
 * `#111111`, que da ~9:1 de contraste contra `#00c4e9` — mejor que blanco,
 * que apenas llega a ~2:1 y no pasa WCAG AA).
 *
 * Defensivo: si `hexColor` no es un hex válido (`#rgb`/`#rrggbb`), devuelve
 * `#111111` (texto oscuro es la apuesta más segura sobre un fondo
 * desconocido) en vez de lanzar — la validación de formato real ya ocurre
 * en `core/config` (zod), esto es solo una segunda red de seguridad.
 */
export function pickReadableTextColor(hexColor: string): '#ffffff' | '#111111' {
  const rgb = parseHexColor(hexColor);
  if (!rgb) return '#111111';

  const bgLuminance = relativeLuminance(rgb);
  const contrastWithWhite = (1 + 0.05) / (bgLuminance + 0.05);
  const contrastWithBlack = (bgLuminance + 0.05) / 0.05;

  return contrastWithWhite >= contrastWithBlack ? '#ffffff' : '#111111';
}

function parseHexColor(hexColor: string): [number, number, number] | null {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hexColor.trim());
  const hex = match?.[1];
  if (!hex) return null;

  const full = hex.length === 3 ? hex.replace(/(.)/g, '$1$1') : hex;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

/** Convierte un canal de color (0-255) a su valor lineal WCAG, en [0, 1]. */
function toLinearChannel(channel: number): number {
  const normalized = channel / 255;
  return normalized <= 0.03928 ? normalized / 12.92 : Math.pow((normalized + 0.055) / 1.055, 2.4);
}

/** Luminancia relativa WCAG de un color RGB (0-255 por canal), en [0, 1]. */
function relativeLuminance([r, g, b]: [number, number, number]): number {
  return 0.2126 * toLinearChannel(r) + 0.7152 * toLinearChannel(g) + 0.0722 * toLinearChannel(b);
}

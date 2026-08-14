import type { EvidenceKind } from './evidence.js';
import type { SessionState, StepResult } from './session.js';

/**
 * Conteo de steps por resultado. Usa las mismas 4 categorías que
 * `StepResult` (ver `core/types/session.ts`) — nunca se agrega una quinta
 * categoría "otro" porque `StepResult` ya es exhaustivo.
 */
export interface ResultCounts {
  pass: number;
  fail: number;
  skip: number;
  pending: number;
}

/**
 * `ResultCounts` más los agregados derivados que el dashboard/template
 * necesita para no tener que recalcular aritmética de porcentajes en
 * Handlebars (helpers de template deben quedar mínimos, ver
 * `createHandlebarsTemplateEngine`).
 *
 * Ambos porcentajes son `0` (nunca `NaN`) cuando `total === 0` — un feature
 * sin scenarios o una sesión vacía no debe romper el render.
 */
export interface ResultSummary extends ResultCounts {
  /** `pass + fail + skip + pending`. */
  total: number;
  /** `round(pass / total * 100)`. */
  passRatePercent: number;
  /** `round((pass + fail + skip) / total * 100)` — "cuánto de la sesión ya no está en pending". */
  completionPercent: number;
}

/**
 * Evidencia de un step, ya lista para el template: `path`/`thumbnailPath`
 * son rutas RELATIVAS a la raíz de `outputDir` (p. ej.
 * `"assets/evidence/f0-login/.../screenshot.png"`), apuntando a la copia que
 * `ReportGenerator.generate()` ya dejó dentro del reporte — NUNCA a la ruta
 * original bajo `evidenceBaseDir`, que puede no seguir existiendo o no ser
 * portable si el reporte se mueve/comparte por separado del proyecto.
 */
export interface EvidenceReportView {
  id: string;
  originalFilename: string;
  kind: EvidenceKind;
  /** Ruta relativa a la raíz de `outputDir`. Combinar con `basePath` de la página (ver `TemplateEngine`) para obtener la ruta real desde el HTML. */
  path: string;
  /** Solo presente si `kind === 'image'` y se pudo generar/copiar el thumbnail. */
  thumbnailPath?: string;
}

/** Vista de un `StepExecution` (ver `core/types/session.ts`) lista para renderizar. */
export interface StepReportView {
  id: string;
  keyword: 'Given' | 'When' | 'Then';
  text: string;
  fromBackground: boolean;
  result: StepResult;
  notes?: string;
  /** Solo presente (y solo tiene sentido mostrarla resaltada) cuando `result === 'fail'`. */
  defectDescription?: string;
  evidence: EvidenceReportView[];
}

/** Vista de un `ScenarioExecution`. `result` es el mismo valor que produce `deriveScenarioResult`. */
export interface ScenarioReportView {
  id: string;
  name: string;
  tags: string[];
  result: StepResult;
  steps: StepReportView[];
}

/**
 * Vista de un `FeatureExecution`, con su propio `ResultSummary` (agregado
 * solo de sus scenarios/steps, no de toda la sesión — para poder mostrar el
 * % de éxito por feature en la tabla resumen del dashboard).
 */
export interface FeatureReportView {
  id: string;
  /** Igual a `id` — ver nota de diseño en `reportGenerator.ts` sobre por qué no se recalcula un slug aparte. */
  slug: string;
  name: string;
  tags: string[];
  result: StepResult;
  summary: ResultSummary;
  scenarios: ScenarioReportView[];
  /** Ruta relativa a la raíz de `outputDir` de la página de detalle de este feature, p. ej. `"features/f0-login.html"`. */
  detailPath: string;
  /**
   * `id` (ver `ScenarioReportView.id`) del primer scenario con
   * `result === 'fail'` de este feature, o `undefined` si ninguno falló.
   * Cada `<section class="qa-scenario">` del template lleva
   * `id="scenario-{{id}}"` (ver `feature-detail.hbs`) — este campo es el
   * target de un link "Ver primer fallo" en el hero, para no depender de
   * scroll+rail-scanning en un feature con muchos scenarios (ver
   * `/impeccable critique` del reporte, Priority Issue P2).
   */
  firstFailedScenarioId?: string;
}

/** Metadata de proyecto para el encabezado del reporte. */
export interface ProjectMeta {
  projectName: string;
  /** ISO 8601, timestamp de cuándo corrió `generate()`. */
  generatedAt: string;
  /**
   * Nombre de quien ejecutó la sesión. Opcional en esta fase: `core/report`
   * no lee `qa-config.json` (eso es `core/config`, fase 4) ni conoce el
   * concepto de "team"; el campo queda listo para que fase 4 lo rellene al
   * armar `ReportGeneratorConfig` antes de llamar a `generate()`.
   */
  executedBy?: string;
  /** Branding opcional del cliente/empresa (logo + paleta) — ver `BrandingMeta`. */
  branding: BrandingMeta;
}

/**
 * Branding opcional de un proyecto, ya resuelto para el template (logo
 * copiado a `outputDir/assets/`, colores de contraste ya calculados — el
 * template NUNCA decide qué color de texto usar sobre un color de marca,
 * eso es responsabilidad de `reportGenerator.ts`, ver `pickReadableTextColor`).
 *
 * Decisión de diseño (`isBranded` explícito, no `Boolean(logoAssetPath || ...)`
 * en el template): Handlebars no tiene un operador `||` nativo entre
 * múltiples valores sin escribir un helper custom — es más simple resolver
 * esta única condición una vez en TypeScript que en cada template que
 * necesite decidir "¿muestro el header de marca o el neutro?".
 *
 * Cuando ningún campo de branding está configurado en `qa-config.json`
 * (el caso por defecto, y el único caso para `sample-project/`), TODOS los
 * campos quedan `null` e `isBranded` es `false` — el reporte se ve
 * EXACTAMENTE igual que antes de que existiera esta feature.
 */
export interface BrandingMeta {
  /** Ruta relativa a `outputDir` del logo ya copiado (p. ej. `"assets/branding/logo.png"`), o `null` si no hay logo configurado, el archivo no existe, o no se pudo copiar (best-effort, ver `reportGenerator.ts`). */
  logoAssetPath: string | null;
  primaryColor: string | null;
  /** Color de texto legible sobre `primaryColor` (`#ffffff` o `#111111`, elegido por contraste WCAG — ver `pickReadableTextColor`). `null` si `primaryColor` es `null`. */
  primaryContrast: string | null;
  accentColor: string | null;
  /** Mismo criterio que `primaryContrast`, para texto sobre `accentColor`. */
  accentContrast: string | null;
  highlightColor: string | null;
  ctaColor: string | null;
  isBranded: boolean;
}

/**
 * Branding tal como lo recibe `createReportGenerator` desde el caller (CLI
 * `report`/server), ANTES de resolver el logo a una ruta copiada o calcular
 * contraste — ver `BrandingMeta` para la forma ya resuelta que llega al
 * template. Todos los campos opcionales/nulleables: un proyecto sin
 * branding configurado no pasa este objeto en absoluto (o lo pasa vacío).
 */
export interface BrandingInput {
  /** Ruta ABSOLUTA en el filesystem al archivo de logo (ya resuelta por el caller a partir de `qa-config.json` → `branding.logoPath`), o `null`/`undefined`. */
  logoAbsolutePath?: string | null;
  primaryColor?: string | null;
  accentColor?: string | null;
  highlightColor?: string | null;
  ctaColor?: string | null;
}

/**
 * Gráficos del dashboard, ya renderizados a SVG (ver `core/report/charts.ts`).
 * Son markup crudo (`<svg>...</svg>`) — el template debe insertarlos SIN
 * escapar (en Handlebars, `{{{ }}}` en vez de `{{ }}`), nunca como texto.
 */
export interface DashboardCharts {
  /** Donut de distribución pass/fail/skip/pending de TODA la sesión. */
  distributionDonutSvg: string;
  /** Barra de progreso de `summary.completionPercent`. */
  progressBarSvg: string;
}

/**
 * Agregado completo ("view model") que necesita el template para renderizar
 * el reporte: metadata de proyecto, resumen global, gráficos y la lista de
 * features con sus scenarios/steps ya resueltos (conteos, porcentajes y
 * rutas de evidencia ya copiadas a `outputDir`).
 *
 * Nota de diseño: `ReportData` NO incluye `basePath` (la ruta relativa desde
 * el HTML que se está renderizando hasta la raíz de `outputDir`) porque ese
 * valor depende de la PÁGINA concreta que se renderiza (`''` para
 * `index.html`, que vive en la raíz; `'../'` para
 * `features/{slug}.html`, un nivel más abajo) y no del agregado de datos en
 * sí. `ReportGenerator.generate()` construye, por cada página, un objeto de
 * contexto que combina este `ReportData` (o un recorte de él) con el
 * `basePath` correspondiente antes de llamar a `TemplateEngine.render()` —
 * ver el contrato mínimo documentado en `TemplateEngine`.
 */
export interface ReportData {
  project: ProjectMeta;
  /** Resumen agregado de TODA la sesión (todas las features seleccionadas). */
  summary: ResultSummary;
  dashboard: DashboardCharts;
  features: FeatureReportView[];
  /**
   * Ruta relativa a la raíz de `outputDir` (combina `detailPath` del
   * primer feature fallido + `#scenario-{id}` de su primer scenario
   * fallido, p. ej. `"features/f0-login.html#scenario-f0-login_s1-..."`),
   * o `undefined` si ningún step de toda la sesión falló. El dashboard usa
   * esto para un link "Ver primer fallo" que salta directo al primer
   * problema real sin depender de scroll+rail-scanning por feature.
   */
  firstFailureHref?: string;
}

/**
 * Contexto pasado a `TemplateEngine.render('index', data)`. Añade a
 * `ReportData` el `basePath` de esta página (siempre `''`: `index.html` vive
 * en la raíz de `outputDir`).
 */
export interface IndexPageData extends ReportData {
  basePath: string;
}

/**
 * Contexto pasado a `TemplateEngine.render('feature-detail', data)`, una vez
 * por cada feature. Deliberadamente NO extiende `ReportData` completo (no
 * lleva `features` ni `dashboard`): la página de detalle de un feature solo
 * necesita datos de ESE feature — pasarle el árbol completo de todas las
 * features sería malgastar memoria/tiempo de compilación de Handlebars sin
 * que el template lo use.
 */
export interface FeatureDetailPageData {
  project: ProjectMeta;
  /** El mismo feature cuyo `detailPath` se está renderizando. */
  feature: FeatureReportView;
  /** `'../'` en la implementación de referencia: `features/{slug}.html` vive un nivel bajo `outputDir`. */
  basePath: string;
}

/** Nombres de template que `ReportGenerator` necesita para poder generar el reporte completo. */
export const REQUIRED_REPORT_TEMPLATES = ['index', 'feature-detail'] as const;

/** Uno de los nombres en `REQUIRED_REPORT_TEMPLATES`. */
export type ReportTemplateName = (typeof REQUIRED_REPORT_TEMPLATES)[number];

/**
 * Puerto (interfaz) para el motor de templates que renderiza el reporte a
 * HTML. Existe para que un usuario avanzado pueda sustituir por completo el
 * motor de referencia (`createHandlebarsTemplateEngine`, basado en
 * `handlebars`) por su propia implementación (otro motor de templates, o
 * incluso strings armados a mano) sin que `ReportGenerator` necesite saber
 * cuál se está usando.
 *
 * ## Contrato mínimo para un `TemplateEngine` custom
 *
 * `ReportGenerator.generate()` llama a `render()` exactamente dos formas de
 * template, con exactamente estos datos (ver `core/types/report.ts` para
 * los tipos completos):
 *
 * 1. `render('index', data: IndexPageData)` — UNA vez. El HTML resultante se
 *    escribe en `outputDir/index.html`. Para no romper el reporte, el
 *    template debe usar como mínimo:
 *    - `data.project.projectName`, `data.project.generatedAt` (metadata del
 *      encabezado).
 *    - `data.summary.total/pass/fail/skip/pending/passRatePercent/completionPercent`
 *      (resumen global).
 *    - `data.dashboard.distributionDonutSvg` y `data.dashboard.progressBarSvg`
 *      — son markup SVG crudo: el template debe insertarlos SIN escapar
 *      (`{{{ }}}` en Handlebars) o el HTML del reporte mostrará las
 *      etiquetas `<svg>` como texto en vez de renderizarlas.
 *    - `data.features` (array): por cada elemento, como mínimo `.name`,
 *      `.result`, `.summary.passRatePercent` y `.detailPath` (para el link
 *      a la vista de detalle — debe combinarse con `data.basePath` como
 *      prefijo: `{{basePath}}{{detailPath}}`, NUNCA una ruta absoluta ni con
 *      `http://`/`https://`, para que el reporte siga abriendo con `file://`).
 *    - `data.basePath` (string, `''` en la implementación de referencia):
 *      prefijo relativo para CUALQUIER link/asset dentro de la página
 *      (`{{basePath}}assets/...`, `{{basePath}}features/...`).
 *
 * 2. `render('feature-detail', data: FeatureDetailPageData)` — una vez POR
 *    CADA feature seleccionada. El HTML resultante se escribe en
 *    `outputDir/{data.feature.detailPath}`. Como mínimo:
 *    - `data.project.projectName`.
 *    - `data.feature.name`, `.tags`, `.summary.*`.
 *    - `data.feature.scenarios[].name`, `.result`, `.steps[]`.
 *    - Por cada step: `.keyword`, `.text`, `.result` (para el badge visual),
 *      `.notes`, `.defectDescription` (solo relevante si `result === 'fail'`
 *      — un template custom debería resaltarlo visualmente, pero omitirlo
 *      no rompe el reporte, solo empobrece la evidencia mostrada) y
 *      `.evidence[]` (`.kind`, `.path`, `.thumbnailPath`).
 *    - `data.basePath` (`'../'` en la implementación de referencia, porque
 *      esta página vive un nivel bajo `outputDir`): mismo uso que en
 *      `index`, prefijo obligatorio para cualquier ruta.
 *
 * Cualquier campo fuera de esta lista (p. ej. `tags` a nivel step — no
 * existe, ver `StepReportView`) es responsabilidad de cada template
 * concreto; agregarlos o ignorarlos no rompe el contrato.
 */
export interface TemplateEngine {
  /**
   * Renderiza el template `templateName` (sin extensión `.hbs`) con `data` y
   * devuelve el HTML resultante como string. Lanza (sin capturar) si el
   * template no existe o falla al compilar/renderizar — `ReportGenerator` es
   * quien envuelve ese error en `ReportGenerationError`, `TemplateEngine` no
   * lo hace por su cuenta (así una implementación custom puede lanzar
   * cualquier error propio sin que este puerto le imponga un tipo).
   */
  render(templateName: string, data: unknown): string;

  /**
   * Nombres de template que este motor puede `render()` sin lanzar en este
   * momento (p. ej., para la implementación de referencia, los `.hbs` que
   * existen directamente bajo `templateDir`, sin contar `partials/`).
   * `ReportGenerator` usa esto para validar, ANTES de renderizar nada, que
   * el motor provisto soporta como mínimo `REQUIRED_REPORT_TEMPLATES` — así
   * un `templateDir` custom incompleto falla rápido con un
   * `ReportGenerationError` claro, en vez de generar un reporte a medias.
   */
  getAvailableTemplateNames(): string[];

  /**
   * Ruta absoluta a una carpeta de assets estáticos que deben copiarse tal
   * cual a `outputDir/assets/` (p. ej. `templates/default/assets/video-icon.svg`
   * en la implementación de referencia), o `null` si este motor/template no
   * necesita ninguno. Se modela como método (no como parte de `render`)
   * porque es el único punto del contrato que necesita acceso al
   * filesystem del lado del template en vez de solo producir strings —
   * una implementación custom que renderiza todo en memoria (sin assets
   * propios) puede devolver `null` sin romper `generate()`.
   */
  getStaticAssetsDir(): string | null;
}

/** Opciones de `ReportGenerator.generate()`. */
export interface GenerateReportOptions {
  /**
   * Si se provee, `generate()` usa un `TemplateEngine` construido para ESTE
   * directorio en vez del inyectado en `createReportGenerator` — ver nota de
   * diseño en `reportGenerator.ts` sobre por qué esto no viola "no
   * instanciar Handlebars directamente dentro del generador" (delega en la
   * misma factory `createHandlebarsTemplateEngine`, nunca en el paquete
   * `handlebars` directamente).
   */
  templateDir?: string;
}

/**
 * Puerto (interfaz) para generar el reporte HTML final a partir de una
 * `SessionState` (ver `core/types/session.ts`). La implementación de
 * referencia es `createReportGenerator` en `core/report/reportGenerator.ts`.
 */
export interface ReportGenerator {
  /**
   * Genera el reporte completo dentro de `outputDir` (lo crea si no existe):
   * `outputDir/index.html`, `outputDir/features/{slug}.html` por cada
   * feature, y `outputDir/assets/...` con todo lo necesario para que el
   * reporte abra con `file://` sin servidor (CSS/JS inline en el HTML,
   * evidencias e íconos ya copiados dentro de `outputDir`).
   *
   * Nunca deja escapar una excepción cruda: cualquier fallo (template
   * inválido, error de I/O al copiar evidencia, etc.) se envuelve en
   * `ReportGenerationError` (ver `core/types/errors.ts`).
   */
  generate(
    sessionState: SessionState,
    outputDir: string,
    options?: GenerateReportOptions,
  ): Promise<void>;
}

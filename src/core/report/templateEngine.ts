import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import Handlebars from 'handlebars';

import type { TemplateEngine } from '../types/report.js';
import type { StepResult } from '../types/session.js';
import { RESULT_LABELS } from './charts.js';

/** Extensión de archivo de template/partial reconocida por el motor. */
const TEMPLATE_EXTENSION = '.hbs';

/**
 * Factory del `TemplateEngine` de referencia, basado en `handlebars` (ver
 * ARCHITECTURE.md, tabla de stack tecnológico). `templateDir` es la carpeta
 * que contiene los `.hbs` de nivel superior (`index.hbs`, `feature-detail.hbs`,
 * ...) y, opcionalmente, `templateDir/partials/*.hbs` (registrados como
 * partials de Handlebars con su nombre de archivo sin extensión) y
 * `templateDir/assets/*` (ver `getStaticAssetsDir`).
 *
 * Decisión de diseño (instancia aislada de Handlebars): se usa
 * `Handlebars.create()` en vez del singleton global del módulo (`Handlebars`
 * a secas). Esto permite que dos `createHandlebarsTemplateEngine` con
 * `templateDir` distintos (p. ej. el motor por defecto y uno custom pasado
 * vía `GenerateReportOptions.templateDir`, ver `reportGenerator.ts`)
 * registren cada uno sus propios partials/helpers sin pisarse entre sí ni
 * con llamadores externos que también usen `handlebars` en el mismo
 * proceso.
 *
 * Decisión de diseño (lectura de disco síncrona): tanto el registro de
 * partials como la compilación de cada template usan `fs` síncrono
 * (`readFileSync`/`readdirSync`). Es deliberado: son operaciones de
 * "arranque" (se ejecutan una sola vez por template, nunca en un loop
 * caliente) sobre archivos pequeños que el propio paquete distribuye junto a
 * su código, así que el costo de bloquear el event loop es irrelevante y a
 * cambio se evita la complejidad de un registro de partials asíncrono con
 * carreras de inicialización.
 */
export function createHandlebarsTemplateEngine(templateDir: string): TemplateEngine {
  const handlebars = Handlebars.create();
  registerHelpers(handlebars);
  registerPartials(handlebars, join(templateDir, 'partials'));

  const compiledTemplates = new Map<string, Handlebars.TemplateDelegate>();

  function compile(templateName: string): Handlebars.TemplateDelegate {
    const cached = compiledTemplates.get(templateName);
    if (cached) return cached;

    const source = readFileSync(join(templateDir, `${templateName}${TEMPLATE_EXTENSION}`), 'utf-8');
    const compiled = handlebars.compile(source, { strict: false, noEscape: false });
    compiledTemplates.set(templateName, compiled);
    return compiled;
  }

  function render(templateName: string, data: unknown): string {
    return compile(templateName)(data);
  }

  function getAvailableTemplateNames(): string[] {
    return listHbsBaseNames(templateDir);
  }

  function getStaticAssetsDir(): string | null {
    const assetsDir = join(templateDir, 'assets');
    return existsSync(assetsDir) ? assetsDir : null;
  }

  return { render, getAvailableTemplateNames, getStaticAssetsDir };
}

/** Nombres (sin extensión) de los `.hbs` que son archivos directos de `dir` — no desciende a subcarpetas (así `partials/` no cuenta como un template de nivel superior). `[]` si `dir` no existe. */
function listHbsBaseNames(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(TEMPLATE_EXTENSION))
    .map((entry) => entry.name.slice(0, -TEMPLATE_EXTENSION.length));
}

/** Registra cada `.hbs` bajo `partialsDir` como partial de Handlebars (nombre = nombre de archivo sin extensión). No-op si `partialsDir` no existe. */
function registerPartials(handlebars: typeof Handlebars, partialsDir: string): void {
  for (const name of listHbsBaseNames(partialsDir)) {
    const source = readFileSync(join(partialsDir, `${name}${TEMPLATE_EXTENSION}`), 'utf-8');
    handlebars.registerPartial(name, source);
  }
}

/**
 * Helpers de Handlebars usados por los templates de referencia
 * (`templates/default/*.hbs`). Un `TemplateEngine` custom no está obligado a
 * usarlos (puede traer los suyos, o ninguno) — viven acá y no en
 * `core/types/report.ts` porque son un detalle de la implementación
 * concreta con `handlebars`, no parte del contrato `TemplateEngine`.
 */
function registerHelpers(handlebars: typeof Handlebars): void {
  // Comparación genérica, usada en los templates para `{{#if (eq a b)}}`
  // (Handlebars no tiene un helper de igualdad incorporado).
  handlebars.registerHelper('eq', (a: unknown, b: unknown) => a === b);

  // Clase CSS determinística a partir de un `StepResult` (ver
  // `templates/default/partials/styles.hbs`, que define `.qa-badge--pass`,
  // `.qa-badge--fail`, `.qa-badge--skip`, `.qa-badge--pending`).
  handlebars.registerHelper('resultBadgeClass', (result: StepResult) => `qa-badge--${result}`);

  // Etiqueta en español de un `StepResult`. Reusa `RESULT_LABELS` de
  // `charts.ts` (ver su nota de diseño): una sola fuente de verdad para las
  // etiquetas visibles, tanto dentro del SVG del donut como en los badges
  // HTML de scenario/step.
  handlebars.registerHelper('resultLabel', (result: StepResult) => RESULT_LABELS[result]);

  // `count === 1 ? '' : 's'` — pluralización simple en español (suficiente
  // para "step"/"steps", "aprobado"/"aprobados", etc.; no cubre plurales
  // irregulares porque el reporte no los necesita).
  handlebars.registerHelper('pluralize', (count: number) => (count === 1 ? '' : 's'));

  // Porcentaje entero de `value` sobre `total`, `0` si `total` es `0` (nunca
  // `NaN` en el HTML). Redondeo simple, sin necesidad de precisión decimal
  // para una leyenda de dashboard.
  handlebars.registerHelper('percentOf', (value: number, total: number) =>
    total === 0 ? 0 : Math.round((value / total) * 100),
  );

  // `true` si el acordeón de este scenario debe empezar ABIERTO (ver
  // partials/feature-detail.hbs + accordion-script.hbs): siempre que el
  // scenario falló, o si es el primero de la feature Y NINGÚN scenario de
  // esa feature falló (para que la página nunca cargue con todo colapsado).
  // Calculado server-side (no en el script inline) para que el HTML ya
  // nazca con el `max-height`/`aria-expanded` correctos — sin esto, el
  // script tendría que corregir el estado recién al final de `<body>`,
  // mostrando un flash del contenido completamente expandido mientras tanto.
  handlebars.registerHelper(
    'scenarioDefaultOpen',
    (scenarioResult: StepResult, featureResult: StepResult, isFirst: boolean) =>
      scenarioResult === 'fail' || (isFirst && featureResult !== 'fail'),
  );

  // Serializa `value` a JSON para embeberlo en un `<script type="application/json">`
  // (ver `partials/dashboard-data.hbs`) — usado con `{{{ }}}` (SafeString,
  // sin doble-escapar) porque el resultado YA es JSON válido, nunca HTML.
  // Escapa `<`/`>`/`&` a sus secuencias `\u00XX` (no a entidades HTML,  que
  // romperían el JSON): sin esto, un nombre de feature/scenario que
  // contenga literalmente `</script>` cerraría el tag antes de tiempo y
  // rompería el resto de la página — los nombres vienen de archivos
  // `.feature` reales, no de un formulario, pero nunca se asume que un
  // string arbitrario es seguro de insertar crudo dentro de un `<script>`.
  handlebars.registerHelper(
    'json',
    (value: unknown) => new handlebars.SafeString(safeJsonStringify(value)),
  );

  // Formato de fecha fijo (`DD/MM/AAAA HH:mm`, hora local de quien abre el
  // reporte) en vez de `Intl.DateTimeFormat`/`toLocaleString`: evita que el
  // formato del reporte varíe según el locale del sistema donde corrió
  // `generate()` (que no es necesariamente el mismo que el de quien lo lee).
  handlebars.registerHelper('formatDate', (iso: string) => formatDate(iso));

  // `stroke-dasharray` del ring SVG de cada stat chip (ver partials/legend.hbs,
  // `.qa-stat__ring`) — un ring de progreso puro CSS/SVG, mismo patrón que
  // `feature-progress-bar.hbs` (micro-visual sin ECharts para un elemento
  // chico que se repite y no necesita interactividad propia, ver DESIGN.md).
  // Radio fijo (15.5, calzado con el `viewBox="0 0 36 36"` del SVG): server-side
  // porque es la MISMA cuenta en todas las filas, no hace falta que el
  // navegador la recalcule por elemento.
  handlebars.registerHelper('ringDashArray', (percent: number) => {
    const radius = 15.5;
    const circumference = 2 * Math.PI * radius;
    const clamped = Math.max(0, Math.min(100, percent));
    const dash = (clamped / 100) * circumference;
    const gap = circumference - dash;
    return `${dash.toFixed(2)} ${gap.toFixed(2)}`;
  });
}

/** Ver JSDoc del helper `json` — mismo criterio de escape que usan frameworks como Next.js/Rails para JSON embebido en `<script>`. */
function safeJsonStringify(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;

  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

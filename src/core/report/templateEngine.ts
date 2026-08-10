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

  // Formato de fecha fijo (`DD/MM/AAAA HH:mm`, hora local de quien abre el
  // reporte) en vez de `Intl.DateTimeFormat`/`toLocaleString`: evita que el
  // formato del reporte varíe según el locale del sistema donde corrió
  // `generate()` (que no es necesariamente el mismo que el de quien lo lee).
  handlebars.registerHelper('formatDate', (iso: string) => formatDate(iso));
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;

  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

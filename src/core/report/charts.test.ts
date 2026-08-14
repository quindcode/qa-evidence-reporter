import { DOMParser } from '@xmldom/xmldom';
import { describe, expect, it } from 'vitest';

import type { ResultCounts } from '../types/report.js';
import { DONUT_SLICE_GAP_PX, RESULT_COLORS, renderDonutChart, renderProgressBar } from './charts.js';

/** Parsea `svg` como XML y lanza si no es "well-formed" (ver investigación en el propio test file: `@xmldom/xmldom` lanza en fatalError por defecto, p. ej. tags sin cerrar). */
function parseSvg(svg: string): Document {
  return new DOMParser().parseFromString(svg, 'image/svg+xml');
}

function countsOf(partial: Partial<ResultCounts>): ResultCounts {
  return { pass: 0, fail: 0, skip: 0, pending: 0, ...partial };
}

describe('renderDonutChart', () => {
  it('produce XML válido (parseable)', () => {
    const svg = renderDonutChart(countsOf({ pass: 2, fail: 1, skip: 1 }));
    expect(() => parseSvg(svg)).not.toThrow();

    const doc = parseSvg(svg);
    expect(doc.documentElement.tagName).toBe('svg');
  });

  it('produce XML válido incluso sin datos (total === 0)', () => {
    const svg = renderDonutChart(countsOf({}));
    expect(() => parseSvg(svg)).not.toThrow();
    // Sin porciones: solo el aro de fondo, ningún <circle data-result>.
    const doc = parseSvg(svg);
    const circles = Array.from(doc.getElementsByTagName('circle'));
    expect(circles.every((circle) => circle.getAttribute('data-result') === null)).toBe(true);
  });

  it('2 pass de 4 total → la porción "pass" ocupa el 50% del donut (menos el hueco entre porciones)', () => {
    const svg = renderDonutChart(countsOf({ pass: 2, fail: 1, skip: 1 }));
    const doc = parseSvg(svg);

    const passSlice = findSliceByResult(doc, 'pass');
    expect(passSlice.getAttribute('data-percent')).toBe('50');
    expect(passSlice.getAttribute('data-value')).toBe('2');

    // El largo del segmento "pintado" del stroke-dasharray debe ser la mitad
    // de la circunferencia total, menos el hueco fijo entre porciones (ver
    // DONUT_SLICE_GAP_PX) que separa esta porción de sus vecinas — ya no es
    // exactamente igual al resto (`painted === rest`) porque ese resto ahora
    // incluye el hueco.
    const size = 220;
    const strokeWidth = 32;
    const radius = (size - strokeWidth) / 2;
    const circumference = 2 * Math.PI * radius;
    const [painted, rest] = parseDasharray(passSlice);
    expect(painted).toBeCloseTo(circumference / 2 - DONUT_SLICE_GAP_PX, 1);
    expect(painted + rest).toBeCloseTo(circumference, 1);
  });

  it('cada categoría con valor > 0 tiene su propio <circle> con el color documentado en RESULT_COLORS', () => {
    const svg = renderDonutChart(countsOf({ pass: 1, fail: 1, skip: 1, pending: 1 }));
    const doc = parseSvg(svg);

    for (const result of ['pass', 'fail', 'skip', 'pending'] as const) {
      const slice = findSliceByResult(doc, result);
      expect(slice.getAttribute('stroke')).toBe(RESULT_COLORS[result]);
      expect(slice.getAttribute('data-percent')).toBe('25');
    }
  });

  it('no genera un <circle> para una categoría en 0', () => {
    const svg = renderDonutChart(countsOf({ pass: 4 }));
    const doc = parseSvg(svg);
    expect(findSliceByResultOrNull(doc, 'fail')).toBeNull();
    expect(findSliceByResultOrNull(doc, 'skip')).toBeNull();
    expect(findSliceByResultOrNull(doc, 'pending')).toBeNull();
  });

  it('es accesible: role="img", aria-label con el resumen en texto, y <title>', () => {
    const svg = renderDonutChart(countsOf({ pass: 3, fail: 1 }));
    const doc = parseSvg(svg);
    const root = doc.documentElement;

    expect(root.getAttribute('role')).toBe('img');
    expect(root.getAttribute('aria-label')).toMatch(/Aprobado/);
    expect(root.getAttribute('aria-label')).toMatch(/Fallido/);

    const titles = doc.getElementsByTagName('title');
    expect(titles.length).toBeGreaterThan(0);
    expect(titles.item(0)?.textContent).toBe(root.getAttribute('aria-label'));
  });

  it('respeta el tamaño/grosor pasados por options', () => {
    const svg = renderDonutChart(countsOf({ pass: 1 }), { size: 100, strokeWidth: 10 });
    const doc = parseSvg(svg);
    expect(doc.documentElement.getAttribute('width')).toBe('100');
    expect(doc.documentElement.getAttribute('height')).toBe('100');
  });
});

describe('renderProgressBar', () => {
  it('produce XML válido (parseable)', () => {
    const svg = renderProgressBar(42);
    expect(() => parseSvg(svg)).not.toThrow();
  });

  it('el rect de relleno ocupa exactamente el % pasado del ancho total', () => {
    const width = 500;
    const svg = renderProgressBar(30, { width });
    const doc = parseSvg(svg);
    const fill = findRectByRole(doc, 'fill');
    expect(Number(fill.getAttribute('width'))).toBeCloseTo(width * 0.3, 1);
    expect(fill.getAttribute('data-percent')).toBe('30');
  });

  it('clampea valores fuera de [0, 100] en vez de desbordar el viewBox', () => {
    const width = 300;
    const over = parseSvg(renderProgressBar(150, { width }));
    expect(Number(findRectByRole(over, 'fill').getAttribute('width'))).toBeCloseTo(width, 1);

    const under = parseSvg(renderProgressBar(-20, { width }));
    expect(Number(findRectByRole(under, 'fill').getAttribute('width'))).toBeCloseTo(0, 1);
  });

  it('es accesible: role="img" y aria-label con el porcentaje en texto', () => {
    const doc = parseSvg(renderProgressBar(75));
    expect(doc.documentElement.getAttribute('role')).toBe('img');
    expect(doc.documentElement.getAttribute('aria-label')).toMatch(/75%/);
  });
});

function findSliceByResult(doc: Document, result: string): Element {
  const slice = findSliceByResultOrNull(doc, result);
  if (!slice) throw new Error(`no se encontró un <circle data-result="${result}">`);
  return slice;
}

function findSliceByResultOrNull(doc: Document, result: string): Element | null {
  const circles = Array.from(doc.getElementsByTagName('circle'));
  return circles.find((circle) => circle.getAttribute('data-result') === result) ?? null;
}

function findRectByRole(doc: Document, role: string): Element {
  const rects = Array.from(doc.getElementsByTagName('rect'));
  const match = rects.find((rect) => rect.getAttribute('data-role') === role);
  if (!match) throw new Error(`no se encontró un <rect data-role="${role}">`);
  return match;
}

function parseDasharray(element: Element): [number, number] {
  const raw = element.getAttribute('stroke-dasharray') ?? '';
  const [painted, rest] = raw.split(/\s+/).map(Number);
  return [painted ?? 0, rest ?? 0];
}

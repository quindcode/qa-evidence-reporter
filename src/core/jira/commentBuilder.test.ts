import { describe, expect, it } from 'vitest';

import type { FeatureExecution, SessionState } from '../types/session.js';
import { buildQaSummaryComment } from './commentBuilder.js';

function scenario(name: string, results: Array<'pass' | 'fail' | 'skip' | 'pending'>) {
  return {
    id: `s-${name}`,
    name,
    tags: [],
    steps: results.map((result, index) => ({
      id: `st-${index}`,
      step: { keyword: 'Given' as const, text: 'un paso', fromBackground: false },
      result,
      evidenceFileIds: [],
      timestamps: {},
    })),
  };
}

function feature(name: string, scenarios: ReturnType<typeof scenario>[]): FeatureExecution {
  return { id: `f-${name}`, name, tags: [], scenarios };
}

function session(features: FeatureExecution[]): SessionState {
  return {
    version: 1,
    projectName: 'Proyecto de prueba',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    selectedFeatures: features,
    currentPosition: { featureIndex: 0, scenarioIndex: 0, stepIndex: 0 },
    status: 'completed',
  };
}

function textOf(doc: ReturnType<typeof buildQaSummaryComment>): string {
  return JSON.stringify(doc.content);
}

describe('buildQaSummaryComment', () => {
  it('produce un doc ADF válido (type/version/content)', () => {
    const doc = buildQaSummaryComment(session([feature('Login', [scenario('Login OK', ['pass'])])]));

    expect(doc.type).toBe('doc');
    expect(doc.version).toBe(1);
    expect(Array.isArray(doc.content)).toBe(true);
  });

  it('lista el nombre de cada feature y sus scenarios con el resultado derivado, sin mencionar steps', () => {
    const doc = buildQaSummaryComment(
      session([
        feature('Login', [scenario('Login OK', ['pass']), scenario('Login fallido', ['fail'])]),
      ]),
    );

    const text = textOf(doc);
    expect(text).toContain('Login');
    expect(text).toContain('Login OK — Aprobado');
    expect(text).toContain('Login fallido — Fallido');
    expect(text).not.toContain('un paso');
  });

  it('calcula los porcentajes sobre el total de SCENARIOS (misma base que el dashboard del reporte HTML), no sobre steps', () => {
    // 1 feature, 2 scenarios: uno pass (con 3 steps pass) y uno fail (con 1 step fail) —
    // a nivel step sería 75% pass / 25% fail; a nivel scenario debe ser 50/50, para
    // coincidir con `buildResultSummary` (`reportGenerator.ts`), que ahora cuenta scenarios.
    const doc = buildQaSummaryComment(
      session([
        feature('Checkout', [
          scenario('Compra exitosa', ['pass', 'pass', 'pass']),
          scenario('Compra rechazada', ['fail']),
        ]),
      ]),
    );

    const text = textOf(doc);
    expect(text).toContain('Aprobado: 50% (1/2)');
    expect(text).toContain('Fallido: 50% (1/2)');
    expect(text).toContain('Omitido: 0% (0/2)');
  });

  it('un scenario con 2 steps pass y 1 skip cuenta como 1 scenario OMITIDO en el resumen, no como "2 pass"', () => {
    // Reproduce exactamente el caso reportado: los steps que sí pasaron
    // dentro de un scenario que en conjunto no pasó no deben inflar el %
    // de aprobados del resumen.
    const doc = buildQaSummaryComment(
      session([feature('Reportes', [scenario('Exportar CSV', ['pass', 'pass', 'skip'])])]),
    );

    const text = textOf(doc);
    expect(text).toContain('Aprobado: 0% (0/1)');
    expect(text).toContain('Omitido: 100% (1/1)');
  });

  it('con una sesión sin scenarios, los porcentajes son 0 (nunca NaN)', () => {
    const doc = buildQaSummaryComment(session([]));

    const text = textOf(doc);
    expect(text).toContain('Aprobado: 0% (0/0)');
    expect(text).toContain('Fallido: 0% (0/0)');
    expect(text).toContain('Omitido: 0% (0/0)');
  });

  it('un scenario con algún step "skip" (y ninguno fail/pending) deriva a "skip"', () => {
    const doc = buildQaSummaryComment(
      session([feature('Reportes', [scenario('Exportar CSV', ['pass', 'skip'])])]),
    );

    expect(textOf(doc)).toContain('Exportar CSV — Omitido');
  });
});

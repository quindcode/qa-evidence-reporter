import { describe, expect, it } from 'vitest';

import type { FeatureExecution, SessionState } from '../types/session.js';
import { buildQaSummaryCommentHtml } from './commentBuilder.js';

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

describe('buildQaSummaryCommentHtml', () => {
  it('produce un string HTML (no un objeto ADF)', () => {
    const html = buildQaSummaryCommentHtml(session([feature('Login', [scenario('Login OK', ['pass'])])]));

    expect(typeof html).toBe('string');
    expect(html).toContain('<h3>');
  });

  it('lista el nombre de cada feature y sus scenarios con el resultado derivado, sin mencionar steps', () => {
    const html = buildQaSummaryCommentHtml(
      session([
        feature('Login', [scenario('Login OK', ['pass']), scenario('Login fallido', ['fail'])]),
      ]),
    );

    expect(html).toContain('Login');
    expect(html).toContain('Login OK — Aprobado');
    expect(html).toContain('Login fallido — Fallido');
    expect(html).not.toContain('un paso');
  });

  it('calcula los porcentajes sobre el total de SCENARIOS (misma base que el dashboard del reporte HTML), no sobre steps', () => {
    // 1 feature, 2 scenarios: uno pass (con 3 steps pass) y uno fail (con 1 step fail) —
    // a nivel step sería 75% pass / 25% fail; a nivel scenario debe ser 50/50.
    const html = buildQaSummaryCommentHtml(
      session([
        feature('Checkout', [
          scenario('Compra exitosa', ['pass', 'pass', 'pass']),
          scenario('Compra rechazada', ['fail']),
        ]),
      ]),
    );

    expect(html).toContain('Aprobado: 50% (1/2)');
    expect(html).toContain('Fallido: 50% (1/2)');
    expect(html).toContain('Omitido: 0% (0/2)');
  });

  it('un scenario con 2 steps pass y 1 skip cuenta como 1 scenario OMITIDO en el resumen, no como "2 pass"', () => {
    const html = buildQaSummaryCommentHtml(
      session([feature('Reportes', [scenario('Exportar CSV', ['pass', 'pass', 'skip'])])]),
    );

    expect(html).toContain('Aprobado: 0% (0/1)');
    expect(html).toContain('Omitido: 100% (1/1)');
  });

  it('con una sesión sin scenarios, los porcentajes son 0 (nunca NaN)', () => {
    const html = buildQaSummaryCommentHtml(session([]));

    expect(html).toContain('Aprobado: 0% (0/0)');
    expect(html).toContain('Fallido: 0% (0/0)');
    expect(html).toContain('Omitido: 0% (0/0)');
  });

  it('escapa caracteres HTML en nombres de feature/scenario', () => {
    const html = buildQaSummaryCommentHtml(
      session([feature('Login <admin>', [scenario('Caso "especial" & raro', ['pass'])])]),
    );

    expect(html).toContain('Login &lt;admin&gt;');
    expect(html).toContain('Caso &quot;especial&quot; &amp; raro');
    expect(html).not.toContain('<admin>');
  });
});

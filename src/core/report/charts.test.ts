import { describe, expect, it } from 'vitest';

import type { FeatureReportView, ScenarioReportView, StepReportView } from '../types/report.js';
import type { StepResult } from '../types/session.js';
import {
  RESULT_COLORS,
  RESULT_LABELS,
  RESULT_ORDER,
  buildFeatureBars,
  buildSunburstData,
  shouldShowFeatureBars,
  shouldShowSunburst,
} from './charts.js';

function step(result: StepResult, hasEvidence = false): StepReportView {
  return {
    id: `st-${Math.random()}`,
    keyword: 'Given',
    text: 'un paso de prueba',
    fromBackground: false,
    result,
    evidence: hasEvidence ? [{ id: 'ev-1', originalFilename: 'foto.png', kind: 'image', path: 'x' }] : [],
  };
}

function scenario(name: string, result: StepResult, steps: StepReportView[]): ScenarioReportView {
  return { id: `s-${name}`, name, tags: [], result, steps };
}

function feature(
  name: string,
  result: StepResult,
  scenarios: ScenarioReportView[],
  summary: FeatureReportView['summary'],
): FeatureReportView {
  return {
    id: `f-${name}`,
    slug: `f-${name}`,
    name,
    tags: [],
    result,
    summary,
    scenarios,
    detailPath: `features/f-${name}.html`,
  };
}

function summaryOf(pass: number, fail: number, skip: number, pending: number) {
  const total = pass + fail + skip + pending;
  return {
    pass,
    fail,
    skip,
    pending,
    total,
    passRatePercent: total === 0 ? 0 : Math.round((pass / total) * 100),
    completionPercent: total === 0 ? 0 : Math.round(((pass + fail + skip) / total) * 100),
  };
}

describe('paleta y etiquetas', () => {
  it('RESULT_COLORS/RESULT_LABELS/RESULT_ORDER cubren exactamente las 4 categorías de StepResult', () => {
    const categories: StepResult[] = ['pass', 'fail', 'skip', 'pending'];
    for (const category of categories) {
      expect(RESULT_COLORS[category]).toMatch(/^#[0-9a-f]{6}$/i);
      expect(RESULT_LABELS[category]).toBeTruthy();
    }
    expect(RESULT_ORDER).toEqual(categories);
  });
});

describe('shouldShowFeatureBars', () => {
  it('false con menos de 3 features', () => {
    const features = [
      feature('A', 'pass', [], summaryOf(1, 0, 0, 0)),
      feature('B', 'pass', [], summaryOf(1, 0, 0, 0)),
    ];
    expect(shouldShowFeatureBars(features)).toBe(false);
  });

  it('true con 3 o más features', () => {
    const features = [
      feature('A', 'pass', [], summaryOf(1, 0, 0, 0)),
      feature('B', 'pass', [], summaryOf(1, 0, 0, 0)),
      feature('C', 'pass', [], summaryOf(1, 0, 0, 0)),
    ];
    expect(shouldShowFeatureBars(features)).toBe(true);
  });
});

describe('buildFeatureBars', () => {
  it('mapea nombre/detailPath/conteos/passRatePercent de cada feature, ordenadas ascendente por passRatePercent', () => {
    const features = [
      feature('Checkout', 'fail', [], summaryOf(1, 1, 0, 0)), // 50%
      feature('Login', 'pass', [], summaryOf(2, 0, 0, 0)), // 100%
      feature('Reportes', 'fail', [], summaryOf(0, 1, 0, 0)), // 0%
    ];

    const bars = buildFeatureBars(features);

    expect(bars.map((bar) => bar.name)).toEqual(['Reportes', 'Checkout', 'Login']);
    expect(bars[0]).toEqual({
      name: 'Reportes',
      detailPath: 'features/f-Reportes.html',
      pass: 0,
      fail: 1,
      skip: 0,
      pending: 0,
      total: 1,
      passRatePercent: 0,
    });
  });

  it('con features vacías, devuelve un array vacío', () => {
    expect(buildFeatureBars([])).toEqual([]);
  });
});

describe('shouldShowSunburst', () => {
  it('false con menos de 3 features', () => {
    const features = [
      feature('A', 'pass', [scenario('s1', 'pass', []), scenario('s2', 'pass', [])], summaryOf(2, 0, 0, 0)),
      feature('B', 'pass', [scenario('s1', 'pass', []), scenario('s2', 'pass', [])], summaryOf(2, 0, 0, 0)),
    ];
    expect(shouldShowSunburst(features)).toBe(false);
  });

  it('false si alguna de las ≥3 features tiene menos de 2 scenarios', () => {
    const features = [
      feature('A', 'pass', [scenario('s1', 'pass', []), scenario('s2', 'pass', [])], summaryOf(2, 0, 0, 0)),
      feature('B', 'pass', [scenario('s1', 'pass', []), scenario('s2', 'pass', [])], summaryOf(2, 0, 0, 0)),
      feature('C', 'pass', [scenario('s1', 'pass', [])], summaryOf(1, 0, 0, 0)), // solo 1 scenario
    ];
    expect(shouldShowSunburst(features)).toBe(false);
  });

  it('true con ≥3 features, todas con ≥2 scenarios', () => {
    const twoScenarios = [scenario('s1', 'pass', []), scenario('s2', 'pass', [])];
    const features = [
      feature('A', 'pass', twoScenarios, summaryOf(2, 0, 0, 0)),
      feature('B', 'pass', twoScenarios, summaryOf(2, 0, 0, 0)),
      feature('C', 'pass', twoScenarios, summaryOf(2, 0, 0, 0)),
    ];
    expect(shouldShowSunburst(features)).toBe(true);
  });
});

describe('buildSunburstData', () => {
  it('produce un árbol feature→scenario→step con result y hasEvidence, nunca notas/defecto/evidencia completa', () => {
    const features = [
      feature(
        'Login',
        'fail',
        [
          scenario('Login OK', 'pass', [step('pass'), step('pass', true)]),
          scenario('Login fallido', 'fail', [step('fail')]),
        ],
        summaryOf(1, 1, 0, 0),
      ),
    ];

    const tree = buildSunburstData(features);

    expect(tree).toHaveLength(1);
    expect(tree[0].name).toBe('Login');
    expect(tree[0].result).toBe('fail');
    expect(tree[0].children).toHaveLength(2);

    const [okScenario, failScenario] = tree[0].children;
    expect(okScenario.name).toBe('Login OK');
    expect(okScenario.result).toBe('pass');
    expect(okScenario.children).toHaveLength(2);
    expect(okScenario.children[0]).toEqual({ name: 'Given: un paso de prueba', result: 'pass', hasEvidence: false });
    expect(okScenario.children[1]).toEqual({ name: 'Given: un paso de prueba', result: 'pass', hasEvidence: true });

    expect(failScenario.children[0].result).toBe('fail');
  });

  it('trunca el nombre de un step largo con elipsis en vez de repetir el texto completo', () => {
    const longText = 'a'.repeat(60);
    const features = [
      feature('F', 'pass', [scenario('S', 'pass', [step('pass')])], summaryOf(1, 0, 0, 0)),
    ];
    features[0].scenarios[0].steps[0].text = longText;

    const tree = buildSunburstData(features);
    const stepName = tree[0].children[0].children[0].name;

    expect(stepName.length).toBeLessThanOrEqual(40);
    expect(stepName.endsWith('…')).toBe(true);
    expect(stepName).not.toContain(longText);
  });

  it('con features vacías, devuelve un array vacío', () => {
    expect(buildSunburstData([])).toEqual([]);
  });
});

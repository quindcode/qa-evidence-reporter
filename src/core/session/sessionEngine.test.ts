import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { InvalidStepTransitionError, SessionNotFoundError } from '../types/errors.js';
import type { ParsedFeature } from '../types/parser.js';
import { deriveFeatureResult, deriveScenarioResult } from '../types/session.js';
import type { FeatureExecution, ScenarioExecution } from '../types/session.js';
import { createSessionEngine } from './sessionEngine.js';

/**
 * Dos features inline (sin pasar por `core/parser`, ver instrucciones de la
 * fase): "Login" con dos scenarios (3 steps cada uno) y "Logout" con un
 * scenario (2 steps). Total: 8 steps en 3 scenarios en 2 features, lo
 * suficiente para probar cruces de límite de scenario y de feature en
 * `next`/`previous`.
 */
function makeFeatures(): ParsedFeature[] {
  return [
    {
      name: 'Login',
      description: '',
      tags: ['@auth'],
      language: 'en',
      filePath: 'login.feature',
      scenarios: [
        {
          name: 'Successful login',
          tags: ['@smoke'],
          isOutlineExample: false,
          steps: [
            { keyword: 'Given', text: 'a registered user', fromBackground: false },
            { keyword: 'When', text: 'they submit valid credentials', fromBackground: false },
            { keyword: 'Then', text: 'they see the dashboard', fromBackground: false },
          ],
        },
        {
          name: 'Failed login',
          tags: [],
          isOutlineExample: false,
          steps: [
            { keyword: 'Given', text: 'a registered user', fromBackground: false },
            { keyword: 'When', text: 'they submit invalid credentials', fromBackground: false },
            { keyword: 'Then', text: 'they see an error', fromBackground: false },
          ],
        },
      ],
    },
    {
      name: 'Logout',
      description: '',
      tags: [],
      language: 'en',
      filePath: 'logout.feature',
      scenarios: [
        {
          name: 'Successful logout',
          tags: [],
          isOutlineExample: false,
          steps: [
            { keyword: 'Given', text: 'a logged in user', fromBackground: false },
            { keyword: 'When', text: 'they log out', fromBackground: false },
          ],
        },
      ],
    },
  ];
}

/** Clock determinístico: arranca en una fecha fija y avanza 1s en cada llamada. */
function makeClock(startIso = '2024-01-01T00:00:00.000Z'): () => string {
  let current = new Date(startIso).getTime();
  return () => {
    const iso = new Date(current).toISOString();
    current += 1000;
    return iso;
  };
}

describe('createSessionEngine', () => {
  let dir: string;
  let sessionFilePath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'qa-session-'));
    sessionFilePath = join(dir, '.qa-evidence-reporter', 'session.json');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  describe('createSession', () => {
    it('construye el árbol completo con steps pending, ids determinísticos y currentPosition inicial', async () => {
      const engine = createSessionEngine(sessionFilePath, { clock: makeClock() });
      const state = await engine.createSession(makeFeatures(), 'Mi Proyecto');

      expect(state.version).toBe(1);
      expect(state.projectName).toBe('Mi Proyecto');
      expect(state.status).toBe('in_progress');
      expect(state.currentPosition).toEqual({ featureIndex: 0, scenarioIndex: 0, stepIndex: 0 });
      expect(state.selectedFeatures).toHaveLength(2);

      const [login, logout] = state.selectedFeatures;
      expect(login.id).toBe('f0-login');
      expect(login.scenarios).toHaveLength(2);
      expect(login.scenarios[0].id).toBe('f0-login_s0-successful-login');
      expect(login.scenarios[0].steps).toHaveLength(3);
      expect(login.scenarios[0].steps[0].id).toBe('f0-login_s0-successful-login_st0');
      expect(login.scenarios[0].steps.every((step) => step.result === 'pending')).toBe(true);
      expect(login.scenarios[0].steps.every((step) => step.evidenceFileIds.length === 0)).toBe(
        true,
      );

      expect(logout.id).toBe('f1-logout');
    });

    it('regenerar la sesión con el mismo input produce siempre los mismos ids (reproducibilidad)', async () => {
      const engineA = createSessionEngine(join(dir, 'a.json'), { clock: makeClock() });
      const engineB = createSessionEngine(join(dir, 'b.json'), { clock: makeClock() });

      const stateA = await engineA.createSession(makeFeatures(), 'P');
      const stateB = await engineB.createSession(makeFeatures(), 'P');

      const idsA = stateA.selectedFeatures.flatMap((f) =>
        f.scenarios.flatMap((s) => s.steps.map((st) => st.id)),
      );
      const idsB = stateB.selectedFeatures.flatMap((f) =>
        f.scenarios.flatMap((s) => s.steps.map((st) => st.id)),
      );
      expect(idsA).toEqual(idsB);
    });
  });

  describe('getState / getCurrentStep', () => {
    it('lanza SessionNotFoundError si no se creó ni cargó ninguna sesión todavía', () => {
      const engine = createSessionEngine(sessionFilePath);
      expect(() => engine.getState()).toThrow(SessionNotFoundError);
    });

    it('getCurrentStep devuelve el step en currentPosition con sus ids de contexto', async () => {
      const engine = createSessionEngine(sessionFilePath, { clock: makeClock() });
      await engine.createSession(makeFeatures(), 'P');

      const current = engine.getCurrentStep();
      expect(current).not.toBeNull();
      expect(current?.featureId).toBe('f0-login');
      expect(current?.scenarioId).toBe('f0-login_s0-successful-login');
      expect(current?.step.id).toBe('f0-login_s0-successful-login_st0');
      expect(current?.step.step.text).toBe('a registered user');
    });
  });

  describe('navegación (next/previous/goTo)', () => {
    it('next() avanza step a step, cruzando de scenario a scenario y de feature a feature', async () => {
      const engine = createSessionEngine(sessionFilePath, { clock: makeClock() });
      await engine.createSession(makeFeatures(), 'P');

      const idsInOrder: string[] = [engine.getCurrentStep()!.step.id];
      for (let i = 0; i < 7; i++) {
        await engine.next();
        idsInOrder.push(engine.getCurrentStep()!.step.id);
      }

      expect(idsInOrder).toEqual([
        'f0-login_s0-successful-login_st0',
        'f0-login_s0-successful-login_st1',
        'f0-login_s0-successful-login_st2',
        'f0-login_s1-failed-login_st0',
        'f0-login_s1-failed-login_st1',
        'f0-login_s1-failed-login_st2',
        'f1-logout_s0-successful-logout_st0',
        'f1-logout_s0-successful-logout_st1',
      ]);
    });

    it('marca la sesión como completed al llegar al último step, y next() posterior es un no-op', async () => {
      const engine = createSessionEngine(sessionFilePath, { clock: makeClock() });
      let state = await engine.createSession(makeFeatures(), 'P');

      for (let i = 0; i < 7; i++) state = await engine.next();
      expect(state.status).toBe('in_progress');

      state = await engine.next();
      expect(state.status).toBe('completed');
      const lastPosition = state.currentPosition;

      state = await engine.next();
      expect(state.status).toBe('completed');
      expect(state.currentPosition).toEqual(lastPosition);
    });

    it('previous() retrocede, cruzando límites, y es un no-op en el primer step', async () => {
      const engine = createSessionEngine(sessionFilePath, { clock: makeClock() });
      await engine.createSession(makeFeatures(), 'P');

      await engine.next(); // st1
      await engine.next(); // st2
      await engine.next(); // scenario 2, st0
      let state = await engine.previous();
      expect(engine.getCurrentStep()?.step.id).toBe('f0-login_s0-successful-login_st2');

      state = await engine.previous();
      state = await engine.previous();
      expect(state.currentPosition).toEqual({ featureIndex: 0, scenarioIndex: 0, stepIndex: 0 });

      // no-op en el primer step
      const noop = await engine.previous();
      expect(noop.currentPosition).toEqual({ featureIndex: 0, scenarioIndex: 0, stepIndex: 0 });
    });

    it('goTo salta a una posición válida sin tocar datos de otros steps', async () => {
      const engine = createSessionEngine(sessionFilePath, { clock: makeClock() });
      await engine.createSession(makeFeatures(), 'P');

      const firstStepId = engine.getCurrentStep()!.step.id;
      await engine.setStepResult(firstStepId, 'pass');

      const state = await engine.goTo({ featureIndex: 1, scenarioIndex: 0, stepIndex: 1 });
      expect(state.currentPosition).toEqual({ featureIndex: 1, scenarioIndex: 0, stepIndex: 1 });

      // el resultado del primer step sigue intacto tras navegar.
      const firstStep = state.selectedFeatures[0].scenarios[0].steps[0];
      expect(firstStep.result).toBe('pass');
    });

    it('goTo lanza InvalidStepTransitionError con una posición fuera de rango', async () => {
      const engine = createSessionEngine(sessionFilePath, { clock: makeClock() });
      await engine.createSession(makeFeatures(), 'P');

      await expect(
        engine.goTo({ featureIndex: 99, scenarioIndex: 0, stepIndex: 0 }),
      ).rejects.toThrow(InvalidStepTransitionError);
    });
  });

  describe('setStepResult', () => {
    it('marca pass y setea timestamps startedAt/completedAt', async () => {
      const engine = createSessionEngine(sessionFilePath, { clock: makeClock() });
      await engine.createSession(makeFeatures(), 'P');
      const stepId = engine.getCurrentStep()!.step.id;

      const state = await engine.setStepResult(stepId, 'pass');
      const step = state.selectedFeatures[0].scenarios[0].steps[0];

      expect(step.result).toBe('pass');
      expect(step.timestamps.startedAt).toBeDefined();
      expect(step.timestamps.completedAt).toBeDefined();
      expect(step.defectDescription).toBeUndefined();
    });

    it('lanza InvalidStepTransitionError al marcar fail sin defectDescription, sin mutar el step', async () => {
      const engine = createSessionEngine(sessionFilePath, { clock: makeClock() });
      await engine.createSession(makeFeatures(), 'P');
      const stepId = engine.getCurrentStep()!.step.id;

      await expect(engine.setStepResult(stepId, 'fail')).rejects.toThrow(
        InvalidStepTransitionError,
      );
      await expect(
        engine.setStepResult(stepId, 'fail', { defectDescription: '   ' }),
      ).rejects.toThrow(InvalidStepTransitionError);

      const state = engine.getState();
      const step = state.selectedFeatures[0].scenarios[0].steps[0];
      expect(step.result).toBe('pending');
    });

    it('marca fail con defectDescription, y limpiar el resultado a pass borra el defecto previo', async () => {
      const engine = createSessionEngine(sessionFilePath, { clock: makeClock() });
      await engine.createSession(makeFeatures(), 'P');
      const stepId = engine.getCurrentStep()!.step.id;

      let state = await engine.setStepResult(stepId, 'fail', { defectDescription: 'Botón roto' });
      let step = state.selectedFeatures[0].scenarios[0].steps[0];
      expect(step.result).toBe('fail');
      expect(step.defectDescription).toBe('Botón roto');

      state = await engine.setStepResult(stepId, 'pass');
      step = state.selectedFeatures[0].scenarios[0].steps[0];
      expect(step.result).toBe('pass');
      expect(step.defectDescription).toBeUndefined();
    });

    it('volver a pending limpia los timestamps', async () => {
      const engine = createSessionEngine(sessionFilePath, { clock: makeClock() });
      await engine.createSession(makeFeatures(), 'P');
      const stepId = engine.getCurrentStep()!.step.id;

      await engine.setStepResult(stepId, 'pass');
      const state = await engine.setStepResult(stepId, 'pending');
      const step = state.selectedFeatures[0].scenarios[0].steps[0];

      expect(step.timestamps.startedAt).toBeUndefined();
      expect(step.timestamps.completedAt).toBeUndefined();
    });

    it('lanza InvalidStepTransitionError si el stepId no existe', async () => {
      const engine = createSessionEngine(sessionFilePath, { clock: makeClock() });
      await engine.createSession(makeFeatures(), 'P');

      await expect(engine.setStepResult('no-existe', 'pass')).rejects.toThrow(
        InvalidStepTransitionError,
      );
    });
  });

  describe('evidencia y notas', () => {
    it('addEvidence es idempotente y removeEvidence quita el id', async () => {
      const engine = createSessionEngine(sessionFilePath, { clock: makeClock() });
      await engine.createSession(makeFeatures(), 'P');
      const stepId = engine.getCurrentStep()!.step.id;

      await engine.addEvidence(stepId, 'ev-1');
      let state = await engine.addEvidence(stepId, 'ev-1'); // duplicado, no debe agregarse de nuevo
      let step = state.selectedFeatures[0].scenarios[0].steps[0];
      expect(step.evidenceFileIds).toEqual(['ev-1']);

      state = await engine.addEvidence(stepId, 'ev-2');
      step = state.selectedFeatures[0].scenarios[0].steps[0];
      expect(step.evidenceFileIds).toEqual(['ev-1', 'ev-2']);

      state = await engine.removeEvidence(stepId, 'ev-1');
      step = state.selectedFeatures[0].scenarios[0].steps[0];
      expect(step.evidenceFileIds).toEqual(['ev-2']);
    });

    it('addNotes reemplaza la nota del step', async () => {
      const engine = createSessionEngine(sessionFilePath, { clock: makeClock() });
      await engine.createSession(makeFeatures(), 'P');
      const stepId = engine.getCurrentStep()!.step.id;

      const state = await engine.addNotes(stepId, 'Ojo con el timeout');
      const step = state.selectedFeatures[0].scenarios[0].steps[0];
      expect(step.notes).toBe('Ojo con el timeout');
    });
  });

  describe('persistencia (save/load)', () => {
    it('round-trip: guardar y volver a cargar desde el mismo path reproduce el mismo estado', async () => {
      const engineA = createSessionEngine(sessionFilePath, { clock: makeClock() });
      const created = await engineA.createSession(makeFeatures(), 'P');
      const stepId = created.selectedFeatures[0].scenarios[0].steps[0].id;
      await engineA.setStepResult(stepId, 'fail', { defectDescription: 'X' });
      await engineA.addEvidence(stepId, 'ev-1');
      await engineA.next();

      const engineB = createSessionEngine(sessionFilePath);
      const loaded = await engineB.load();

      expect(loaded).toEqual(engineA.getState());
    });

    it('lanza SessionNotFoundError al cargar un path inexistente', async () => {
      const engine = createSessionEngine(join(dir, 'no-existe', 'session.json'));
      await expect(engine.load()).rejects.toThrow(SessionNotFoundError);
    });

    it('persiste automáticamente en disco tras cada mutación (autosave)', async () => {
      const engine = createSessionEngine(sessionFilePath, { clock: makeClock() });
      await engine.createSession(makeFeatures(), 'P');

      const raw = await readFile(sessionFilePath, 'utf-8');
      const onDisk = JSON.parse(raw);
      expect(onDisk.projectName).toBe('P');
      expect(onDisk.status).toBe('in_progress');
    });
  });

  describe('close', () => {
    it('borra session.json del disco y limpia el estado en memoria', async () => {
      const engine = createSessionEngine(sessionFilePath, { clock: makeClock() });
      await engine.createSession(makeFeatures(), 'P');

      await engine.close();

      expect(existsSync(sessionFilePath)).toBe(false);
      expect(() => engine.getState()).toThrow(SessionNotFoundError);
    });

    it('después de close(), createSession() puede volver a llamarse sin problema', async () => {
      const engine = createSessionEngine(sessionFilePath, { clock: makeClock() });
      await engine.createSession(makeFeatures(), 'P');
      await engine.close();

      const recreated = await engine.createSession(makeFeatures(), 'Otro proyecto');
      expect(recreated.projectName).toBe('Otro proyecto');
    });

    it('es no-op (no lanza) si se llama sin haber creado/cargado ninguna sesión', async () => {
      const engine = createSessionEngine(sessionFilePath);
      await expect(engine.close()).resolves.toBeUndefined();
    });

    it('es no-op (no lanza) si se llama dos veces seguidas', async () => {
      const engine = createSessionEngine(sessionFilePath, { clock: makeClock() });
      await engine.createSession(makeFeatures(), 'P');

      await engine.close();
      await expect(engine.close()).resolves.toBeUndefined();
    });
  });
});

describe('deriveScenarioResult / deriveFeatureResult', () => {
  function scenarioWith(results: Array<'pass' | 'fail' | 'skip' | 'pending'>): ScenarioExecution {
    return {
      id: 's',
      name: 'S',
      tags: [],
      steps: results.map((result, index) => ({
        id: `st${index}`,
        step: { keyword: 'Given', text: 't', fromBackground: false },
        result,
        evidenceFileIds: [],
        timestamps: {},
      })),
    };
  }

  it('fail tiene prioridad sobre todo lo demás', () => {
    expect(deriveScenarioResult(scenarioWith(['pass', 'fail', 'pending']))).toBe('fail');
  });

  it('pending tiene prioridad sobre skip y pass si no hay fail', () => {
    expect(deriveScenarioResult(scenarioWith(['pass', 'pending', 'skip']))).toBe('pending');
  });

  it('skip tiene prioridad sobre pass si no hay fail ni pending', () => {
    expect(deriveScenarioResult(scenarioWith(['pass', 'skip']))).toBe('skip');
  });

  it('pass solo si todos los steps son pass', () => {
    expect(deriveScenarioResult(scenarioWith(['pass', 'pass']))).toBe('pass');
  });

  it('deriveFeatureResult aplica la misma prioridad un nivel más arriba', () => {
    const feature: FeatureExecution = {
      id: 'f',
      name: 'F',
      tags: [],
      scenarios: [scenarioWith(['pass']), scenarioWith(['fail'])],
    };
    expect(deriveFeatureResult(feature)).toBe('fail');
  });
});

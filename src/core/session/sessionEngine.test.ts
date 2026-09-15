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

    it('setea sourceFilePath en cada FeatureExecution, igual a ParsedFeature.filePath', async () => {
      const engine = createSessionEngine(sessionFilePath, { clock: makeClock() });
      const state = await engine.createSession(makeFeatures(), 'P');

      expect(state.selectedFeatures[0].sourceFilePath).toBe('login.feature');
      expect(state.selectedFeatures[1].sourceFilePath).toBe('logout.feature');
    });
  });

  describe('addFeatures', () => {
    /** Una tercera feature ("Settings"), para agregar a una sesión ya creada con `makeFeatures()`. */
    function makeExtraFeature(): ParsedFeature {
      return {
        name: 'Settings',
        description: '',
        tags: [],
        language: 'en',
        filePath: 'settings.feature',
        scenarios: [
          {
            name: 'Change password',
            tags: [],
            isOutlineExample: false,
            steps: [
              { keyword: 'Given', text: 'a logged in user', fromBackground: false },
              { keyword: 'When', text: 'they change their password', fromBackground: false },
            ],
          },
        ],
      };
    }

    it('apéndiza la feature al final de selectedFeatures, continuando la secuencia de ids, sin tocar las existentes', async () => {
      const engine = createSessionEngine(sessionFilePath, { clock: makeClock() });
      const created = await engine.createSession(makeFeatures(), 'P');
      await engine.setStepResult(created.selectedFeatures[0].scenarios[0].steps[0].id, 'pass');

      const state = await engine.addFeatures([makeExtraFeature()]);

      expect(state.selectedFeatures).toHaveLength(3);
      const settings = state.selectedFeatures[2];
      expect(settings.id).toBe('f2-settings');
      expect(settings.sourceFilePath).toBe('settings.feature');
      expect(settings.scenarios[0].steps.every((step) => step.result === 'pending')).toBe(true);

      // Las dos features originales (y el resultado ya marcado en la
      // primera) quedan intactas.
      expect(state.selectedFeatures[0].id).toBe('f0-login');
      expect(state.selectedFeatures[0].scenarios[0].steps[0].result).toBe('pass');
      expect(state.selectedFeatures[1].id).toBe('f1-logout');
    });

    it('mueve currentPosition al primer step de la primera feature agregada', async () => {
      const engine = createSessionEngine(sessionFilePath, { clock: makeClock() });
      await engine.createSession(makeFeatures(), 'P');
      await engine.next(); // se aleja de la posición inicial, para que el assert de abajo sea significativo.

      const state = await engine.addFeatures([makeExtraFeature()]);

      expect(state.currentPosition).toEqual({ featureIndex: 2, scenarioIndex: 0, stepIndex: 0 });
    });

    it('si la sesión ya estaba "completed", vuelve a "in_progress" tras agregar', async () => {
      const engine = createSessionEngine(sessionFilePath, { clock: makeClock() });
      await engine.createSession(makeFeatures(), 'P');
      // 8 steps en total (ver `makeFeatures`) — mismo patrón que el test de
      // "marca la sesión como completed" más abajo: 7 `next()` llegan al
      // último step, el 8vo cruza el final y recién ahí `status` pasa a
      // 'completed'.
      for (let i = 0; i < 8; i++) await engine.next();
      expect(engine.getState().status).toBe('completed');

      const state = await engine.addFeatures([makeExtraFeature()]);

      expect(state.status).toBe('in_progress');
    });

    it('lanza SessionNotFoundError si todavía no hay ninguna sesión creada', async () => {
      const engine = createSessionEngine(sessionFilePath);

      await expect(engine.addFeatures([makeExtraFeature()])).rejects.toThrow(
        SessionNotFoundError,
      );
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

    it('regresión: next() sigue avanzando tras retroceder desde una sesión ya "completed" (no debe quedar pegado)', async () => {
      // Bug real reportado: al llegar al final, `status` pasa a 'completed' y
      // se queda así para siempre (nada lo revierte a 'in_progress'). next()
      // comprobaba `status === 'completed'` como primer chequeo y devolvía
      // no-op SIEMPRE a partir de ahí, sin importar la posición — así que
      // retroceder para revisar/editar un step anterior dejaba "Siguiente"
      // roto (mientras "Anterior" seguía funcionando con normalidad).
      const engine = createSessionEngine(sessionFilePath, { clock: makeClock() });
      await engine.createSession(makeFeatures(), 'P');

      for (let i = 0; i < 8; i++) await engine.next(); // llega al último step (8 steps en total)
      let state = engine.getState();
      expect(state.status).toBe('completed');

      state = await engine.previous(); // retrocede a revisar/editar un step anterior
      const positionAfterBack = state.currentPosition;
      expect(state.status).toBe('completed'); // status no se revierte solo, es esperado

      state = await engine.next(); // debe volver a avanzar, no quedar pegado
      expect(state.currentPosition).not.toEqual(positionAfterBack);
      expect(engine.getCurrentStep()?.step.id).toBe('f1-logout_s0-successful-logout_st1');
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

    it('marcar un step como skip cascada a TODOS los steps del scenario, pisando resultados previos (pass/fail)', async () => {
      const engine = createSessionEngine(sessionFilePath, { clock: makeClock() });
      await engine.createSession(makeFeatures(), 'P');
      const [firstStepId, secondStepId, thirdStepId] =
        engine.getState().selectedFeatures[0].scenarios[0].steps.map((step) => step.id);

      await engine.setStepResult(firstStepId, 'pass');
      await engine.setStepResult(secondStepId, 'fail', { defectDescription: 'Botón roto' });

      const state = await engine.setStepResult(thirdStepId, 'skip');
      const steps = state.selectedFeatures[0].scenarios[0].steps;

      expect(steps.map((step) => step.result)).toEqual(['skip', 'skip', 'skip']);
      // El defecto del step que estaba en "fail" se limpia junto con el resto —
      // un scenario omitido no puede seguir cargando un defecto pendiente.
      expect(steps[1].defectDescription).toBeUndefined();
      expect(steps.every((step) => step.timestamps.completedAt)).toBe(true);
    });

    it('la cascada de skip no se filtra a otros scenarios/features', async () => {
      const engine = createSessionEngine(sessionFilePath, { clock: makeClock() });
      await engine.createSession(makeFeatures(), 'P');
      const firstScenarioStepId = engine.getState().selectedFeatures[0].scenarios[0].steps[0].id;

      const state = await engine.setStepResult(firstScenarioStepId, 'skip');
      const otherScenarioSteps = state.selectedFeatures[0].scenarios[1].steps;

      expect(otherScenarioSteps.every((step) => step.result === 'pending')).toBe(true);
    });

    it('marcar un step como fail cascada a TODOS los steps del scenario con el MISMO defecto, y no se filtra a otros scenarios', async () => {
      const engine = createSessionEngine(sessionFilePath, { clock: makeClock() });
      await engine.createSession(makeFeatures(), 'P');
      const [firstStepId, secondStepId] =
        engine.getState().selectedFeatures[0].scenarios[0].steps.map((step) => step.id);

      await engine.setStepResult(firstStepId, 'pass');
      const state = await engine.setStepResult(secondStepId, 'fail', {
        defectDescription: 'Botón roto',
      });
      const steps = state.selectedFeatures[0].scenarios[0].steps;

      // Un scenario roto queda roto COMPLETO — inclusive el step que ya
      // estaba en pass antes del fail, y el tercero que ni se había
      // ejecutado.
      expect(steps.map((step) => step.result)).toEqual(['fail', 'fail', 'fail']);
      expect(steps.every((step) => step.defectDescription === 'Botón roto')).toBe(true);
      expect(steps.every((step) => step.timestamps.completedAt)).toBe(true);

      const otherScenarioSteps = state.selectedFeatures[0].scenarios[1].steps;
      expect(otherScenarioSteps.every((step) => step.result === 'pending')).toBe(true);
    });

    it('fail salta currentPosition directo al primer step del SIGUIENTE scenario, sin recorrer el resto del actual', async () => {
      const engine = createSessionEngine(sessionFilePath, { clock: makeClock() });
      await engine.createSession(makeFeatures(), 'P');
      // Falla el PRIMER step de "Successful login" (scenario 0 de "Login"):
      // según la cascada, los otros dos steps de ese scenario deberían
      // marcarse fail sin necesidad de visitarlos, y la sesión debería
      // saltar directo al scenario "Failed login" (scenario 1).
      const firstStepId = engine.getState().selectedFeatures[0].scenarios[0].steps[0].id;

      const state = await engine.setStepResult(firstStepId, 'fail', {
        defectDescription: 'Pantalla en blanco',
      });

      expect(state.currentPosition).toEqual({ featureIndex: 0, scenarioIndex: 1, stepIndex: 0 });
      expect(engine.getCurrentStep()?.scenarioId).toBe(
        state.selectedFeatures[0].scenarios[1].id,
      );
    });

    it('fail en el ÚLTIMO scenario de la sesión la marca "completed" (no hay a dónde saltar)', async () => {
      const engine = createSessionEngine(sessionFilePath, { clock: makeClock() });
      await engine.createSession(makeFeatures(), 'P');
      // Único scenario de "Logout", la última feature — no hay ningún
      // scenario después al cual saltar.
      const lastScenarioStepId =
        engine.getState().selectedFeatures[1].scenarios[0].steps[0].id;

      const state = await engine.setStepResult(lastScenarioStepId, 'fail', {
        defectDescription: 'Sesión no cierra',
      });

      expect(state.status).toBe('completed');
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

  describe('editScenario', () => {
    /**
     * Feature dedicada (no `makeFeatures()`, compartida por el resto del
     * archivo): necesita un step de Background, un scenario Outline
     * expandido y `sourceLocation` en scenarios/steps propios — nada de eso
     * hace falta para el resto de los tests de este archivo.
     */
    function makeEditableFeatures(): ParsedFeature[] {
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
              sourceLocation: { line: 3 },
              steps: [
                { keyword: 'Given', text: 'the store is open', fromBackground: true },
                {
                  keyword: 'When',
                  text: 'a registered user',
                  fromBackground: false,
                  sourceLocation: { line: 4 },
                },
                {
                  keyword: 'Then',
                  text: 'they see the dashboard',
                  fromBackground: false,
                  sourceLocation: { line: 5 },
                },
              ],
            },
            {
              name: 'Cart total row',
              tags: [],
              isOutlineExample: true,
              steps: [{ keyword: 'Given', text: 'a cart total of 100', fromBackground: false }],
            },
          ],
        },
      ];
    }

    it('corrige el nombre del scenario y el texto de un step propio, sin tocar el step de Background', async () => {
      const engine = createSessionEngine(sessionFilePath, { clock: makeClock() });
      const created = await engine.createSession(makeEditableFeatures(), 'P');
      const scenario = created.selectedFeatures[0].scenarios[0];
      const ownStepId = scenario.steps[1].id;
      const backgroundStepId = scenario.steps[0].id;

      const updated = await engine.editScenario(scenario.id, {
        name: 'Successful login (fixed)',
        steps: [{ stepId: ownStepId, text: 'a registered admin user' }],
      });

      const updatedScenario = updated.selectedFeatures[0].scenarios[0];
      expect(updatedScenario.name).toBe('Successful login (fixed)');
      expect(updatedScenario.steps[1].step.text).toBe('a registered admin user');
      // El resto de los campos del step editado se conserva (keyword, fromBackground, sourceLocation).
      expect(updatedScenario.steps[1].step.keyword).toBe('When');
      expect(updatedScenario.steps[1].step.sourceLocation).toEqual({ line: 4 });
      // El step de Background queda intacto.
      const backgroundStep = updatedScenario.steps.find((s) => s.id === backgroundStepId)!;
      expect(backgroundStep.step.text).toBe('the store is open');
    });

    it('rechaza editar un step de Background (aunque el resto del scenario siga pending)', async () => {
      const engine = createSessionEngine(sessionFilePath, { clock: makeClock() });
      const created = await engine.createSession(makeEditableFeatures(), 'P');
      const scenario = created.selectedFeatures[0].scenarios[0];
      const backgroundStepId = scenario.steps[0].id;

      await expect(
        engine.editScenario(scenario.id, { steps: [{ stepId: backgroundStepId, text: 'x' }] }),
      ).rejects.toBeInstanceOf(InvalidStepTransitionError);
    });

    it('rechaza editar un scenario que proviene de un Scenario Outline', async () => {
      const engine = createSessionEngine(sessionFilePath, { clock: makeClock() });
      const created = await engine.createSession(makeEditableFeatures(), 'P');
      const outlineScenario = created.selectedFeatures[0].scenarios[1];

      await expect(
        engine.editScenario(outlineScenario.id, { name: 'x' }),
      ).rejects.toBeInstanceOf(InvalidStepTransitionError);
    });

    it('rechaza editar un scenario apenas cualquiera de sus steps tiene un resultado asignado', async () => {
      const engine = createSessionEngine(sessionFilePath, { clock: makeClock() });
      const created = await engine.createSession(makeEditableFeatures(), 'P');
      const scenario = created.selectedFeatures[0].scenarios[0];
      const ownStepId = scenario.steps[1].id;

      // "skip" cascada al resto de los steps del scenario (ver `setStepResult`) — el caso de
      // prueba completo queda bloqueado, no solo el step marcado.
      await engine.setStepResult(scenario.steps[0].id, 'skip');

      await expect(
        engine.editScenario(scenario.id, { steps: [{ stepId: ownStepId, text: 'x' }] }),
      ).rejects.toBeInstanceOf(InvalidStepTransitionError);
    });

    it('rechaza scenarioId/stepId desconocidos', async () => {
      const engine = createSessionEngine(sessionFilePath, { clock: makeClock() });
      const created = await engine.createSession(makeEditableFeatures(), 'P');
      const scenario = created.selectedFeatures[0].scenarios[0];

      await expect(engine.editScenario('no-existe', { name: 'x' })).rejects.toBeInstanceOf(
        InvalidStepTransitionError,
      );
      await expect(
        engine.editScenario(scenario.id, { steps: [{ stepId: 'no-existe', text: 'x' }] }),
      ).rejects.toBeInstanceOf(InvalidStepTransitionError);
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

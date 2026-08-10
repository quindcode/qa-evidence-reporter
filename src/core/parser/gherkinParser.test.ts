import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { FeatureParseError } from '../types/errors.js';
import { createGherkinParser } from './gherkinParser.js';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__');
const fixture = (name: string): string => join(fixturesDir, name);

describe('createGherkinParser', () => {
  const parser = createGherkinParser();

  describe('parseFile', () => {
    it('parsea una feature simple en inglés', async () => {
      const feature = await parser.parseFile(fixture('simple.feature'));

      expect(feature.name).toBe('Login');
      expect(feature.language).toBe('en');
      expect(feature.tags).toEqual([]);
      expect(feature.scenarios).toHaveLength(1);

      const [scenario] = feature.scenarios;
      expect(scenario.name).toBe('Successful login with valid credentials');
      expect(scenario.isOutlineExample).toBe(false);
      expect(scenario.steps).toHaveLength(3);
      expect(scenario.steps.map((s) => s.keyword)).toEqual(['Given', 'When', 'Then']);
      expect(scenario.steps.every((s) => !s.fromBackground)).toBe(true);
      expect(scenario.steps[1].text).toBe('they submit valid credentials');
    });

    it('parsea una feature en español vía "# language: es" y normaliza los keywords a inglés', async () => {
      const feature = await parser.parseFile(fixture('spanish.feature'));

      expect(feature.language).toBe('es');
      expect(feature.name).toBe('Inicio de sesión');
      expect(feature.scenarios).toHaveLength(1);

      const [scenario] = feature.scenarios;
      expect(scenario.name).toBe('Inicio de sesión exitoso con credenciales válidas');
      // Dado/Cuando/Entonces deben normalizarse a la forma canónica en inglés.
      expect(scenario.steps.map((s) => s.keyword)).toEqual(['Given', 'When', 'Then']);
      expect(scenario.steps[0].text).toBe('un usuario registrado en la página de inicio de sesión');
    });

    it('incrusta los pasos de Background al inicio de cada escenario', async () => {
      const feature = await parser.parseFile(fixture('background.feature'));

      expect(feature.scenarios).toHaveLength(2);
      const [addItem, removeItem] = feature.scenarios;

      // Background (2 pasos) + 2 pasos propios = 4.
      expect(addItem.steps).toHaveLength(4);
      expect(addItem.steps.slice(0, 2).every((s) => s.fromBackground)).toBe(true);
      expect(addItem.steps.slice(2).every((s) => !s.fromBackground)).toBe(true);
      expect(addItem.steps.map((s) => s.keyword)).toEqual(['Given', 'Given', 'When', 'Then']);
      expect(addItem.steps[0].text).toBe('the store is open');
      expect(addItem.steps[1].text).toBe('the catalog has items');

      // Background (2 pasos) + 3 pasos propios = 5.
      expect(removeItem.steps).toHaveLength(5);
      expect(removeItem.steps.slice(0, 2).every((s) => s.fromBackground)).toBe(true);
      expect(removeItem.steps.slice(2).every((s) => !s.fromBackground)).toBe(true);
    });

    it('expande un Scenario Outline con Examples a escenarios concretos', async () => {
      const feature = await parser.parseFile(fixture('outline.feature'));

      expect(feature.scenarios).toHaveLength(2);
      const [first, second] = feature.scenarios;

      expect(first.isOutlineExample).toBe(true);
      expect(first.exampleValues).toEqual({ total: '100', coupon: 'SAVE10', final: '90' });
      expect(first.steps.map((s) => s.text)).toEqual([
        'a cart total of 100',
        'a "SAVE10" coupon is applied',
        'the final total is 90',
      ]);

      expect(second.isOutlineExample).toBe(true);
      expect(second.exampleValues).toEqual({ total: '200', coupon: 'SAVE20', final: '160' });
      expect(second.steps.map((s) => s.text)).toEqual([
        'a cart total of 200',
        'a "SAVE20" coupon is applied',
        'the final total is 160',
      ]);
    });

    it('lee tags de Feature y de Scenario por separado', async () => {
      const feature = await parser.parseFile(fixture('tags.feature'));

      expect(feature.tags).toEqual(['@regression']);
      expect(feature.scenarios).toHaveLength(2);

      const [smokeScenario, declinedScenario] = feature.scenarios;
      expect(smokeScenario.tags).toEqual(['@smoke', '@critical']);
      expect(declinedScenario.tags).toEqual([]);
    });

    it('lanza FeatureParseError (no un Error genérico) ante sintaxis Gherkin inválida', async () => {
      const invalidPath = fixture('invalid/broken.feature');

      const error = await parser.parseFile(invalidPath).catch((e) => e);

      expect(error).toBeInstanceOf(FeatureParseError);
      expect((error as FeatureParseError).code).toBe('FEATURE_PARSE_ERROR');
      expect((error as FeatureParseError).message).toContain(invalidPath);
    });
  });

  describe('parseDirectory', () => {
    it('busca archivos .feature recursivamente en subdirectorios', async () => {
      const features = await parser.parseDirectory(fixture('nested'));

      expect(features).toHaveLength(1);
      expect(features[0].name).toBe('Nested feature used to test recursive directory scanning');
    });

    it('propaga FeatureParseError cuando algún .feature del directorio es inválido', async () => {
      await expect(parser.parseDirectory(fixture('invalid'))).rejects.toBeInstanceOf(
        FeatureParseError,
      );
    });
  });
});

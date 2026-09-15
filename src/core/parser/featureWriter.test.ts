import { describe, expect, it, vi } from 'vitest';

import { FeatureSourceDriftError } from '../types/errors.js';
import { applyFeatureTextEdit, createFeatureWriter, type ScenarioTextEdit } from './featureWriter.js';

const SOURCE = [
  'Feature: Login',
  '',
  '  Scenario: Succesful login',
  '    Given a registered user on the login page',
  '    When they submit valid credentials',
  '    Then they see the dashboard',
  '',
].join('\n');

describe('applyFeatureTextEdit', () => {
  it('reescribe el nombre del scenario y el texto de un step, preservando indentación y el resto del archivo', () => {
    const edit: ScenarioTextEdit = {
      name: { line: 3, oldText: 'Succesful login', newText: 'Successful login' },
      steps: [{ line: 4, oldText: 'a registered user on the login page', newText: 'a registered user' }],
    };

    const result = applyFeatureTextEdit(SOURCE, '/tmp/login.feature', edit);
    const lines = result.split('\n');

    expect(lines[2]).toBe('  Scenario: Successful login');
    expect(lines[3]).toBe('    Given a registered user');
    // El resto del archivo queda intacto.
    expect(lines[0]).toBe('Feature: Login');
    expect(lines[4]).toBe('    When they submit valid credentials');
    expect(lines[5]).toBe('    Then they see the dashboard');
  });

  it('preserva CRLF cuando el archivo original lo usa', () => {
    const crlfSource = SOURCE.split('\n').join('\r\n');
    const edit: ScenarioTextEdit = {
      steps: [{ line: 6, oldText: 'they see the dashboard', newText: 'they land on the dashboard' }],
    };

    const result = applyFeatureTextEdit(crlfSource, '/tmp/login.feature', edit);

    expect(result).toContain('\r\n');
    expect(result.split('\r\n')[5]).toBe('    Then they land on the dashboard');
  });

  it('lanza FeatureSourceDriftError (sin aplicar NINGÚN cambio) si una línea no termina con el oldText esperado', () => {
    const edit: ScenarioTextEdit = {
      name: { line: 3, oldText: 'Succesful login', newText: 'Successful login' },
      steps: [{ line: 4, oldText: 'texto que ya no está en el archivo', newText: 'nuevo texto' }],
    };

    expect(() => applyFeatureTextEdit(SOURCE, '/tmp/login.feature', edit)).toThrow(
      FeatureSourceDriftError,
    );
  });

  it('lanza FeatureSourceDriftError si la línea pedida está fuera de rango', () => {
    const edit: ScenarioTextEdit = {
      steps: [{ line: 999, oldText: 'lo que sea', newText: 'nuevo' }],
    };

    expect(() => applyFeatureTextEdit(SOURCE, '/tmp/login.feature', edit)).toThrow(
      FeatureSourceDriftError,
    );
  });
});

describe('createFeatureWriter', () => {
  it('updateScenario lee, aplica el edit y escribe el resultado de vuelta al mismo archivo', async () => {
    const writeFile = vi.fn().mockResolvedValue(undefined);
    const writer = createFeatureWriter({
      readFile: vi.fn().mockResolvedValue(SOURCE),
      writeFile,
    });

    const edit: ScenarioTextEdit = {
      name: { line: 3, oldText: 'Succesful login', newText: 'Successful login' },
      steps: [],
    };
    await writer.updateScenario('/tmp/login.feature', edit);

    expect(writeFile).toHaveBeenCalledTimes(1);
    const [filePath, content] = writeFile.mock.calls[0] as [string, string];
    expect(filePath).toBe('/tmp/login.feature');
    expect(content).toContain('Scenario: Successful login');
  });

  it('updateScenario NO escribe nada si el edit no aplica limpiamente', async () => {
    const writeFile = vi.fn().mockResolvedValue(undefined);
    const writer = createFeatureWriter({
      readFile: vi.fn().mockResolvedValue(SOURCE),
      writeFile,
    });

    const edit: ScenarioTextEdit = {
      steps: [{ line: 4, oldText: 'texto que ya no está', newText: 'nuevo' }],
    };

    await expect(writer.updateScenario('/tmp/login.feature', edit)).rejects.toBeInstanceOf(
      FeatureSourceDriftError,
    );
    expect(writeFile).not.toHaveBeenCalled();
  });
});

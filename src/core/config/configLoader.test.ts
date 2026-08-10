import { describe, expect, it } from 'vitest';

import { ConfigNotFoundError, ConfigValidationError } from '../types/errors.js';
import { createConfigLoader } from './configLoader.js';

/** Loader con un `readFile` en memoria, para no tocar el filesystem real. */
function loaderWithFile(path: string, content: string) {
  return createConfigLoader({
    readFile: async (filePath) => {
      if (filePath !== path) {
        throw Object.assign(new Error(`ENOENT: no such file "${filePath}"`), { code: 'ENOENT' });
      }
      return content;
    },
  });
}

describe('createConfigLoader', () => {
  describe('loadConfig', () => {
    it('parsea una config completa y válida tal cual', async () => {
      const full = {
        projectName: 'Checkout QA',
        team: ['ana', 'bruno'],
        featuresDir: 'src/features',
        evidenceDir: 'captures',
        reportsDir: 'out/reports',
        server: { port: 4000, openBrowser: false },
        evidence: { maxFileSizeMB: 25, allowedFormats: ['png', 'pdf'] },
        logging: { level: 'debug' },
        reportTemplate: './my-template',
      };
      const loader = loaderWithFile('/proj/qa-config.json', JSON.stringify(full));

      const config = await loader.loadConfig('/proj/qa-config.json');

      expect(config).toEqual(full);
    });

    it('completa con defaults los campos ausentes de una config parcial, incluso dentro de objetos anidados', async () => {
      // Solo se define `server.port`; `server.openBrowser` y TODO lo demás
      // (incluyendo `logging`/`evidence` completos) debe quedar en su
      // default documentado en ARCHITECTURE.md.
      const partial = { projectName: 'Mi Proyecto', server: { port: 5050 } };
      const loader = loaderWithFile('/proj/qa-config.json', JSON.stringify(partial));

      const config = await loader.loadConfig('/proj/qa-config.json');

      expect(config.projectName).toBe('Mi Proyecto');
      expect(config.server).toEqual({ port: 5050, openBrowser: true });
      expect(config.featuresDir).toBe('features');
      expect(config.evidenceDir).toBe('evidence');
      expect(config.reportsDir).toBe('reports');
      expect(config.evidence).toEqual({
        maxFileSizeMB: 50,
        allowedFormats: ['png', 'jpg', 'jpeg', 'gif', 'mp4', 'webm', 'pdf'],
      });
      expect(config.logging).toEqual({ level: 'info' });
      expect(config.team).toEqual([]);
      expect(config.reportTemplate).toBeNull();
    });

    it('aplica todos los defaults documentados cuando el archivo es un objeto vacío', async () => {
      const loader = loaderWithFile('/proj/qa-config.json', '{}');

      const config = await loader.loadConfig('/proj/qa-config.json');

      expect(config).toEqual({
        projectName: 'Mi Proyecto QA',
        team: [],
        featuresDir: 'features',
        evidenceDir: 'evidence',
        reportsDir: 'reports',
        server: { port: 3000, openBrowser: true },
        evidence: {
          maxFileSizeMB: 50,
          allowedFormats: ['png', 'jpg', 'jpeg', 'gif', 'mp4', 'webm', 'pdf'],
        },
        logging: { level: 'info' },
        reportTemplate: null,
      });
    });

    it('lanza ConfigValidationError, mencionando el campo, cuando un tipo es incorrecto', async () => {
      const invalid = { server: { port: 'no-es-un-numero' } };
      const loader = loaderWithFile('/proj/qa-config.json', JSON.stringify(invalid));

      await expect(loader.loadConfig('/proj/qa-config.json')).rejects.toSatisfy(
        (error: unknown) => {
          expect(error).toBeInstanceOf(ConfigValidationError);
          const configError = error as ConfigValidationError;
          expect(configError.code).toBe('CONFIG_VALIDATION_ERROR');
          expect(configError.issues).toEqual([expect.objectContaining({ path: 'server.port' })]);
          expect(configError.message).toContain('server.port');
          return true;
        },
      );
    });

    it('lanza ConfigValidationError cuando el archivo no contiene JSON válido', async () => {
      const loader = loaderWithFile('/proj/qa-config.json', '{ esto no es json');

      await expect(loader.loadConfig('/proj/qa-config.json')).rejects.toBeInstanceOf(
        ConfigValidationError,
      );
    });

    it('lanza ConfigNotFoundError si el archivo no existe', async () => {
      const loader = loaderWithFile('/proj/qa-config.json', '{}');

      await expect(loader.loadConfig('/otro-proyecto/qa-config.json')).rejects.toSatisfy(
        (error: unknown) => {
          expect(error).toBeInstanceOf(ConfigNotFoundError);
          expect((error as ConfigNotFoundError).code).toBe('CONFIG_NOT_FOUND');
          expect((error as ConfigNotFoundError).configFilePath).toBe(
            '/otro-proyecto/qa-config.json',
          );
          return true;
        },
      );
    });
  });
});

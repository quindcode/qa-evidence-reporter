import { describe, expect, it } from 'vitest';

import { QaConfigSchema } from '../../core/types/config.js';
import type { QaConfig } from '../../core/types/config.js';
import { QaError } from '../../core/types/errors.js';
import { createSettingsService } from './settingsService.js';

function makeConfig(overrides: Partial<QaConfig> = {}): QaConfig {
  return QaConfigSchema.parse({ projectName: 'Proyecto Demo', ...overrides });
}

/** `configLoader` en memoria — registra cada `saveConfig` sin tocar disco, mismo criterio que los tests de `configLoader.test.ts`. */
function fakeConfigLoader() {
  const writes: Array<{ filePath: string; config: QaConfig }> = [];
  return {
    writes,
    configLoader: {
      loadConfig: async () => {
        throw new Error('no debería llamarse — el servicio arranca con `initialConfig` en memoria');
      },
      saveConfig: async (filePath: string, config: QaConfig) => {
        writes.push({ filePath, config });
      },
    },
  };
}

describe('createSettingsService', () => {
  describe('getPublicSettings', () => {
    it('expone projectName/jira/azureDevOps sin secretos, con tokenConfigured derivado', () => {
      const config = makeConfig({
        jira: { baseUrl: 'https://tuempresa.atlassian.net', email: 'qa@tuempresa.com' },
        azureDevOps: { organizationUrl: 'https://dev.azure.com/tuorg', project: 'Checkout' },
      });
      const service = createSettingsService('/proj/qa-config.json', config, 'token-secreto', undefined);

      const settings = service.getPublicSettings();

      expect(settings).toEqual({
        projectName: 'Proyecto Demo',
        jira: {
          baseUrl: 'https://tuempresa.atlassian.net',
          email: 'qa@tuempresa.com',
          tokenConfigured: true,
        },
        azureDevOps: {
          organizationUrl: 'https://dev.azure.com/tuorg',
          project: 'Checkout',
          tokenConfigured: false,
        },
      });
      // El token en sí NUNCA aparece en el objeto — solo el booleano.
      expect(JSON.stringify(settings)).not.toContain('token-secreto');
    });
  });

  describe('updateSettings', () => {
    it('mezcla un patch parcial sobre la config vigente y lo persiste vía saveConfig', async () => {
      const { configLoader, writes } = fakeConfigLoader();
      const config = makeConfig({
        team: ['Ana'],
        jira: { baseUrl: 'https://viejo.atlassian.net', email: 'vieja@empresa.com' },
      });
      const service = createSettingsService('/proj/qa-config.json', config, undefined, undefined, {
        configLoader,
      });

      const settings = await service.updateSettings({
        projectName: 'Nuevo Nombre',
        jira: { baseUrl: 'https://nuevo.atlassian.net' },
      });

      expect(settings.projectName).toBe('Nuevo Nombre');
      expect(settings.jira.baseUrl).toBe('https://nuevo.atlassian.net');
      // `email` no vino en el patch — se conserva el valor anterior.
      expect(settings.jira.email).toBe('vieja@empresa.com');

      expect(writes).toHaveLength(1);
      expect(writes[0].filePath).toBe('/proj/qa-config.json');
      // Campos NO tocados por el patch (fuera del alcance de settings, p. ej.
      // `team`) sobreviven intactos en lo que se persiste — `updateSettings`
      // mezcla sobre la config completa, no reemplaza el archivo entero por
      // solo lo que la UI de settings conoce.
      expect(writes[0].config.team).toEqual(['Ana']);
      expect(writes[0].config.projectName).toBe('Nuevo Nombre');
    });

    it('el patch se refleja de inmediato en getPublicSettings, incluso antes de que resuelva el saveConfig', async () => {
      const { configLoader } = fakeConfigLoader();
      const service = createSettingsService('/proj/qa-config.json', makeConfig(), undefined, undefined, {
        configLoader,
      });

      await service.updateSettings({ projectName: 'Otro nombre' });

      expect(service.getPublicSettings().projectName).toBe('Otro nombre');
    });

    it('rechaza un patch inválido (baseUrl que no es URL) sin persistir nada', async () => {
      const { configLoader, writes } = fakeConfigLoader();
      const service = createSettingsService('/proj/qa-config.json', makeConfig(), undefined, undefined, {
        configLoader,
      });

      await expect(
        service.updateSettings({ jira: { baseUrl: 'no-es-una-url' } }),
      ).rejects.toBeInstanceOf(QaError);
      expect(writes).toHaveLength(0);
    });

    it('permite volver un campo a null (desactivar Jira/Azure DevOps)', async () => {
      const { configLoader } = fakeConfigLoader();
      const config = makeConfig({
        jira: { baseUrl: 'https://tuempresa.atlassian.net', email: 'qa@tuempresa.com' },
      });
      const service = createSettingsService('/proj/qa-config.json', config, undefined, undefined, {
        configLoader,
      });

      const settings = await service.updateSettings({ jira: { baseUrl: null, email: null } });

      expect(settings.jira).toEqual({ baseUrl: null, email: null, tokenConfigured: false });
    });
  });

  describe('setJiraToken / setAzureToken', () => {
    it('solo viven en memoria — nunca llaman a saveConfig', async () => {
      const { configLoader, writes } = fakeConfigLoader();
      const service = createSettingsService('/proj/qa-config.json', makeConfig(), undefined, undefined, {
        configLoader,
      });

      service.setJiraToken('un-token');
      service.setAzureToken('un-pat');

      expect(service.getPublicSettings().jira.tokenConfigured).toBe(true);
      expect(service.getPublicSettings().azureDevOps.tokenConfigured).toBe(true);
      expect(service.getJiraCredentials().apiToken).toBe('un-token');
      expect(service.getAzureCredentials().personalAccessToken).toBe('un-pat');
      expect(writes).toHaveLength(0);
    });

    it('setJiraToken(null) limpia el token vigente', () => {
      const service = createSettingsService('/proj/qa-config.json', makeConfig(), 'token-inicial', undefined);

      expect(service.getPublicSettings().jira.tokenConfigured).toBe(true);
      service.setJiraToken(null);
      expect(service.getPublicSettings().jira.tokenConfigured).toBe(false);
      expect(service.getJiraCredentials().apiToken).toBeUndefined();
    });
  });

  describe('getJiraCredentials / getAzureCredentials', () => {
    it('combina baseUrl/email/organizationUrl/project vigentes con el token en memoria', () => {
      const config = makeConfig({
        jira: { baseUrl: 'https://tuempresa.atlassian.net', email: 'qa@tuempresa.com' },
        azureDevOps: { organizationUrl: 'https://dev.azure.com/tuorg', project: 'Checkout' },
      });
      const service = createSettingsService('/proj/qa-config.json', config, 'jira-token', 'azure-pat');

      expect(service.getJiraCredentials()).toEqual({
        baseUrl: 'https://tuempresa.atlassian.net',
        email: 'qa@tuempresa.com',
        apiToken: 'jira-token',
      });
      expect(service.getAzureCredentials()).toEqual({
        organizationUrl: 'https://dev.azure.com/tuorg',
        project: 'Checkout',
        personalAccessToken: 'azure-pat',
      });
    });
  });
});

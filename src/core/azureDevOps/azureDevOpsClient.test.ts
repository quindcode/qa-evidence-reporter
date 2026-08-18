import { describe, expect, it, vi } from 'vitest';

import {
  AzureDevOpsAuthenticationError,
  AzureDevOpsNotConfiguredError,
  AzureDevOpsRequestError,
  AzureDevOpsWorkItemNotFoundError,
} from '../types/errors.js';
import { createAzureDevOpsClient } from './azureDevOpsClient.js';

const VALID_CONFIG = {
  organizationUrl: 'https://dev.azure.com/tuorg',
  project: 'Checkout',
  personalAccessToken: 'un-pat-de-prueba',
};

function fakeResponse(init: {
  ok: boolean;
  status: number;
  text?: string;
  json?: unknown;
}): Response {
  return {
    ok: init.ok,
    status: init.status,
    text: async () => init.text ?? '',
    json: async () => init.json ?? {},
  } as Response;
}

const EXPECTED_AUTH_HEADER = `Basic ${Buffer.from(':un-pat-de-prueba').toString('base64')}`;

describe('createAzureDevOpsClient', () => {
  describe('attachReport', () => {
    it('sube el binario, chequea relaciones existentes, y agrega la relación AttachedFile al work item', async () => {
      const fetchImpl = vi.fn().mockImplementation((url: string, init: RequestInit) => {
        if (init.method === 'POST' && url.includes('/_apis/wit/attachments')) {
          return Promise.resolve(
            fakeResponse({
              ok: true,
              status: 200,
              json: { id: 'att-1', url: 'https://dev.azure.com/tuorg/_apis/wit/attachments/att-1' },
            }),
          );
        }
        if (init.method === 'GET') {
          return Promise.resolve(fakeResponse({ ok: true, status: 200, json: { relations: [] } }));
        }
        return Promise.resolve(fakeResponse({ ok: true, status: 200 }));
      });
      const client = createAzureDevOpsClient(VALID_CONFIG, { fetchImpl });

      const result = await client.attachReport(123, Buffer.from('contenido'), 'qa-report.zip');

      expect(result).toEqual({
        workItemUrl: 'https://dev.azure.com/tuorg/Checkout/_workitems/edit/123',
      });
      expect(fetchImpl).toHaveBeenCalledTimes(3);

      const [uploadUrl, uploadInit] = fetchImpl.mock.calls[0] as [string, RequestInit];
      expect(uploadUrl).toBe(
        'https://dev.azure.com/tuorg/Checkout/_apis/wit/attachments?fileName=qa-report.zip&api-version=7.1',
      );
      expect(uploadInit.method).toBe('POST');
      const uploadHeaders = uploadInit.headers as Record<string, string>;
      expect(uploadHeaders.Authorization).toBe(EXPECTED_AUTH_HEADER);
      expect(uploadHeaders['Content-Type']).toBe('application/octet-stream');
      expect(uploadInit.body).toEqual(Buffer.from('contenido'));

      const [relationsUrl] = fetchImpl.mock.calls[1] as [string];
      expect(relationsUrl).toBe(
        'https://dev.azure.com/tuorg/Checkout/_apis/wit/workitems/123?$expand=relations&api-version=7.1',
      );

      const [patchUrl, patchInit] = fetchImpl.mock.calls[2] as [string, RequestInit];
      expect(patchUrl).toBe(
        'https://dev.azure.com/tuorg/Checkout/_apis/wit/workitems/123?api-version=7.1',
      );
      expect(patchInit.method).toBe('PATCH');
      const patchHeaders = patchInit.headers as Record<string, string>;
      expect(patchHeaders['Content-Type']).toBe('application/json-patch+json');
      const patchBody = JSON.parse(patchInit.body as string) as Array<{
        op: string;
        path: string;
        value?: { rel: string; url: string };
      }>;
      expect(patchBody).toEqual([
        {
          op: 'add',
          path: '/relations/-',
          value: {
            rel: 'AttachedFile',
            url: 'https://dev.azure.com/tuorg/_apis/wit/attachments/att-1',
            attributes: { comment: 'Reporte QA (qa-evidence-reporter)' },
          },
        },
      ]);
    });

    it('encodea el nombre del proyecto en la URL (espacios/caracteres especiales)', async () => {
      const fetchImpl = vi.fn().mockImplementation((url: string, init: RequestInit) => {
        if (init.method === 'GET') {
          return Promise.resolve(fakeResponse({ ok: true, status: 200, json: { relations: [] } }));
        }
        return Promise.resolve(
          fakeResponse({ ok: true, status: 200, json: { id: 'a1', url: 'https://x/att/a1' } }),
        );
      });
      const client = createAzureDevOpsClient(
        { ...VALID_CONFIG, project: 'Mi Proyecto' },
        { fetchImpl },
      );

      const result = await client.attachReport(1, Buffer.from('x'), 'a.zip');

      expect(result.workItemUrl).toBe('https://dev.azure.com/tuorg/Mi%20Proyecto/_workitems/edit/1');
      const [uploadUrl] = fetchImpl.mock.calls[0] as [string];
      expect(uploadUrl).toContain('/tuorg/Mi%20Proyecto/_apis/wit/attachments');
    });

    it('si el work item ya tiene un adjunto con el mismo filename, lo borra (remove) antes de agregar el nuevo', async () => {
      const fetchImpl = vi.fn().mockImplementation((url: string, init: RequestInit) => {
        if (init.method === 'GET') {
          return Promise.resolve(
            fakeResponse({
              ok: true,
              status: 200,
              json: {
                relations: [
                  { rel: 'Hyperlink', url: 'https://x' },
                  { rel: 'AttachedFile', url: 'https://x/att/old', attributes: { name: 'qa-report.zip' } },
                  { rel: 'AttachedFile', url: 'https://x/att/other', attributes: { name: 'otro.txt' } },
                ],
              },
            }),
          );
        }
        if (init.method === 'POST') {
          return Promise.resolve(
            fakeResponse({ ok: true, status: 200, json: { id: 'new', url: 'https://x/att/new' } }),
          );
        }
        return Promise.resolve(fakeResponse({ ok: true, status: 200 }));
      });
      const client = createAzureDevOpsClient(VALID_CONFIG, { fetchImpl });

      await client.attachReport(123, Buffer.from('x'), 'qa-report.zip');

      const patchCall = fetchImpl.mock.calls.find(
        ([, init]: [string, RequestInit]) => init.method === 'PATCH',
      ) as [string, RequestInit];
      const patchBody = JSON.parse(patchCall[1].body as string) as Array<{ op: string; path: string }>;

      // Solo el índice 1 (el "qa-report.zip") se borra, NUNCA el índice 2 ("otro.txt").
      expect(patchBody).toEqual([
        { op: 'remove', path: '/relations/1' },
        expect.objectContaining({ op: 'add' }),
      ]);
    });

    it('con varios adjuntos duplicados, borra sus índices en orden DESCENDENTE', async () => {
      const fetchImpl = vi.fn().mockImplementation((url: string, init: RequestInit) => {
        if (init.method === 'GET') {
          return Promise.resolve(
            fakeResponse({
              ok: true,
              status: 200,
              json: {
                relations: [
                  { rel: 'AttachedFile', url: 'https://x/1', attributes: { name: 'qa-report.zip' } },
                  { rel: 'AttachedFile', url: 'https://x/2', attributes: { name: 'qa-report.zip' } },
                ],
              },
            }),
          );
        }
        if (init.method === 'POST') {
          return Promise.resolve(
            fakeResponse({ ok: true, status: 200, json: { id: 'new', url: 'https://x/att/new' } }),
          );
        }
        return Promise.resolve(fakeResponse({ ok: true, status: 200 }));
      });
      const client = createAzureDevOpsClient(VALID_CONFIG, { fetchImpl });

      await client.attachReport(123, Buffer.from('x'), 'qa-report.zip');

      const patchCall = fetchImpl.mock.calls.find(
        ([, init]: [string, RequestInit]) => init.method === 'PATCH',
      ) as [string, RequestInit];
      const patchBody = JSON.parse(patchCall[1].body as string) as Array<{ op: string; path: string }>;

      expect(patchBody[0]).toEqual({ op: 'remove', path: '/relations/1' });
      expect(patchBody[1]).toEqual({ op: 'remove', path: '/relations/0' });
    });

    it('lanza AzureDevOpsAuthenticationError en 401', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(fakeResponse({ ok: false, status: 401 }));
      const client = createAzureDevOpsClient(VALID_CONFIG, { fetchImpl });

      await expect(client.attachReport(1, Buffer.from('x'), 'a.zip')).rejects.toBeInstanceOf(
        AzureDevOpsAuthenticationError,
      );
    });

    it('lanza AzureDevOpsWorkItemNotFoundError (con workItemId) en 404', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(fakeResponse({ ok: false, status: 404 }));
      const client = createAzureDevOpsClient(VALID_CONFIG, { fetchImpl });

      await expect(client.attachReport(404, Buffer.from('x'), 'a.zip')).rejects.toSatisfy(
        (error: unknown) => {
          expect(error).toBeInstanceOf(AzureDevOpsWorkItemNotFoundError);
          expect((error as AzureDevOpsWorkItemNotFoundError).workItemId).toBe(404);
          return true;
        },
      );
    });

    it('lanza AzureDevOpsRequestError para cualquier otro status no-2xx', async () => {
      const fetchImpl = vi
        .fn()
        .mockResolvedValue(fakeResponse({ ok: false, status: 400, text: 'campo inválido' }));
      const client = createAzureDevOpsClient(VALID_CONFIG, { fetchImpl });

      await expect(client.attachReport(1, Buffer.from('x'), 'a.zip')).rejects.toSatisfy(
        (error: unknown) => {
          expect(error).toBeInstanceOf(AzureDevOpsRequestError);
          expect((error as AzureDevOpsRequestError).message).toContain('400');
          expect((error as AzureDevOpsRequestError).message).toContain('campo inválido');
          return true;
        },
      );
    });

    it('lanza AzureDevOpsRequestError (con cause) cuando fetch rechaza (red caída)', async () => {
      const networkError = new Error('ECONNREFUSED');
      const fetchImpl = vi.fn().mockRejectedValue(networkError);
      const client = createAzureDevOpsClient(VALID_CONFIG, { fetchImpl });

      await expect(client.attachReport(1, Buffer.from('x'), 'a.zip')).rejects.toSatisfy(
        (error: unknown) => {
          expect(error).toBeInstanceOf(AzureDevOpsRequestError);
          expect((error as AzureDevOpsRequestError).cause).toBe(networkError);
          return true;
        },
      );
    });

    it.each([
      ['organizationUrl', { ...VALID_CONFIG, organizationUrl: null }],
      ['project', { ...VALID_CONFIG, project: null }],
      ['personalAccessToken', { ...VALID_CONFIG, personalAccessToken: undefined }],
    ])(
      'lanza AzureDevOpsNotConfiguredError sin llamar a fetch cuando falta "%s"',
      async (_field, config) => {
        const fetchImpl = vi.fn();
        const client = createAzureDevOpsClient(config, { fetchImpl });

        await expect(client.attachReport(1, Buffer.from('x'), 'a.zip')).rejects.toBeInstanceOf(
          AzureDevOpsNotConfiguredError,
        );
        expect(fetchImpl).not.toHaveBeenCalled();
      },
    );
  });

  describe('addComment', () => {
    it('postea el comentario a la URL/headers/body correctos de la API de comentarios', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(fakeResponse({ ok: true, status: 200 }));
      const client = createAzureDevOpsClient(VALID_CONFIG, { fetchImpl });

      await client.addComment(123, '<h3>Resumen</h3>');

      expect(fetchImpl).toHaveBeenCalledTimes(1);
      const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(
        'https://dev.azure.com/tuorg/Checkout/_apis/wit/workItems/123/comments?api-version=7.1-preview.4',
      );
      expect(init.method).toBe('POST');

      const headers = init.headers as Record<string, string>;
      expect(headers.Authorization).toBe(EXPECTED_AUTH_HEADER);
      expect(headers['Content-Type']).toBe('application/json');
      expect(JSON.parse(init.body as string)).toEqual({ text: '<h3>Resumen</h3>' });
    });

    it('lanza AzureDevOpsAuthenticationError en 403', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(fakeResponse({ ok: false, status: 403 }));
      const client = createAzureDevOpsClient(VALID_CONFIG, { fetchImpl });

      await expect(client.addComment(1, '<p>x</p>')).rejects.toBeInstanceOf(
        AzureDevOpsAuthenticationError,
      );
    });

    it('lanza AzureDevOpsWorkItemNotFoundError (con workItemId) en 404', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(fakeResponse({ ok: false, status: 404 }));
      const client = createAzureDevOpsClient(VALID_CONFIG, { fetchImpl });

      await expect(client.addComment(404, '<p>x</p>')).rejects.toSatisfy((error: unknown) => {
        expect(error).toBeInstanceOf(AzureDevOpsWorkItemNotFoundError);
        expect((error as AzureDevOpsWorkItemNotFoundError).workItemId).toBe(404);
        return true;
      });
    });

    it('lanza AzureDevOpsRequestError (con cause) cuando fetch rechaza (red caída)', async () => {
      const networkError = new Error('ECONNREFUSED');
      const fetchImpl = vi.fn().mockRejectedValue(networkError);
      const client = createAzureDevOpsClient(VALID_CONFIG, { fetchImpl });

      await expect(client.addComment(1, '<p>x</p>')).rejects.toSatisfy((error: unknown) => {
        expect(error).toBeInstanceOf(AzureDevOpsRequestError);
        expect((error as AzureDevOpsRequestError).cause).toBe(networkError);
        return true;
      });
    });

    it.each([
      ['organizationUrl', { ...VALID_CONFIG, organizationUrl: null }],
      ['project', { ...VALID_CONFIG, project: null }],
      ['personalAccessToken', { ...VALID_CONFIG, personalAccessToken: undefined }],
    ])(
      'lanza AzureDevOpsNotConfiguredError sin llamar a fetch cuando falta "%s"',
      async (_field, config) => {
        const fetchImpl = vi.fn();
        const client = createAzureDevOpsClient(config, { fetchImpl });

        await expect(client.addComment(1, '<p>x</p>')).rejects.toBeInstanceOf(
          AzureDevOpsNotConfiguredError,
        );
        expect(fetchImpl).not.toHaveBeenCalled();
      },
    );
  });
});

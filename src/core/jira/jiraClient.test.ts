import { describe, expect, it, vi } from 'vitest';

import {
  JiraAuthenticationError,
  JiraIssueNotFoundError,
  JiraNotConfiguredError,
  JiraRequestError,
} from '../types/errors.js';
import { createJiraClient } from './jiraClient.js';

const VALID_CONFIG = {
  baseUrl: 'https://tuempresa.atlassian.net',
  email: 'qa@tuempresa.com',
  apiToken: 'un-token-de-prueba',
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

/** Sin adjuntos previos: el `GET` de chequeo de duplicados no encuentra nada que borrar. */
const NO_EXISTING_ATTACHMENTS = fakeResponse({
  ok: true,
  status: 200,
  json: { fields: { attachment: [] } },
});

describe('createJiraClient', () => {
  describe('attachReport', () => {
    it('sube el archivo a la URL/headers/body correctos de la API v3 de adjuntos', async () => {
      const fetchImpl = vi
        .fn()
        .mockResolvedValueOnce(NO_EXISTING_ATTACHMENTS)
        .mockResolvedValueOnce(fakeResponse({ ok: true, status: 200 }));
      const client = createJiraClient(VALID_CONFIG, { fetchImpl });

      const result = await client.attachReport(
        'QA-123',
        Buffer.from('contenido de prueba'),
        'qa-report.zip',
      );

      expect(result).toEqual({ issueUrl: 'https://tuempresa.atlassian.net/browse/QA-123' });
      expect(fetchImpl).toHaveBeenCalledTimes(2);

      const [listUrl, listInit] = fetchImpl.mock.calls[0] as [string, RequestInit];
      expect(listUrl).toBe(
        'https://tuempresa.atlassian.net/rest/api/3/issue/QA-123?fields=attachment',
      );
      expect(listInit.method).toBe('GET');

      const [url, init] = fetchImpl.mock.calls[1] as [string, RequestInit];
      expect(url).toBe('https://tuempresa.atlassian.net/rest/api/3/issue/QA-123/attachments');
      expect(init.method).toBe('POST');

      const headers = init.headers as Record<string, string>;
      expect(headers.Authorization).toBe(
        `Basic ${Buffer.from('qa@tuempresa.com:un-token-de-prueba').toString('base64')}`,
      );
      expect(headers['X-Atlassian-Token']).toBe('no-check');
      expect(headers.Accept).toBe('application/json');
      // Nunca a mano: fetch debe calcular el boundary multipart solo, a partir del FormData.
      expect(headers['Content-Type']).toBeUndefined();

      expect(init.body).toBeInstanceOf(FormData);
      const file = (init.body as FormData).get('file');
      expect(file).toBeInstanceOf(Blob);
      expect((file as File | null)?.name ?? (file as Blob).size).toBeTruthy();
    });

    it('encodea la clave del issue en la URL (caracteres especiales)', async () => {
      const fetchImpl = vi
        .fn()
        .mockResolvedValueOnce(NO_EXISTING_ATTACHMENTS)
        .mockResolvedValueOnce(fakeResponse({ ok: true, status: 200 }));
      const client = createJiraClient(VALID_CONFIG, { fetchImpl });

      await client.attachReport('QA/123 raro', Buffer.from('x'), 'a.zip');

      const [listUrl] = fetchImpl.mock.calls[0] as [string];
      expect(listUrl).toBe(
        'https://tuempresa.atlassian.net/rest/api/3/issue/QA%2F123%20raro?fields=attachment',
      );
      const [url] = fetchImpl.mock.calls[1] as [string];
      expect(url).toBe(
        'https://tuempresa.atlassian.net/rest/api/3/issue/QA%2F123%20raro/attachments',
      );
    });

    it('si el issue ya tiene un adjunto con el mismo filename, lo borra antes de subir el nuevo', async () => {
      const fetchImpl = vi.fn().mockImplementation((url: string, init: RequestInit) => {
        if (init.method === 'GET') {
          return Promise.resolve(
            fakeResponse({
              ok: true,
              status: 200,
              json: {
                fields: {
                  attachment: [
                    { id: '10001', filename: 'qa-report.zip' },
                    { id: '10002', filename: 'otro-archivo.txt' },
                  ],
                },
              },
            }),
          );
        }
        return Promise.resolve(fakeResponse({ ok: true, status: 200 }));
      });
      const client = createJiraClient(VALID_CONFIG, { fetchImpl });

      await client.attachReport('QA-123', Buffer.from('x'), 'qa-report.zip');

      const deleteCalls = fetchImpl.mock.calls.filter(
        ([, init]: [string, RequestInit]) => init.method === 'DELETE',
      );
      expect(deleteCalls).toHaveLength(1);
      const [deleteUrl] = deleteCalls[0] as [string, RequestInit];
      expect(deleteUrl).toBe('https://tuempresa.atlassian.net/rest/api/3/attachment/10001');
    });

    it('si borrar un adjunto viejo falla (red), igual sube el archivo nuevo (best-effort)', async () => {
      const fetchImpl = vi.fn().mockImplementation((url: string, init: RequestInit) => {
        if (init.method === 'GET') {
          return Promise.resolve(
            fakeResponse({
              ok: true,
              status: 200,
              json: { fields: { attachment: [{ id: '10001', filename: 'qa-report.zip' }] } },
            }),
          );
        }
        if (init.method === 'DELETE') {
          return Promise.reject(new Error('ECONNREFUSED'));
        }
        return Promise.resolve(fakeResponse({ ok: true, status: 200 }));
      });
      const client = createJiraClient(VALID_CONFIG, { fetchImpl });

      const result = await client.attachReport('QA-123', Buffer.from('x'), 'qa-report.zip');

      expect(result).toEqual({ issueUrl: 'https://tuempresa.atlassian.net/browse/QA-123' });
      const postCalls = fetchImpl.mock.calls.filter(
        ([, init]: [string, RequestInit]) => init.method === 'POST',
      );
      expect(postCalls).toHaveLength(1);
    });

    it('lanza JiraAuthenticationError en 401', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(fakeResponse({ ok: false, status: 401 }));
      const client = createJiraClient(VALID_CONFIG, { fetchImpl });

      await expect(client.attachReport('QA-1', Buffer.from('x'), 'a.zip')).rejects.toBeInstanceOf(
        JiraAuthenticationError,
      );
    });

    it('lanza JiraAuthenticationError en 403', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(fakeResponse({ ok: false, status: 403 }));
      const client = createJiraClient(VALID_CONFIG, { fetchImpl });

      await expect(client.attachReport('QA-1', Buffer.from('x'), 'a.zip')).rejects.toBeInstanceOf(
        JiraAuthenticationError,
      );
    });

    it('lanza JiraIssueNotFoundError (con issueKey) en 404', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(fakeResponse({ ok: false, status: 404 }));
      const client = createJiraClient(VALID_CONFIG, { fetchImpl });

      await expect(client.attachReport('QA-404', Buffer.from('x'), 'a.zip')).rejects.toSatisfy(
        (error: unknown) => {
          expect(error).toBeInstanceOf(JiraIssueNotFoundError);
          expect((error as JiraIssueNotFoundError).issueKey).toBe('QA-404');
          return true;
        },
      );
    });

    it('lanza JiraRequestError para cualquier otro status no-2xx', async () => {
      const fetchImpl = vi
        .fn()
        .mockResolvedValue(fakeResponse({ ok: false, status: 400, text: 'campo inválido' }));
      const client = createJiraClient(VALID_CONFIG, { fetchImpl });

      await expect(client.attachReport('QA-1', Buffer.from('x'), 'a.zip')).rejects.toSatisfy(
        (error: unknown) => {
          expect(error).toBeInstanceOf(JiraRequestError);
          expect((error as JiraRequestError).message).toContain('400');
          expect((error as JiraRequestError).message).toContain('campo inválido');
          return true;
        },
      );
    });

    it('lanza JiraRequestError (con cause) cuando fetch rechaza (red caída)', async () => {
      const networkError = new Error('ECONNREFUSED');
      const fetchImpl = vi.fn().mockRejectedValue(networkError);
      const client = createJiraClient(VALID_CONFIG, { fetchImpl });

      await expect(client.attachReport('QA-1', Buffer.from('x'), 'a.zip')).rejects.toSatisfy(
        (error: unknown) => {
          expect(error).toBeInstanceOf(JiraRequestError);
          expect((error as JiraRequestError).cause).toBe(networkError);
          return true;
        },
      );
    });

    it.each([
      ['baseUrl', { ...VALID_CONFIG, baseUrl: null }],
      ['email', { ...VALID_CONFIG, email: null }],
      ['apiToken', { ...VALID_CONFIG, apiToken: undefined }],
    ])(
      'lanza JiraNotConfiguredError sin llamar a fetch cuando falta "%s"',
      async (_field, config) => {
        const fetchImpl = vi.fn();
        const client = createJiraClient(config, { fetchImpl });

        await expect(client.attachReport('QA-1', Buffer.from('x'), 'a.zip')).rejects.toBeInstanceOf(
          JiraNotConfiguredError,
        );
        expect(fetchImpl).not.toHaveBeenCalled();
      },
    );
  });

  describe('addComment', () => {
    const COMMENT_BODY = { type: 'doc', version: 1, content: [] } as const;

    it('postea el comentario a la URL/headers/body correctos de la API v3 de comentarios', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(fakeResponse({ ok: true, status: 201 }));
      const client = createJiraClient(VALID_CONFIG, { fetchImpl });

      await client.addComment('QA-123', COMMENT_BODY);

      expect(fetchImpl).toHaveBeenCalledTimes(1);
      const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://tuempresa.atlassian.net/rest/api/3/issue/QA-123/comment');
      expect(init.method).toBe('POST');

      const headers = init.headers as Record<string, string>;
      expect(headers.Authorization).toBe(
        `Basic ${Buffer.from('qa@tuempresa.com:un-token-de-prueba').toString('base64')}`,
      );
      expect(headers['Content-Type']).toBe('application/json');
      expect(JSON.parse(init.body as string)).toEqual({ body: COMMENT_BODY });
    });

    it('lanza JiraAuthenticationError en 401', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(fakeResponse({ ok: false, status: 401 }));
      const client = createJiraClient(VALID_CONFIG, { fetchImpl });

      await expect(client.addComment('QA-1', COMMENT_BODY)).rejects.toBeInstanceOf(
        JiraAuthenticationError,
      );
    });

    it('lanza JiraIssueNotFoundError (con issueKey) en 404', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(fakeResponse({ ok: false, status: 404 }));
      const client = createJiraClient(VALID_CONFIG, { fetchImpl });

      await expect(client.addComment('QA-404', COMMENT_BODY)).rejects.toSatisfy((error: unknown) => {
        expect(error).toBeInstanceOf(JiraIssueNotFoundError);
        expect((error as JiraIssueNotFoundError).issueKey).toBe('QA-404');
        return true;
      });
    });

    it('lanza JiraRequestError (con cause) cuando fetch rechaza (red caída)', async () => {
      const networkError = new Error('ECONNREFUSED');
      const fetchImpl = vi.fn().mockRejectedValue(networkError);
      const client = createJiraClient(VALID_CONFIG, { fetchImpl });

      await expect(client.addComment('QA-1', COMMENT_BODY)).rejects.toSatisfy((error: unknown) => {
        expect(error).toBeInstanceOf(JiraRequestError);
        expect((error as JiraRequestError).cause).toBe(networkError);
        return true;
      });
    });

    it.each([
      ['baseUrl', { ...VALID_CONFIG, baseUrl: null }],
      ['email', { ...VALID_CONFIG, email: null }],
      ['apiToken', { ...VALID_CONFIG, apiToken: undefined }],
    ])(
      'lanza JiraNotConfiguredError sin llamar a fetch cuando falta "%s"',
      async (_field, config) => {
        const fetchImpl = vi.fn();
        const client = createJiraClient(config, { fetchImpl });

        await expect(client.addComment('QA-1', COMMENT_BODY)).rejects.toBeInstanceOf(
          JiraNotConfiguredError,
        );
        expect(fetchImpl).not.toHaveBeenCalled();
      },
    );
  });
});

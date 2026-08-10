import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiRequestError, api } from './api';

/**
 * Tests de `api.ts` con `fetch` global mockeado — sin jsdom (Node 18+/22 ya
 * trae `fetch`/`File`/`FormData` nativos, ver ARCHITECTURE.md "Node mínimo
 * soportado: 18 LTS+"). Cubre el contrato real de cada ruta (leído de
 * `src/adapters/server/routes/*.ts`, no de memoria) y el requisito de esta
 * fase: "adjuntar un archivo simulado dispara la llamada fetch esperada".
 */
describe('api', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function mockFetchOnce(
    body: unknown,
    init: { ok?: boolean; status?: number } = {},
  ): ReturnType<typeof vi.fn> {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: init.ok ?? true,
      status: init.status ?? 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => body,
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('uploadEvidence sube un File real vía FormData al endpoint correcto', async () => {
    const fetchMock = mockFetchOnce({
      evidenceFiles: [{ id: 'abc', originalFilename: 'captura.png' }],
      session: {},
    });

    const file = new File(['contenido'], 'captura.png', { type: 'image/png' });
    await api.uploadEvidence('f0_s0_st0', [file]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/session/step/f0_s0_st0/evidence');
    expect(requestInit.method).toBe('POST');
    expect(requestInit.body).toBeInstanceOf(FormData);
    const formData = requestInit.body as FormData;
    expect(formData.get('files')).toBeInstanceOf(File);
    expect((formData.get('files') as File).name).toBe('captura.png');
  });

  it('uploadEvidence adjunta varios archivos bajo el mismo campo "files"', async () => {
    const fetchMock = mockFetchOnce({ evidenceFiles: [], session: {} });

    const files = [
      new File(['a'], 'uno.png', { type: 'image/png' }),
      new File(['b'], 'dos.png', { type: 'image/png' }),
    ];
    await api.uploadEvidence('step-1', files);

    const [, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const formData = requestInit.body as FormData;
    expect(formData.getAll('files')).toHaveLength(2);
  });

  it('selectFeatures postea featureIds como JSON y agrega ?force=true cuando corresponde', async () => {
    const fetchMock = mockFetchOnce({ session: {}, currentStep: null });

    await api.selectFeatures(['login.feature'], true);

    const [url, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/session/select?force=true');
    expect(requestInit.method).toBe('POST');
    expect(JSON.parse(requestInit.body as string)).toEqual({ featureIds: ['login.feature'] });
  });

  it('setStepResult envía result/notes/defectDescription en el body', async () => {
    const fetchMock = mockFetchOnce({ session: {}, currentStep: null });

    await api.setStepResult('step-1', 'fail', { defectDescription: 'no anda', notes: 'nota' });

    const [url, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/session/step/step-1/result');
    expect(JSON.parse(requestInit.body as string)).toEqual({
      result: 'fail',
      defectDescription: 'no anda',
      notes: 'nota',
    });
  });

  it('deleteEvidence llama DELETE al endpoint con stepId/evidenceId', async () => {
    const fetchMock = mockFetchOnce({ session: {} });

    await api.deleteEvidence('step-1', 'ev-1');

    const [url, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/session/step/step-1/evidence/ev-1');
    expect(requestInit.method).toBe('DELETE');
  });

  it('propaga un error { error: { code, message } } como ApiRequestError', async () => {
    mockFetchOnce(
      { error: { code: 'INVALID_STEP_TRANSITION', message: 'Falta defectDescription.' } },
      { ok: false, status: 400 },
    );

    await expect(api.setStepResult('step-1', 'fail')).rejects.toMatchObject({
      code: 'INVALID_STEP_TRANSITION',
      message: 'Falta defectDescription.',
    });
    await expect(api.setStepResult('step-1', 'fail')).rejects.toBeInstanceOf(ApiRequestError);
  });

  it('un fallo de red produce ApiRequestError con code NETWORK_ERROR', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    await expect(api.getFeatures()).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
  });
});

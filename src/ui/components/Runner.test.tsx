// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Runner } from './Runner';
import type { SessionState } from '../types';

afterEach(cleanup);

const SESSION: SessionState = {
  version: 1,
  projectName: 'Demo',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  status: 'completed',
  currentPosition: { featureIndex: 0, scenarioIndex: 0, stepIndex: 0 },
  selectedFeatures: [
    {
      id: 'f0-login',
      name: 'Login',
      tags: [],
      scenarios: [
        {
          id: 'f0-login_s0',
          name: 'Successful login',
          tags: [],
          steps: [
            {
              id: 'f0-login_s0_st0',
              step: { keyword: 'Given', text: 'a registered user', fromBackground: false },
              result: 'pass',
              evidenceFileIds: [],
              timestamps: {},
            },
          ],
        },
      ],
    },
  ],
};

const CURRENT_STEP = {
  featureId: 'f0-login',
  scenarioId: 'f0-login_s0',
  step: SESSION.selectedFeatures[0].scenarios[0].steps[0],
};

/** `fetch` mock mínimo: responde `{ evidenceFiles: [] }` para cualquier GET (la carga de evidencia al montar el Runner) y `{ closed: true }` para `POST /api/session/close`. */
function mockFetch(): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn().mockImplementation((url: string) => {
    let body: unknown = { evidenceFiles: [] };
    if (url.includes('/api/session/close')) body = { closed: true };
    else if (url.includes('/api/report/generate')) body = { reportUrl: '/reports-static/index.html' };

    return Promise.resolve({
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => body,
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('Runner — Cerrar sesión', () => {
  it('con reporte ya generado, cierra sin pedir confirmación y notifica a onSessionClosed', async () => {
    const fetchMock = mockFetch();
    const onSessionClosed = vi.fn();
    const confirmSpy = vi.spyOn(window, 'confirm');

    render(
      <Runner
        session={SESSION}
        currentStep={CURRENT_STEP}
        onSessionUpdate={vi.fn()}
        onError={vi.fn()}
        onSessionClosed={onSessionClosed}
      />,
    );

    // Genera el reporte primero para que `reportUrl` deje de ser `null`.
    fireEvent.click(screen.getByRole('button', { name: /generar reporte/i }));
    await waitFor(() => expect(screen.getByRole('link', { name: /ver reporte/i })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /cerrar sesión/i }));

    await waitFor(() => expect(onSessionClosed).toHaveBeenCalledTimes(1));
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/session/close',
      expect.objectContaining({ method: 'POST' }),
    );
    confirmSpy.mockRestore();
  });

  it('sin reporte generado todavía, pide confirmación antes de cerrar', async () => {
    mockFetch();
    const onSessionClosed = vi.fn();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);

    render(
      <Runner
        session={SESSION}
        currentStep={CURRENT_STEP}
        onSessionUpdate={vi.fn()}
        onError={vi.fn()}
        onSessionClosed={onSessionClosed}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /cerrar sesión/i }));

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(onSessionClosed).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });
});

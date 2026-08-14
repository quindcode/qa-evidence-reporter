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

/**
 * `fetch` mock mínimo: responde `{ evidenceFiles: [] }` para cualquier GET
 * (la carga de evidencia al montar el Runner), `{ closed: true }` para
 * `POST /api/session/close`, `{ reportUrl }` para `POST /api/report/generate`,
 * y (según `jira`) éxito/fallo para `POST /api/report/publish-jira`.
 */
function mockFetch(jira: { ok?: boolean; status?: number } = {}): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn().mockImplementation((url: string) => {
    if (url.includes('/api/report/publish-jira')) {
      const ok = jira.ok ?? true;
      const body = ok
        ? { issueKey: 'QA-123', issueUrl: 'https://tuempresa.atlassian.net/browse/QA-123' }
        : { error: { code: 'JIRA_ISSUE_NOT_FOUND', message: 'No se encontró el issue.' } };
      return Promise.resolve({
        ok,
        status: ok ? 201 : (jira.status ?? 404),
        headers: { get: () => 'application/json' },
        json: async () => body,
      });
    }

    let body: unknown = { evidenceFiles: [] };
    if (url.includes('/api/session/close')) body = { closed: true };
    else if (url.includes('/api/report/generate'))
      body = { reportUrl: '/reports-static/index.html' };

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
        jiraEnabled={false}
      />,
    );

    // Genera el reporte primero para que `reportUrl` deje de ser `null`.
    fireEvent.click(screen.getByRole('button', { name: /generar reporte/i }));
    await waitFor(() =>
      expect(screen.getByRole('link', { name: /ver reporte/i })).toBeInTheDocument(),
    );

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
        jiraEnabled={false}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /cerrar sesión/i }));

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(onSessionClosed).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });
});

describe('Runner — Adjuntar a Jira', () => {
  it('con jiraEnabled=false, el botón nunca aparece (ni siquiera con reporte generado)', async () => {
    mockFetch();

    render(
      <Runner
        session={SESSION}
        currentStep={CURRENT_STEP}
        onSessionUpdate={vi.fn()}
        onError={vi.fn()}
        onSessionClosed={vi.fn()}
        jiraEnabled={false}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /generar reporte/i }));
    await waitFor(() =>
      expect(screen.getByRole('link', { name: /ver reporte/i })).toBeInTheDocument(),
    );

    expect(screen.queryByRole('button', { name: /adjuntar a jira/i })).not.toBeInTheDocument();
  });

  it('con jiraEnabled=true, el botón aparece solo tras generar el reporte, se habilita al tipear una clave, y publica con éxito', async () => {
    const fetchMock = mockFetch();

    render(
      <Runner
        session={SESSION}
        currentStep={CURRENT_STEP}
        onSessionUpdate={vi.fn()}
        onError={vi.fn()}
        onSessionClosed={vi.fn()}
        jiraEnabled={true}
      />,
    );

    // Sin reporte generado todavía: ni el input ni el botón existen.
    expect(screen.queryByRole('button', { name: /adjuntar a jira/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /generar reporte/i }));
    await waitFor(() =>
      expect(screen.getByRole('link', { name: /ver reporte/i })).toBeInTheDocument(),
    );

    const publishButton = screen.getByRole('button', { name: /adjuntar a jira/i });
    expect(publishButton).toBeDisabled();

    fireEvent.input(screen.getByLabelText(/clave del issue de jira/i), {
      target: { value: 'QA-123' },
    });
    expect(publishButton).not.toBeDisabled();

    fireEvent.click(publishButton);

    await waitFor(() =>
      expect(screen.getByRole('link', { name: /ver issue en jira/i })).toBeInTheDocument(),
    );
    expect(screen.getByRole('link', { name: /ver issue en jira/i })).toHaveAttribute(
      'href',
      'https://tuempresa.atlassian.net/browse/QA-123',
    );
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/report/publish-jira',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ issueKey: 'QA-123' }),
      }),
    );
  });

  it('con jiraEnabled=true, un fallo de Jira llama a onError en vez de mostrar el link de éxito', async () => {
    mockFetch({ ok: false, status: 404 });
    const onError = vi.fn();

    render(
      <Runner
        session={SESSION}
        currentStep={CURRENT_STEP}
        onSessionUpdate={vi.fn()}
        onError={onError}
        onSessionClosed={vi.fn()}
        jiraEnabled={true}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /generar reporte/i }));
    await waitFor(() =>
      expect(screen.getByRole('link', { name: /ver reporte/i })).toBeInTheDocument(),
    );

    fireEvent.input(screen.getByLabelText(/clave del issue de jira/i), {
      target: { value: 'QA-404' },
    });
    fireEvent.click(screen.getByRole('button', { name: /adjuntar a jira/i }));

    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'JIRA_ISSUE_NOT_FOUND' }));
    expect(screen.queryByRole('link', { name: /ver issue en jira/i })).not.toBeInTheDocument();
  });
});

describe('Runner — Navegación', () => {
  it('en el último step de la sesión, el botón "Siguiente" desaparece (no solo se deshabilita)', () => {
    // SESSION (fixture del tope del archivo) tiene una sola feature, un solo
    // scenario y un solo step — currentPosition {0,0,0} es, por construcción,
    // el último (y único) step de toda la sesión.
    mockFetch();

    render(
      <Runner
        session={SESSION}
        currentStep={CURRENT_STEP}
        onSessionUpdate={vi.fn()}
        onError={vi.fn()}
        onSessionClosed={vi.fn()}
        jiraEnabled={false}
      />,
    );

    expect(screen.queryByRole('button', { name: /siguiente/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /anterior/i })).toBeInTheDocument();
  });

  it('con más de un step por delante, el botón "Siguiente" sigue visible', () => {
    const sessionWithTwoSteps: SessionState = {
      ...SESSION,
      selectedFeatures: [
        {
          ...SESSION.selectedFeatures[0],
          scenarios: [
            {
              ...SESSION.selectedFeatures[0].scenarios[0],
              steps: [
                ...SESSION.selectedFeatures[0].scenarios[0].steps,
                {
                  id: 'f0-login_s0_st1',
                  step: { keyword: 'Then', text: 'they see the dashboard', fromBackground: false },
                  result: 'pending',
                  evidenceFileIds: [],
                  timestamps: {},
                },
              ],
            },
          ],
        },
      ],
    };
    mockFetch();

    render(
      <Runner
        session={sessionWithTwoSteps}
        currentStep={CURRENT_STEP}
        onSessionUpdate={vi.fn()}
        onError={vi.fn()}
        onSessionClosed={vi.fn()}
        jiraEnabled={false}
      />,
    );

    expect(screen.getByRole('button', { name: /siguiente/i })).toBeInTheDocument();
  });
});

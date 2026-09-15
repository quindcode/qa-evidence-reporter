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
 * y (según `jira`/`azureDevOps`) éxito/fallo para
 * `POST /api/report/publish-jira`/`POST /api/report/publish-azure-devops`.
 */
function mockFetch(
  jira: { ok?: boolean; status?: number } = {},
  azureDevOps: { ok?: boolean; status?: number } = {},
): ReturnType<typeof vi.fn> {
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

    if (url.includes('/api/report/publish-azure-devops')) {
      const ok = azureDevOps.ok ?? true;
      const body = ok
        ? {
            workItemId: 123,
            workItemUrl: 'https://dev.azure.com/tuorg/Checkout/_workitems/edit/123',
          }
        : {
            error: {
              code: 'AZURE_DEVOPS_WORK_ITEM_NOT_FOUND',
              message: 'No se encontró el work item.',
            },
          };
      return Promise.resolve({
        ok,
        status: ok ? 201 : (azureDevOps.status ?? 404),
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
        onBackToSelection={vi.fn()}
        jiraEnabled={false}
        azureDevOpsEnabled={false}
        jiraTokenConfigured={false}
        azureDevOpsTokenConfigured={false}
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
        onBackToSelection={vi.fn()}
        jiraEnabled={false}
        azureDevOpsEnabled={false}
        jiraTokenConfigured={false}
        azureDevOpsTokenConfigured={false}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /cerrar sesión/i }));

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(onSessionClosed).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it('"Volver a selección" llama a onBackToSelection sin pedir confirmación ni llamar a ningún endpoint', async () => {
    const fetchMock = mockFetch();
    const onBackToSelection = vi.fn();
    const confirmSpy = vi.spyOn(window, 'confirm');

    render(
      <Runner
        session={SESSION}
        currentStep={CURRENT_STEP}
        onSessionUpdate={vi.fn()}
        onError={vi.fn()}
        onSessionClosed={vi.fn()}
        onBackToSelection={onBackToSelection}
        jiraEnabled={false}
        azureDevOpsEnabled={false}
        jiraTokenConfigured={false}
        azureDevOpsTokenConfigured={false}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /volver a selección/i }));

    expect(onBackToSelection).toHaveBeenCalledTimes(1);
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalledWith(
      '/api/session/close',
      expect.anything(),
    );
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
        onBackToSelection={vi.fn()}
        jiraEnabled={false}
        azureDevOpsEnabled={false}
        jiraTokenConfigured={false}
        azureDevOpsTokenConfigured={false}
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
        onBackToSelection={vi.fn()}
        jiraEnabled={true}
        azureDevOpsEnabled={false}
        jiraTokenConfigured={true}
        azureDevOpsTokenConfigured={false}
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

  it('con jiraTokenConfigured=false, avisa "Token no configurado" y deshabilita "Adjuntar a Jira" aunque haya clave cargada', async () => {
    mockFetch();

    render(
      <Runner
        session={SESSION}
        currentStep={CURRENT_STEP}
        onSessionUpdate={vi.fn()}
        onError={vi.fn()}
        onSessionClosed={vi.fn()}
        onBackToSelection={vi.fn()}
        jiraEnabled={true}
        azureDevOpsEnabled={false}
        jiraTokenConfigured={false}
        azureDevOpsTokenConfigured={false}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /generar reporte/i }));
    await waitFor(() =>
      expect(screen.getByRole('link', { name: /ver reporte/i })).toBeInTheDocument(),
    );

    expect(screen.getByText(/token no configurado/i)).toBeInTheDocument();

    fireEvent.input(screen.getByLabelText(/clave del issue de jira/i), {
      target: { value: 'QA-123' },
    });

    // A diferencia del caso con token configurado: cargar la clave del
    // issue NO alcanza para habilitar el botón — todavía falta el token.
    expect(screen.getByRole('button', { name: /adjuntar a jira/i })).toBeDisabled();
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
        onBackToSelection={vi.fn()}
        jiraEnabled={true}
        azureDevOpsEnabled={false}
        jiraTokenConfigured={true}
        azureDevOpsTokenConfigured={false}
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

describe('Runner — Adjuntar a Azure DevOps', () => {
  it('con azureDevOpsEnabled=false, el botón nunca aparece (ni siquiera con reporte generado)', async () => {
    mockFetch();

    render(
      <Runner
        session={SESSION}
        currentStep={CURRENT_STEP}
        onSessionUpdate={vi.fn()}
        onError={vi.fn()}
        onSessionClosed={vi.fn()}
        onBackToSelection={vi.fn()}
        jiraEnabled={false}
        azureDevOpsEnabled={false}
        jiraTokenConfigured={false}
        azureDevOpsTokenConfigured={false}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /generar reporte/i }));
    await waitFor(() =>
      expect(screen.getByRole('link', { name: /ver reporte/i })).toBeInTheDocument(),
    );

    expect(
      screen.queryByRole('button', { name: /adjuntar a azure devops/i }),
    ).not.toBeInTheDocument();
  });

  it('con azureDevOpsEnabled=true, el botón aparece solo tras generar el reporte, se habilita con un ID numérico, y publica con éxito', async () => {
    const fetchMock = mockFetch();

    render(
      <Runner
        session={SESSION}
        currentStep={CURRENT_STEP}
        onSessionUpdate={vi.fn()}
        onError={vi.fn()}
        onSessionClosed={vi.fn()}
        onBackToSelection={vi.fn()}
        jiraEnabled={false}
        azureDevOpsEnabled={true}
        jiraTokenConfigured={false}
        azureDevOpsTokenConfigured={true}
      />,
    );

    // Sin reporte generado todavía: ni el input ni el botón existen.
    expect(
      screen.queryByRole('button', { name: /adjuntar a azure devops/i }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /generar reporte/i }));
    await waitFor(() =>
      expect(screen.getByRole('link', { name: /ver reporte/i })).toBeInTheDocument(),
    );

    const publishButton = screen.getByRole('button', { name: /adjuntar a azure devops/i });
    expect(publishButton).toBeDisabled();

    // Un valor no numérico nunca habilita el botón.
    fireEvent.input(screen.getByLabelText(/id del work item de azure devops/i), {
      target: { value: 'no-es-un-numero' },
    });
    expect(publishButton).toBeDisabled();

    fireEvent.input(screen.getByLabelText(/id del work item de azure devops/i), {
      target: { value: '123' },
    });
    expect(publishButton).not.toBeDisabled();

    fireEvent.click(publishButton);

    await waitFor(() =>
      expect(screen.getByRole('link', { name: /ver work item en azure devops/i })).toBeInTheDocument(),
    );
    expect(screen.getByRole('link', { name: /ver work item en azure devops/i })).toHaveAttribute(
      'href',
      'https://dev.azure.com/tuorg/Checkout/_workitems/edit/123',
    );
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/report/publish-azure-devops',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ workItemId: 123 }),
      }),
    );
  });

  it('con azureDevOpsEnabled=true, un fallo de Azure DevOps llama a onError en vez de mostrar el link de éxito', async () => {
    mockFetch({}, { ok: false, status: 404 });
    const onError = vi.fn();

    render(
      <Runner
        session={SESSION}
        currentStep={CURRENT_STEP}
        onSessionUpdate={vi.fn()}
        onError={onError}
        onSessionClosed={vi.fn()}
        onBackToSelection={vi.fn()}
        jiraEnabled={false}
        azureDevOpsEnabled={true}
        jiraTokenConfigured={false}
        azureDevOpsTokenConfigured={true}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /generar reporte/i }));
    await waitFor(() =>
      expect(screen.getByRole('link', { name: /ver reporte/i })).toBeInTheDocument(),
    );

    fireEvent.input(screen.getByLabelText(/id del work item de azure devops/i), {
      target: { value: '404' },
    });
    fireEvent.click(screen.getByRole('button', { name: /adjuntar a azure devops/i }));

    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'AZURE_DEVOPS_WORK_ITEM_NOT_FOUND' }),
    );
    expect(
      screen.queryByRole('link', { name: /ver work item en azure devops/i }),
    ).not.toBeInTheDocument();
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
        onBackToSelection={vi.fn()}
        jiraEnabled={false}
        azureDevOpsEnabled={false}
        jiraTokenConfigured={false}
        azureDevOpsTokenConfigured={false}
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
        onBackToSelection={vi.fn()}
        jiraEnabled={false}
        azureDevOpsEnabled={false}
        jiraTokenConfigured={false}
        azureDevOpsTokenConfigured={false}
      />,
    );

    expect(screen.getByRole('button', { name: /siguiente/i })).toBeInTheDocument();
  });
});

describe('Runner — Marcar resultado como Fail', () => {
  it('cascada el fail y salta directo al siguiente scenario, sin llamar a /api/session/navigate otra vez', async () => {
    // Dos scenarios en la misma feature: al fallar el primer step del
    // primero, `sessionEngine.setStepResult` (ver core/session/sessionEngine.ts)
    // ya cascadea fail a TODO ese scenario y mueve `currentPosition` directo
    // al primer step del segundo scenario, DENTRO de la misma response de
    // `/result`. El cliente (`Runner.handleSubmitResult`) no debe llamar a
    // `/api/session/navigate` de nuevo en este caso — eso avanzaría un step
    // de más sobre el salto que el server ya hizo.
    const sessionWithTwoScenarios: SessionState = {
      ...SESSION,
      status: 'in_progress',
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
                  result: 'pending',
                  evidenceFileIds: [],
                  timestamps: {},
                },
              ],
            },
            {
              id: 'f0-login_s1',
              name: 'Failed login',
              tags: [],
              steps: [
                {
                  id: 'f0-login_s1_st0',
                  step: {
                    keyword: 'Given',
                    text: 'a registered user',
                    fromBackground: false,
                  },
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
    const currentStep = {
      featureId: 'f0-login',
      scenarioId: 'f0-login_s0',
      step: sessionWithTwoScenarios.selectedFeatures[0].scenarios[0].steps[0],
    };
    const nextScenarioStep = sessionWithTwoScenarios.selectedFeatures[0].scenarios[1].steps[0];

    const jumpedSession: SessionState = {
      ...sessionWithTwoScenarios,
      currentPosition: { featureIndex: 0, scenarioIndex: 1, stepIndex: 0 },
      selectedFeatures: [
        {
          ...sessionWithTwoScenarios.selectedFeatures[0],
          scenarios: [
            {
              ...sessionWithTwoScenarios.selectedFeatures[0].scenarios[0],
              steps: sessionWithTwoScenarios.selectedFeatures[0].scenarios[0].steps.map(
                (step) => ({ ...step, result: 'fail' as const, defectDescription: 'Pantalla rota' }),
              ),
            },
            sessionWithTwoScenarios.selectedFeatures[0].scenarios[1],
          ],
        },
      ],
    };
    const jumpedCurrentStep = {
      featureId: 'f0-login',
      scenarioId: 'f0-login_s1',
      step: nextScenarioStep,
    };

    const navigateSpy = vi.fn();
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/result')) {
        return Promise.resolve({
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => ({ session: jumpedSession, currentStep: jumpedCurrentStep }),
        });
      }
      if (url.includes('/navigate')) {
        navigateSpy(url);
        return Promise.resolve({
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => ({ session: jumpedSession, currentStep: jumpedCurrentStep }),
        });
      }
      return Promise.resolve({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ evidenceFiles: [] }),
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const onSessionUpdate = vi.fn();

    render(
      <Runner
        session={sessionWithTwoScenarios}
        currentStep={currentStep}
        onSessionUpdate={onSessionUpdate}
        onError={vi.fn()}
        onSessionClosed={vi.fn()}
        onBackToSelection={vi.fn()}
        jiraEnabled={false}
        azureDevOpsEnabled={false}
        jiraTokenConfigured={false}
        azureDevOpsTokenConfigured={false}
      />,
    );

    fireEvent.input(screen.getByLabelText(/descripción del defecto/i), {
      target: { value: 'Pantalla rota' },
    });
    // Regex anclada (no solo /fail/i): el fixture de esta sesión tiene un
    // scenario llamado "Failed login", cuyo botón de edición (StepTree,
    // agregado por la feature de edición de casos de prueba pendientes)
    // también matchearía /fail/i por su aria-label ("Editar caso de prueba
    // \"Failed login\"") si no se ancla al texto exacto del botón real.
    fireEvent.click(screen.getByRole('button', { name: /^✕ fail$/i }));

    await waitFor(() =>
      expect(onSessionUpdate).toHaveBeenCalledWith(jumpedSession, jumpedCurrentStep),
    );
    expect(navigateSpy).not.toHaveBeenCalled();
  });
});

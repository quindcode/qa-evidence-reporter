// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SettingsPanel } from './SettingsPanel';
import type { Settings } from '../types';

afterEach(cleanup);

const BASE_SETTINGS: Settings = {
  projectName: 'Proyecto Demo',
  jira: { baseUrl: null, email: null, tokenConfigured: false },
  azureDevOps: { organizationUrl: null, project: null, tokenConfigured: false },
};

/** Responde según método+ruta — mismo patrón que `Runner.test.tsx`. */
function mockFetch(handlers: {
  patchSettings?: Settings;
  jiraToken?: Settings;
  azureToken?: Settings;
}): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const jsonResponse = (body: unknown, ok = true) =>
      Promise.resolve({
        ok,
        headers: { get: () => 'application/json' },
        json: async () => body,
      });

    if (url === '/api/settings' && method === 'PATCH') {
      return jsonResponse(handlers.patchSettings ?? BASE_SETTINGS);
    }
    if (url === '/api/settings/jira-token' && method === 'POST') {
      return jsonResponse(handlers.jiraToken ?? BASE_SETTINGS);
    }
    if (url === '/api/settings/azure-token' && method === 'POST') {
      return jsonResponse(handlers.azureToken ?? BASE_SETTINGS);
    }
    return jsonResponse({ error: { code: 'UNKNOWN_ERROR', message: `sin mock para ${method} ${url}` } }, false);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('SettingsPanel', () => {
  it('precarga los campos no-secretos con los valores de `settings`, y los de token siempre vacíos', () => {
    mockFetch({});
    render(
      <SettingsPanel
        settings={{
          projectName: 'Tienda Online Quind',
          jira: { baseUrl: 'https://tuempresa.atlassian.net', email: 'qa@tuempresa.com', tokenConfigured: true },
          azureDevOps: { organizationUrl: 'https://dev.azure.com/tuorg', project: 'Checkout', tokenConfigured: false },
        }}
        onSettingsUpdate={vi.fn()}
        onError={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByLabelText(/nombre del proyecto/i)).toHaveValue('Tienda Online Quind');
    expect(screen.getByLabelText(/base url/i)).toHaveValue('https://tuempresa.atlassian.net');
    expect(screen.getByLabelText(/email de la cuenta/i)).toHaveValue('qa@tuempresa.com');
    expect(screen.getByLabelText(/url de la organización/i)).toHaveValue('https://dev.azure.com/tuorg');
    expect(screen.getByLabelText(/^proyecto$/i)).toHaveValue('Checkout');
    // Los campos de token NUNCA se precargan, ni con un placeholder que
    // insinúe el valor — el token real nunca llega al cliente.
    expect(screen.getByPlaceholderText(/token de api de jira/i)).toHaveValue('');
    expect(screen.getByText('Configurado')).toBeInTheDocument();
    expect(screen.getByText('No configurado')).toBeInTheDocument();
  });

  it('"Guardar configuración" manda un PATCH con los 5 campos no-secretos y notifica el resultado', async () => {
    const updated: Settings = {
      projectName: 'Nombre Nuevo',
      jira: { baseUrl: 'https://nuevo.atlassian.net', email: 'qa@nuevo.com', tokenConfigured: false },
      azureDevOps: { organizationUrl: null, project: null, tokenConfigured: false },
    };
    const fetchMock = mockFetch({ patchSettings: updated });
    const onSettingsUpdate = vi.fn();

    render(
      <SettingsPanel
        settings={BASE_SETTINGS}
        onSettingsUpdate={onSettingsUpdate}
        onError={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    fireEvent.input(screen.getByLabelText(/nombre del proyecto/i), {
      target: { value: 'Nombre Nuevo' },
    });
    fireEvent.input(screen.getByLabelText(/base url/i), {
      target: { value: 'https://nuevo.atlassian.net' },
    });
    fireEvent.input(screen.getByLabelText(/email de la cuenta/i), {
      target: { value: 'qa@nuevo.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: /guardar configuración/i }));

    await waitFor(() => expect(onSettingsUpdate).toHaveBeenCalledWith(updated));

    const [, init] = fetchMock.mock.calls.find(([url]) => url === '/api/settings') as [
      string,
      RequestInit,
    ];
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual({
      projectName: 'Nombre Nuevo',
      jira: { baseUrl: 'https://nuevo.atlassian.net', email: 'qa@nuevo.com' },
      azureDevOps: { organizationUrl: null, project: null },
    });
  });

  it('un campo de URL vacío se manda como null, no como string vacío', async () => {
    const fetchMock = mockFetch({});
    render(
      <SettingsPanel
        settings={{
          ...BASE_SETTINGS,
          jira: { baseUrl: 'https://viejo.atlassian.net', email: null, tokenConfigured: false },
        }}
        onSettingsUpdate={vi.fn()}
        onError={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    fireEvent.input(screen.getByLabelText(/base url/i), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /guardar configuración/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [, init] = fetchMock.mock.calls.find(([url]) => url === '/api/settings') as [
      string,
      RequestInit,
    ];
    expect(JSON.parse(init.body as string).jira.baseUrl).toBeNull();
  });

  it('"Guardar token" de Jira manda el token en el body y limpia el campo al terminar', async () => {
    const updated: Settings = { ...BASE_SETTINGS, jira: { ...BASE_SETTINGS.jira, tokenConfigured: true } };
    const fetchMock = mockFetch({ jiraToken: updated });
    const onSettingsUpdate = vi.fn();

    render(
      <SettingsPanel
        settings={BASE_SETTINGS}
        onSettingsUpdate={onSettingsUpdate}
        onError={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const tokenField = screen.getByPlaceholderText(/token de api de jira/i);
    fireEvent.input(tokenField, { target: { value: 'un-token-secreto' } });
    // Hay dos botones "Guardar token" (Jira y Azure DevOps) — el de Jira es
    // el primero en el DOM.
    fireEvent.click(screen.getAllByRole('button', { name: /guardar token/i })[0]);

    await waitFor(() => expect(onSettingsUpdate).toHaveBeenCalledWith(updated));

    const [, init] = fetchMock.mock.calls.find(([url]) => url === '/api/settings/jira-token') as [
      string,
      RequestInit,
    ];
    expect(JSON.parse(init.body as string)).toEqual({ token: 'un-token-secreto' });
    expect(tokenField).toHaveValue('');
  });

  it('el botón "Guardar token" queda deshabilitado mientras el campo esté vacío', () => {
    mockFetch({});
    render(
      <SettingsPanel
        settings={BASE_SETTINGS}
        onSettingsUpdate={vi.fn()}
        onError={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const [jiraSaveButton] = screen.getAllByRole('button', { name: /guardar token/i });
    expect(jiraSaveButton).toBeDisabled();
  });

  it('"Quitar" (solo visible con token configurado) manda token: null', async () => {
    const cleared: Settings = { ...BASE_SETTINGS, jira: { ...BASE_SETTINGS.jira, tokenConfigured: false } };
    const fetchMock = mockFetch({ jiraToken: cleared });
    const onSettingsUpdate = vi.fn();

    render(
      <SettingsPanel
        settings={{ ...BASE_SETTINGS, jira: { ...BASE_SETTINGS.jira, tokenConfigured: true } }}
        onSettingsUpdate={onSettingsUpdate}
        onError={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /quitar/i }));

    await waitFor(() => expect(onSettingsUpdate).toHaveBeenCalledWith(cleared));
    const [, init] = fetchMock.mock.calls.find(([url]) => url === '/api/settings/jira-token') as [
      string,
      RequestInit,
    ];
    expect(JSON.parse(init.body as string)).toEqual({ token: null });
  });

  it('sin token configurado, no se muestra el botón "Quitar"', () => {
    mockFetch({});
    render(
      <SettingsPanel
        settings={BASE_SETTINGS}
        onSettingsUpdate={vi.fn()}
        onError={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: /quitar/i })).not.toBeInTheDocument();
  });

  it('"Volver" dispara onClose', () => {
    mockFetch({});
    const onClose = vi.fn();
    render(
      <SettingsPanel
        settings={BASE_SETTINGS}
        onSettingsUpdate={vi.fn()}
        onError={vi.fn()}
        onClose={onClose}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /volver/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('un error de red al guardar llama a onError, no a onSettingsUpdate', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('network down')),
    );
    const onError = vi.fn();
    const onSettingsUpdate = vi.fn();

    render(
      <SettingsPanel
        settings={BASE_SETTINGS}
        onSettingsUpdate={onSettingsUpdate}
        onError={onError}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /guardar configuración/i }));

    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect(onSettingsUpdate).not.toHaveBeenCalled();
  });
});

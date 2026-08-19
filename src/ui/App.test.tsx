// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';

afterEach(() => {
  cleanup();
  // `applyBranding` (App.tsx) escribe custom properties inline en <html> —
  // sin esto, un test con branding "contamina" el siguiente (jsdom conserva
  // el DOM entre tests de este archivo).
  document.documentElement.removeAttribute('style');
});

function mockFeaturesResponse(body: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => body,
    }),
  );
}

const FEATURES_RESPONSE = {
  features: [],
  session: { exists: false },
  projectName: 'Proyecto Demo',
  branding: { logoUrl: null, primaryColor: null, accentColor: null, highlightColor: null, ctaColor: null },
  jira: { enabled: false, tokenConfigured: false },
  azureDevOps: { enabled: false, tokenConfigured: false },
};

const SETTINGS_RESPONSE = {
  projectName: 'Proyecto Demo',
  jira: { baseUrl: null, email: null, tokenConfigured: false },
  azureDevOps: { organizationUrl: null, project: null, tokenConfigured: false },
};

/**
 * Rutea por URL — `GET /api/features` y `GET /api/settings` responden
 * distinto. `jiraTokenResponse` (opcional) permite simular `POST
 * /api/settings/jira-token` devolviendo `tokenConfigured: true`, para
 * probar el flujo de "guardar token" sin tocar `/api/features` de verdad.
 */
function mockFeaturesAndSettings(jiraTokenResponse?: unknown): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn().mockImplementation((url: string) => {
    const body =
      url === '/api/settings/jira-token' && jiraTokenResponse
        ? jiraTokenResponse
        : url === '/api/settings'
          ? SETTINGS_RESPONSE
          : FEATURES_RESPONSE;
    return Promise.resolve({
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => body,
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('App — branding', () => {
  it('sin branding configurado: usa el projectName real, sin logo ni clase de marca', async () => {
    mockFeaturesResponse({
      features: [],
      session: { exists: false },
      projectName: 'Mi Proyecto QA',
      branding: {
        logoUrl: null,
        primaryColor: null,
        accentColor: null,
        highlightColor: null,
        ctaColor: null,
      },
      jira: { enabled: false, tokenConfigured: false },
      azureDevOps: { enabled: false, tokenConfigured: false },
    });

    render(<App />);

    await waitFor(() => expect(screen.getByText('Mi Proyecto QA')).toBeInTheDocument());
    // Ningún ErrorBanner (role="alert") — confirma que `loadFeatures` no
    // pisó silenciosamente un throw (p. ej. leer un campo de la respuesta
    // que el mock no incluye) con un ApiRequestError genérico.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /logo/i })).not.toBeInTheDocument();
    expect(document.querySelector('.app-header--branded')).toBeNull();
    expect(document.querySelector('.app-header__stripe')).toBeNull();
    expect(document.documentElement.style.getPropertyValue('--accent')).toBe('');
  });

  it('con branding configurado: muestra el logo, la clase de marca, la franja, y aplica los colores como custom properties', async () => {
    mockFeaturesResponse({
      features: [],
      session: { exists: false },
      projectName: 'Tienda Online Quind',
      branding: {
        logoUrl: '/branding/logo',
        primaryColor: '#1e3543',
        accentColor: '#00c4e9',
        highlightColor: '#ffb91c',
        ctaColor: '#ff5530',
      },
      jira: { enabled: false, tokenConfigured: false },
      azureDevOps: { enabled: false, tokenConfigured: false },
    });

    render(<App />);

    await waitFor(() => expect(screen.getByText('Tienda Online Quind')).toBeInTheDocument());

    const logo = screen.getByRole('img', { name: /logo de tienda online quind/i });
    expect(logo).toHaveAttribute('src', '/branding/logo');
    expect(document.querySelector('.app-header--branded')).not.toBeNull();
    expect(document.querySelector('.app-header__stripe')).not.toBeNull();

    const rootStyle = document.documentElement.style;
    expect(rootStyle.getPropertyValue('--accent')).toBe('#00c4e9');
    // Cian es un color claro/vívido: el texto legible sobre él es oscuro, no blanco (ver `colors.ts`).
    expect(rootStyle.getPropertyValue('--accent-contrast')).toBe('#111111');
    expect(rootStyle.getPropertyValue('--brand-primary')).toBe('#1e3543');
    expect(rootStyle.getPropertyValue('--brand-primary-contrast')).toBe('#ffffff');
    expect(rootStyle.getPropertyValue('--brand-highlight')).toBe('#ffb91c');
    expect(rootStyle.getPropertyValue('--brand-cta')).toBe('#ff5530');
  });

  it('con solo un logo configurado (sin colores): igual se considera "con marca" (isBranded)', async () => {
    mockFeaturesResponse({
      features: [],
      session: { exists: false },
      projectName: 'Proyecto X',
      branding: {
        logoUrl: '/branding/logo',
        primaryColor: null,
        accentColor: null,
        highlightColor: null,
        ctaColor: null,
      },
      jira: { enabled: false, tokenConfigured: false },
      azureDevOps: { enabled: false, tokenConfigured: false },
    });

    render(<App />);

    await waitFor(() => expect(screen.getByText('Proyecto X')).toBeInTheDocument());
    expect(document.querySelector('.app-header--branded')).not.toBeNull();
  });
});

describe('App — Configuración', () => {
  it('el botón del header carga GET /api/settings y muestra el panel; "Volver" regresa a la pantalla anterior', async () => {
    mockFeaturesAndSettings();
    render(<App />);

    await waitFor(() => expect(screen.getByText('Proyecto Demo')).toBeInTheDocument());
    // Todavía en la pantalla de selección (sin sesión existente).
    expect(screen.getByText(/seleccioná las features a ejecutar/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /configuración/i }));

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Configuración' })).toBeInTheDocument());
    expect(screen.getByLabelText(/nombre del proyecto/i)).toHaveValue('Proyecto Demo');
    // La pantalla de selección queda oculta mientras se ve Configuración.
    expect(screen.queryByText(/seleccioná las features a ejecutar/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /volver/i }));

    await waitFor(() =>
      expect(screen.getByText(/seleccioná las features a ejecutar/i)).toBeInTheDocument(),
    );
    expect(screen.queryByRole('heading', { name: 'Configuración' })).not.toBeInTheDocument();
  });

  it('guardar un token (ej. para resolver "Token no configurado" avisado en el Runner) NO expulsa de Configuración de vuelta a la selección', async () => {
    // Regresión: `handleSettingsUpdate` (App.tsx) recargaba `GET
    // /api/features` reusando `loadFeatures()`, que SIEMPRE forzaba
    // `phase` a 'select' en su `finally` — pensado para la carga inicial
    // de la app, pero con el efecto colateral de cerrar Configuración de
    // golpe (o, si se abrió desde el Runner, tirar al usuario de vuelta a
    // la selección de features) apenas se guardaba CUALQUIER cambio,
    // incluido un token. `loadFeatures(false)` en `handleSettingsUpdate`
    // evita este salto de fase.
    const updatedSettings = {
      ...SETTINGS_RESPONSE,
      jira: { ...SETTINGS_RESPONSE.jira, tokenConfigured: true },
    };
    mockFeaturesAndSettings(updatedSettings);
    render(<App />);

    await waitFor(() => expect(screen.getByText('Proyecto Demo')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /configuración/i }));
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Configuración' })).toBeInTheDocument(),
    );

    fireEvent.input(screen.getByPlaceholderText(/token de api de jira/i), {
      target: { value: 'un-token-secreto' },
    });
    fireEvent.click(screen.getAllByRole('button', { name: /guardar token/i })[0]!);

    // El estado se refresca con la respuesta simulada (tokenConfigured:
    // true) y, sobre todo, sigue en Configuración — NO saltó a la pantalla
    // de selección.
    await waitFor(() => expect(screen.getByText('Configurado')).toBeInTheDocument());
    expect(screen.getByRole('heading', { name: 'Configuración' })).toBeInTheDocument();
    expect(screen.queryByText(/seleccioná las features a ejecutar/i)).not.toBeInTheDocument();
  });
});

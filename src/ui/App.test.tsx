// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/preact';
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
      jira: { enabled: false },
      azureDevOps: { enabled: false },
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
      jira: { enabled: false },
      azureDevOps: { enabled: false },
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
      jira: { enabled: false },
      azureDevOps: { enabled: false },
    });

    render(<App />);

    await waitFor(() => expect(screen.getByText('Proyecto X')).toBeInTheDocument());
    expect(document.querySelector('.app-header--branded')).not.toBeNull();
  });
});

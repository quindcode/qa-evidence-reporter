// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FeatureSelect } from './FeatureSelect';
import type { FeatureSummary, SessionSummary } from '../types';

// `@testing-library/preact` solo auto-registra `afterEach(cleanup)` cuando
// detecta un `afterEach` GLOBAL (ver su `src/index.js`, `typeof afterEach
// === 'function'`) — este proyecto no habilita `test.globals` en Vitest
// (para no filtrar globals de test a `core/**`/`adapters/**`), así que cada
// archivo de test que renderiza un componente lo registra a mano.
afterEach(cleanup);

const FEATURES: FeatureSummary[] = [
  {
    id: 'login.feature',
    name: 'Inicio de sesión',
    description: '',
    tags: ['@smoke'],
    scenarioCount: 2,
  },
  {
    id: 'checkout.feature',
    name: 'Checkout',
    description: 'Flujo de compra',
    tags: [],
    scenarioCount: 1,
  },
];

describe('FeatureSelect', () => {
  it('renderiza la lista de features con sus tags/cantidad de scenarios', () => {
    render(
      <FeatureSelect
        features={FEATURES}
        sessionSummary={{ exists: false }}
        busy={false}
        onStart={vi.fn()}
        onContinue={vi.fn()}
      />,
    );

    expect(screen.getByText('Inicio de sesión')).toBeInTheDocument();
    expect(screen.getByText('Checkout')).toBeInTheDocument();
    expect(screen.getByText('2 escenarios')).toBeInTheDocument();
    expect(screen.getByText('1 escenario')).toBeInTheDocument();
    expect(screen.getByText('@smoke')).toBeInTheDocument();
  });

  it('el botón de iniciar ejecución queda deshabilitado sin ninguna feature seleccionada', () => {
    render(
      <FeatureSelect
        features={FEATURES}
        sessionSummary={{ exists: false }}
        busy={false}
        onStart={vi.fn()}
        onContinue={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: /iniciar ejecución/i })).toBeDisabled();
  });

  it('seleccionar features y confirmar llama a onStart con los ids elegidos', () => {
    const onStart = vi.fn();
    render(
      <FeatureSelect
        features={FEATURES}
        sessionSummary={{ exists: false }}
        busy={false}
        onStart={onStart}
        onContinue={vi.fn()}
      />,
    );

    fireEvent.click(screen.getAllByRole('checkbox')[0]);
    fireEvent.click(screen.getByRole('button', { name: /iniciar ejecución/i }));

    expect(onStart).toHaveBeenCalledWith(['login.feature'], false);
  });

  it('muestra el banner de sesión en curso y permite continuarla', () => {
    const onContinue = vi.fn();
    const sessionSummary: SessionSummary = {
      exists: true,
      status: 'in_progress',
      projectName: 'Demo',
    };
    render(
      <FeatureSelect
        features={FEATURES}
        sessionSummary={sessionSummary}
        busy={false}
        onStart={vi.fn()}
        onContinue={onContinue}
      />,
    );

    expect(screen.getByText(/sesión en curso/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /continuar sesión/i }));
    expect(onContinue).toHaveBeenCalledTimes(1);
  });
});

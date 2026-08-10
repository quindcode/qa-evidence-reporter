// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { StepResultPanel } from './StepResultPanel';

// Ver `FeatureSelect.test.tsx` para por qué esto se registra a mano en cada archivo.
afterEach(cleanup);

describe('StepResultPanel', () => {
  it('renderiza los 3 botones de resultado', () => {
    render(
      <StepResultPanel
        notes=""
        defectDescription=""
        onNotesChange={vi.fn()}
        onDefectDescriptionChange={vi.fn()}
        busy={false}
        defectFieldRef={{ current: null }}
        onPass={vi.fn()}
        onFail={vi.fn()}
        onSkip={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: /pass/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /fail/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /skip/i })).toBeInTheDocument();
  });

  it('el botón Fail queda deshabilitado mientras defectDescription esté vacío', () => {
    render(
      <StepResultPanel
        notes=""
        defectDescription=""
        onNotesChange={vi.fn()}
        onDefectDescriptionChange={vi.fn()}
        busy={false}
        defectFieldRef={{ current: null }}
        onPass={vi.fn()}
        onFail={vi.fn()}
        onSkip={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: /fail/i })).toBeDisabled();
  });

  it('el botón Fail queda deshabilitado con defectDescription solo espacios (trim)', () => {
    render(
      <StepResultPanel
        notes=""
        defectDescription="   "
        onNotesChange={vi.fn()}
        onDefectDescriptionChange={vi.fn()}
        busy={false}
        defectFieldRef={{ current: null }}
        onPass={vi.fn()}
        onFail={vi.fn()}
        onSkip={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: /fail/i })).toBeDisabled();
  });

  it('el botón Fail se habilita y dispara onFail con defectDescription no vacío', () => {
    const onFail = vi.fn();
    render(
      <StepResultPanel
        notes=""
        defectDescription="El botón no responde"
        onNotesChange={vi.fn()}
        onDefectDescriptionChange={vi.fn()}
        busy={false}
        defectFieldRef={{ current: null }}
        onPass={vi.fn()}
        onFail={onFail}
        onSkip={vi.fn()}
      />,
    );

    const failButton = screen.getByRole('button', { name: /fail/i });
    expect(failButton).toBeEnabled();
    fireEvent.click(failButton);
    expect(onFail).toHaveBeenCalledTimes(1);
  });

  it('Pass y Skip nunca se deshabilitan por defectDescription vacío', () => {
    const onPass = vi.fn();
    const onSkip = vi.fn();
    render(
      <StepResultPanel
        notes=""
        defectDescription=""
        onNotesChange={vi.fn()}
        onDefectDescriptionChange={vi.fn()}
        busy={false}
        defectFieldRef={{ current: null }}
        onPass={onPass}
        onFail={vi.fn()}
        onSkip={onSkip}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /pass/i }));
    fireEvent.click(screen.getByRole('button', { name: /skip/i }));
    expect(onPass).toHaveBeenCalledTimes(1);
    expect(onSkip).toHaveBeenCalledTimes(1);
  });
});

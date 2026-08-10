// @vitest-environment jsdom
import { cleanup, renderHook } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useKeyboardShortcuts } from './useKeyboardShortcuts';

// Ver `FeatureSelect.test.tsx` (mismo directorio padre) para por qué esto se
// registra a mano en cada archivo: sin esto, el listener de `document`
// agregado por `renderHook` de un test sigue vivo en el siguiente.
afterEach(cleanup);

function press(key: string): void {
  document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
}

describe('useKeyboardShortcuts', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('P/F/S/N/B disparan sus respectivos handlers cuando el foco no está en un campo de texto', () => {
    const handlers = {
      onPass: vi.fn(),
      onFail: vi.fn(),
      onSkip: vi.fn(),
      onNext: vi.fn(),
      onPrevious: vi.fn(),
    };
    renderHook(() => useKeyboardShortcuts(handlers));

    press('p');
    press('f');
    press('s');
    press('n');
    press('b');

    expect(handlers.onPass).toHaveBeenCalledTimes(1);
    expect(handlers.onFail).toHaveBeenCalledTimes(1);
    expect(handlers.onSkip).toHaveBeenCalledTimes(1);
    expect(handlers.onNext).toHaveBeenCalledTimes(1);
    expect(handlers.onPrevious).toHaveBeenCalledTimes(1);
  });

  it('funcionan con mayúsculas también (case-insensitive)', () => {
    const handlers = {
      onPass: vi.fn(),
      onFail: vi.fn(),
      onSkip: vi.fn(),
      onNext: vi.fn(),
      onPrevious: vi.fn(),
    };
    renderHook(() => useKeyboardShortcuts(handlers));

    press('P');
    expect(handlers.onPass).toHaveBeenCalledTimes(1);
  });

  it('se ignoran por completo cuando el foco está en un <input>', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    const handlers = {
      onPass: vi.fn(),
      onFail: vi.fn(),
      onSkip: vi.fn(),
      onNext: vi.fn(),
      onPrevious: vi.fn(),
    };
    renderHook(() => useKeyboardShortcuts(handlers));

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', bubbles: true }));

    expect(handlers.onPass).not.toHaveBeenCalled();
  });

  it('se ignoran por completo cuando el foco está en un <textarea>', () => {
    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);
    textarea.focus();

    const handlers = {
      onPass: vi.fn(),
      onFail: vi.fn(),
      onSkip: vi.fn(),
      onNext: vi.fn(),
      onPrevious: vi.fn(),
    };
    renderHook(() => useKeyboardShortcuts(handlers));

    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', bubbles: true }));

    expect(handlers.onFail).not.toHaveBeenCalled();
  });

  it('no dispara nada cuando enabled=false', () => {
    const handlers = {
      onPass: vi.fn(),
      onFail: vi.fn(),
      onSkip: vi.fn(),
      onNext: vi.fn(),
      onPrevious: vi.fn(),
    };
    renderHook(() => useKeyboardShortcuts(handlers, false));

    press('p');

    expect(handlers.onPass).not.toHaveBeenCalled();
  });
});

import { useEffect } from 'preact/hooks';

export interface KeyboardShortcutHandlers {
  onPass: () => void;
  onFail: () => void;
  onSkip: () => void;
  onNext: () => void;
  onPrevious: () => void;
}

/** Nombres de tag donde el usuario puede estar escribiendo texto — los atajos se deshabilitan ahí (ARCHITECTURE.md, "UX del runner"). */
const TEXT_INPUT_TAGS = new Set(['INPUT', 'TEXTAREA']);

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (TEXT_INPUT_TAGS.has(target.tagName)) return true;
  return target.isContentEditable;
}

/**
 * Atajos de teclado del runner: `P`/`F`/`S` (marcar resultado), `N`/`B`
 * (navegar). Deshabilitados por completo mientras el foco esté en un
 * `<input>`/`<textarea>`/elemento editable (para no interferir con la
 * escritura de notas/descripción de defecto) — ver ARCHITECTURE.md, "UX del
 * runner".
 *
 * `enabled` permite además desactivarlos por completo desde el caller (p.
 * ej. mientras no hay ningún step actual, o mientras una request a la API
 * está en curso) sin duplicar esa condición en cada handler.
 */
export function useKeyboardShortcuts(
  handlers: KeyboardShortcutHandlers,
  enabled: boolean = true,
): void {
  useEffect(() => {
    if (!enabled) return undefined;

    function onKeyDown(event: KeyboardEvent): void {
      if (isTypingTarget(event.target)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      switch (event.key.toLowerCase()) {
        case 'p':
          event.preventDefault();
          handlers.onPass();
          break;
        case 'f':
          event.preventDefault();
          handlers.onFail();
          break;
        case 's':
          event.preventDefault();
          handlers.onSkip();
          break;
        case 'n':
          event.preventDefault();
          handlers.onNext();
          break;
        case 'b':
          event.preventDefault();
          handlers.onPrevious();
          break;
        default:
          break;
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [enabled, handlers]);
}

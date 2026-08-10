import type { JSX } from 'preact';

export interface ErrorBannerProps {
  code: string;
  message: string;
  onDismiss: () => void;
}

/**
 * Banner de error visible (nunca un error de consola silencioso — ver la
 * consigna de esta fase, "Manejo de errores en la UI"). Se usa para
 * cualquier `ApiRequestError` (`{ code, message }`, ver `api.ts`) que llegue
 * de una llamada a la API.
 */
export function ErrorBanner({ code, message, onDismiss }: ErrorBannerProps): JSX.Element {
  return (
    <div class="error-banner" role="alert">
      <span class="error-banner__code">{code}</span>
      <span class="error-banner__message">{message}</span>
      <button
        type="button"
        class="error-banner__dismiss"
        onClick={onDismiss}
        aria-label="Descartar error"
      >
        ×
      </button>
    </div>
  );
}

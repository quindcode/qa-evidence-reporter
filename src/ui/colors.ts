import type { StepResult } from './types';

/**
 * Paleta de color por `StepResult`, DUPLICADA a propósito de
 * `src/core/report/charts.ts` (`RESULT_COLORS`) — mismos 4 valores hex,
 * copiados a mano, NO importados. `ui/` nunca puede importar `core/**` (ver
 * ARCHITECTURE.md, regla de dependencia estricta, y el JSDoc de
 * `src/ui/types.ts`), así que esta es la misma situación que ya documentó
 * fase 3 para `templates/default/partials/styles.hbs` (CSS tampoco puede
 * importar un módulo TypeScript): un comentario cruzado en ambos archivos
 * para que no diverjan silenciosamente si se cambia uno.
 *
 * Si cambiás estos valores, cambiá también `src/core/report/charts.ts` (y
 * viceversa) para que el runner y el reporte HTML final sigan usando la
 * misma paleta de estado.
 */
export const RESULT_COLORS: Readonly<Record<StepResult, string>> = {
  pass: '#15803d',
  fail: '#b91c1c',
  skip: '#57534e',
  pending: '#b45309',
};

export const RESULT_LABELS: Readonly<Record<StepResult, string>> = {
  pass: 'Aprobado',
  fail: 'Fallido',
  skip: 'Omitido',
  pending: 'Pendiente',
};

/**
 * Elige `#ffffff` o `#111111` como color de texto legible sobre un fondo
 * `hexColor`, por contraste WCAG — DUPLICADO a propósito de
 * `pickReadableTextColor` en `core/report/reportGenerator.ts` (misma razón
 * que `RESULT_COLORS` arriba: `ui/` no puede importar `core/**`). Si cambiás
 * la fórmula acá, cambiala también allá.
 */
export function pickReadableTextColor(hexColor: string): '#ffffff' | '#111111' {
  const rgb = parseHexColor(hexColor);
  if (!rgb) return '#111111';

  const bgLuminance = relativeLuminance(rgb);
  const contrastWithWhite = (1 + 0.05) / (bgLuminance + 0.05);
  const contrastWithBlack = (bgLuminance + 0.05) / 0.05;

  return contrastWithWhite >= contrastWithBlack ? '#ffffff' : '#111111';
}

function parseHexColor(hexColor: string): [number, number, number] | null {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hexColor.trim());
  const hex = match?.[1];
  if (!hex) return null;

  const full = hex.length === 3 ? hex.replace(/(.)/g, '$1$1') : hex;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

function toLinearChannel(channel: number): number {
  const normalized = channel / 255;
  return normalized <= 0.03928 ? normalized / 12.92 : Math.pow((normalized + 0.055) / 1.055, 2.4);
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  return 0.2126 * toLinearChannel(r) + 0.7152 * toLinearChannel(g) + 0.0722 * toLinearChannel(b);
}

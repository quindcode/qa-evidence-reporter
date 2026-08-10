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

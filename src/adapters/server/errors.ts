import type { NextFunction, Request, RequestHandler, Response } from 'express';

import { QaError } from '../../core/types/errors.js';
import type { Logger } from '../../core/types/logger.js';

/**
 * Códigos de error que sólo existen a nivel de `adapters/server` (nunca los
 * lanza ningún módulo de `core/**`) — mismo criterio que
 * `adapters/cli/commands/*.ts` (`CONFIG_ALREADY_EXISTS`,
 * `FEATURES_DIR_NOT_FOUND`, `NOTHING_TO_REPORT`, ver ARCHITECTURE.md, "Fase
 * 4"): condiciones puramente de este adapter usan `QaError` instanciada
 * directamente, sin agregar una subclase dedicada por caso a
 * `core/types/errors.ts`.
 */
export const SESSION_ALREADY_IN_PROGRESS = 'SESSION_ALREADY_IN_PROGRESS';
export const NOTHING_TO_REPORT = 'NOTHING_TO_REPORT';
export const NO_REPORT_GENERATED = 'NO_REPORT_GENERATED';
export const FEATURE_NOT_FOUND = 'FEATURE_NOT_FOUND';
export const INVALID_REQUEST_BODY = 'INVALID_REQUEST_BODY';

/**
 * Mapa único código→status HTTP (ver la consigna de esta fase: "mapa
 * código→status, documentado en un solo lugar"). Cualquier código de
 * `QaError` no listado aquí cae a `500` (ver `statusForErrorCode`) — se
 * prefiere ese fallback conservador a que un código nuevo agregado a futuro
 * en `core/types/errors.ts` quede sin mapear y termine devolviendo `undefined`
 * como status.
 */
const ERROR_STATUS_BY_CODE: Readonly<Record<string, number>> = {
  // `core/**`
  FEATURE_PARSE_ERROR: 400,
  SESSION_NOT_FOUND: 404,
  INVALID_STEP_TRANSITION: 400,
  EVIDENCE_FILE_TOO_LARGE: 413,
  UNSUPPORTED_EVIDENCE_FORMAT: 415,
  REPORT_GENERATION_ERROR: 500,
  CONFIG_VALIDATION_ERROR: 400,
  CONFIG_NOT_FOUND: 404,
  // `adapters/server` (ver constantes arriba)
  [SESSION_ALREADY_IN_PROGRESS]: 409,
  [NOTHING_TO_REPORT]: 404,
  [NO_REPORT_GENERATED]: 404,
  [FEATURE_NOT_FOUND]: 400,
  [INVALID_REQUEST_BODY]: 400,
};

export function statusForErrorCode(code: string): number {
  return ERROR_STATUS_BY_CODE[code] ?? 500;
}

/**
 * Valida que un parámetro de ruta (`req.params[name]`) sea un string plano
 * (nunca `undefined`, nunca `string[]`) antes de usarlo.
 *
 * Necesario porque `express-serve-static-core` tipa `ParamsDictionary` como
 * `Record<string, string | string[]>` (para soportar params de wildcard
 * multi-segmento de `path-to-regexp`, ver `express@5`) y `tsconfig.json`
 * tiene `noUncheckedIndexedAccess: true` (fase 1) — leer `req.params.stepId`
 * da en tiempo de compilación `string | string[] | undefined`, aunque en la
 * práctica, para los patrones de ruta simples de este módulo (`:stepId`,
 * nunca `:stepId*`), Express siempre entrega un string. Se valida en
 * runtime de todas formas (en vez de forzar el tipo con `as string`) porque
 * es el mismo tipo de chequeo de "input no confiable" que ya se le exige al
 * body de cada request.
 */
export function requireStringParam(value: string | string[] | undefined, name: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new QaError(`El parámetro de ruta "${name}" es inválido.`, INVALID_REQUEST_BODY);
  }
  return value;
}

/**
 * Envuelve un handler de ruta async para que cualquier rechazo de la
 * `Promise` llegue a `next(error)` — Express no hace esto automáticamente
 * para handlers `async` (una excepción no controlada en una promesa nunca
 * llega al middleware de error si no se reenvía a mano). Evitar esto
 * disperso como `try/catch` repetido en cada ruta.
 */
export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<void>,
): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}

/**
 * Middleware de manejo de errores centralizado (último de la cadena, ver
 * `app.ts`). Cualquier `QaError` capturado se traduce a
 * `{ error: { code, message } }` con el status HTTP de `statusForErrorCode`;
 * cualquier error NO reconocido (un bug real, no una condición de dominio)
 * se traduce a un 500 genérico — nunca se filtra el mensaje/stack interno al
 * cliente — pero SÍ se loguea completo vía `logger.error` en ambos casos.
 *
 * Firma de 4 parámetros deliberada: es la única forma en que Express
 * reconoce una función como "error-handling middleware" (por aridad, no por
 * tipo) — `_req`/`_next` no se usan en el cuerpo pero deben seguir
 * declarados (ver `eslint.config.js`, `argsIgnorePattern` agregado en esta
 * misma fase para permitir el prefijo `_` en parámetros no usados).
 */
export function createErrorHandler(
  logger: Logger,
): (error: unknown, _req: Request, res: Response, _next: NextFunction) => void {
  return (error, _req, res, _next) => {
    if (error instanceof QaError) {
      logger.error(error.message, { code: error.code });
      res.status(statusForErrorCode(error.code)).json({
        error: { code: error.code, message: error.message },
      });
      return;
    }

    logger.error('Error no controlado en el server', {
      error: error instanceof Error ? (error.stack ?? error.message) : String(error),
    });
    res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Ocurrió un error interno inesperado.',
      },
    });
  };
}

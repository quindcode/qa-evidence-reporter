import pino from 'pino';

import type { LogLevel } from '../types/config.js';
import type { Logger } from '../types/logger.js';

/**
 * Punto de extensión mínimo para inyectar dependencias en `createLogger`,
 * mismo patrón que el resto de factories de `core/**` (`SessionEngineDeps.clock`,
 * `EvidenceStoreDeps.imageProcessor`, ...).
 */
export interface CreateLoggerDeps {
  /**
   * Stream inyectable como destino de los logs. Si se provee, `createLogger`
   * NO usa el transport `pino-pretty` (ver nota de diseño abajo) — escribe
   * líneas JSON crudas de `pino` directamente a este stream, que es
   * exactamente lo que necesitan los tests: un `Writable` en memoria cuyas
   * líneas se puedan parsear con `JSON.parse` para verificar qué se logueó
   * y a qué nivel, sin arrancar el worker thread real de `pino-pretty` ni
   * tocar `process.stdout`.
   */
  destination?: NodeJS.WritableStream;
}

/**
 * Factory del `Logger` de referencia, basado en `pino` (ver ARCHITECTURE.md,
 * tabla de stack tecnológico: "Logging").
 *
 * Decisión de diseño (`pino-pretty` como transport, no el JSON crudo de pino
 * por defecto): `qa-evidence-reporter` es una CLI interactiva que un QA lee
 * directamente en su terminal mientras ejecuta una sesión — líneas JSON sin
 * formatear (`{"level":30,"time":...,"msg":"..."}`) son ilegibles para ese
 * uso. `pino-pretty` solo se activa cuando NO se inyecta `deps.destination`
 * (el caso de producción real, escribiendo a `process.stdout`); los tests
 * que inyectan un `destination` propio reciben el JSON crudo de `pino`
 * (más fácil de parsear en un `expect`) — ver JSDoc de `CreateLoggerDeps.destination`.
 *
 * Decisión de diseño (`Logger` propio, nunca `pino` expuesto): el resto de
 * `core/**` importa únicamente `Logger` (`core/types/logger.ts`), nunca
 * `pino` — este archivo es el ÚNICO punto de todo `core/**` que importa el
 * paquete `pino`. Esto es lo que permite, por ejemplo, que
 * `GherkinParserDeps.logger` (`core/parser/gherkinParser.ts`) declarado
 * antes de que este módulo existiera, siga aceptando cualquier objeto que
 * cumpla la forma mínima de `Logger` sin que `core/parser` necesite conocer
 * `pino` en absoluto.
 */
export function createLogger(level: LogLevel, deps: CreateLoggerDeps = {}): Logger {
  const pinoLogger = deps.destination
    ? pino({ level }, deps.destination)
    : pino({
        level,
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
          },
        },
      });

  return {
    debug: (message, meta) => pinoLogger.debug(meta ?? {}, message),
    info: (message, meta) => pinoLogger.info(meta ?? {}, message),
    warn: (message, meta) => pinoLogger.warn(meta ?? {}, message),
    error: (message, meta) => pinoLogger.error(meta ?? {}, message),
  };
}

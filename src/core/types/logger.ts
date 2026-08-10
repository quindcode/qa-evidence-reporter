/**
 * Puerto (interfaz) de logging propio de `qa-evidence-reporter`. Vive en
 * `core/types/` (junto al resto de contratos de `core/**`, ver
 * ARCHITECTURE.md) en vez de inline dentro de `core/logger/`, por el mismo
 * motivo que el resto de interfaces de este directorio: cualquier módulo de
 * `core/**` que quiera aceptar un logger inyectado (ver `GherkinParserDeps`
 * en `core/parser/gherkinParser.ts`, que ya lo hacía con una forma ad-hoc
 * antes de que este archivo existiera) debe poder importar el TIPO sin
 * arrastrar la implementación concreta (`core/logger`, que sí importa
 * `pino`) ni crear un ciclo de dependencias entre módulos hermanos de
 * `core/**`.
 *
 * Decisión de diseño (4 métodos, sin `trace`/`fatal` de `pino`): se modelan
 * únicamente los niveles que `qa-config.json` → `logging.level` puede
 * seleccionar (ver `LOG_LEVELS` en `core/types/config.ts`). `pino` soporta
 * más niveles, pero el resto de `core/**` nunca debe depender de la
 * superficie completa de `pino` — solo de esta interfaz mínima.
 */
export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

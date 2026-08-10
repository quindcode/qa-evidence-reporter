import { Writable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { createLogger } from './logger.js';

/**
 * Colector en memoria de todo lo escrito al `destination` inyectado. Se usa
 * en vez de `process.stdout` real (que solo se ejercita en la
 * implementación de referencia sin `destination`, ver JSDoc de
 * `CreateLoggerDeps.destination` en `logger.ts`) para poder inspeccionar
 * exactamente qué se logueó, sin arrancar el worker thread de `pino-pretty`
 * (que complicaría el teardown de estos tests: `pino` con `transport`
 * mantiene un worker vivo que no se cierra desde este lado de la interfaz
 * `Logger`, ya que esta no expone ningún método de `close`/`flush`).
 */
function createCollector(): { stream: Writable; lines: () => Record<string, unknown>[] } {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(chunk.toString('utf-8'));
      callback();
    },
  });
  const lines = (): Record<string, unknown>[] =>
    chunks
      .join('')
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  return { stream, lines };
}

describe('createLogger', () => {
  it('no lanza al crearse ni al loguear en ninguno de los 4 niveles soportados', () => {
    for (const level of ['debug', 'info', 'warn', 'error'] as const) {
      const { stream } = createCollector();
      const logger = createLogger(level, { destination: stream });
      expect(() => {
        logger.debug('mensaje de debug');
        logger.info('mensaje de info');
        logger.warn('mensaje de warn');
        logger.error('mensaje de error');
      }).not.toThrow();
    }
  });

  it('con level "warn", descarta debug/info y emite warn/error', () => {
    const { stream, lines } = createCollector();
    const logger = createLogger('warn', { destination: stream });

    logger.debug('no debería aparecer');
    logger.info('no debería aparecer');
    logger.warn('sí debería aparecer');
    logger.error('sí debería aparecer también');

    const emitted = lines();
    expect(emitted).toHaveLength(2);
    expect(emitted.map((line) => line.msg)).toEqual([
      'sí debería aparecer',
      'sí debería aparecer también',
    ]);
  });

  it('con level "debug", emite los 4 niveles', () => {
    const { stream, lines } = createCollector();
    const logger = createLogger('debug', { destination: stream });

    logger.debug('a');
    logger.info('b');
    logger.warn('c');
    logger.error('d');

    expect(lines()).toHaveLength(4);
  });

  it('incluye el objeto "meta" en la línea de log emitida', () => {
    const { stream, lines } = createCollector();
    const logger = createLogger('info', { destination: stream });

    logger.info('con metadata', { stepId: 'f0_s0_st0' });

    const [line] = lines();
    expect(line.msg).toBe('con metadata');
    expect(line.stepId).toBe('f0_s0_st0');
  });
});

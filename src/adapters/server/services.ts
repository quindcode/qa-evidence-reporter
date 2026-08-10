import type { EvidenceStore } from '../../core/types/evidence.js';
import type { GherkinParser } from '../../core/types/parser.js';
import type { SessionEngine } from '../../core/types/session.js';

/**
 * Instancias de `core/**` que `createApp` construye UNA vez (no por
 * request) a partir de `ServerContext` y comparte entre todas las rutas —
 * ver `app.ts`. `SessionEngine` en particular NECESITA ser una única
 * instancia compartida: guarda su estado en una closure interna (ver
 * `core/session/sessionEngine.ts`), así que una instancia nueva por request
 * "olvidaría" cualquier sesión cargada/creada por un request anterior en
 * este mismo proceso.
 */
export interface CoreServices {
  gherkinParser: GherkinParser;
  sessionEngine: SessionEngine;
  evidenceStore: EvidenceStore;
}

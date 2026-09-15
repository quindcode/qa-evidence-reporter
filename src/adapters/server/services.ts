import type { FeatureWriter } from '../../core/parser/index.js';
import type { EvidenceStore } from '../../core/types/evidence.js';
import type { GherkinParser } from '../../core/types/parser.js';
import type { SessionEngine } from '../../core/types/session.js';
import type { SettingsService } from './settingsService.js';

/**
 * Instancias de `core/**` (+ `SettingsService`, ver su JSDoc) que
 * `createApp` construye UNA vez (no por request) a partir de
 * `ServerContext` y comparte entre todas las rutas — ver `app.ts`.
 * `SessionEngine`/`SettingsService` en particular NECESITAN ser una única
 * instancia compartida: ambos guardan estado mutable en una closure interna
 * (ver `core/session/sessionEngine.ts` y `settingsService.ts`), así que una
 * instancia nueva por request "olvidaría" cualquier cambio de un request
 * anterior en este mismo proceso.
 *
 * `JiraClient`/`AzureDevOpsClient` YA NO viven acá (a diferencia de antes
 * de la integración de "settings desde el UI"): son objetos sin estado
 * propio, construidos a partir de credenciales que ahora pueden cambiar en
 * caliente (`SettingsService.setJiraToken`/`setAzureToken`, o
 * `updateSettings`) — guardar una instancia ya armada en `CoreServices`
 * "congelaría" las credenciales del momento del boot, exactamente lo que
 * esta feature necesita dejar de hacer. Las rutas que los necesitan los
 * construyen al vuelo con `createJiraClient(services.settingsService.getJiraCredentials())`
 * (ver `routes/report.ts`) — construirlos es barato (ningún I/O propio).
 */
export interface CoreServices {
  gherkinParser: GherkinParser;
  sessionEngine: SessionEngine;
  evidenceStore: EvidenceStore;
  settingsService: SettingsService;
  /**
   * Reescribe el `.feature` de origen al editar un caso de prueba pendiente
   * desde la UI (`PATCH /api/session/scenario/:scenarioId`, ver
   * `routes/session.ts`). Sin estado propio (a diferencia de `sessionEngine`)
   * — se podría construir al vuelo en la ruta, pero se instancia acá una sola
   * vez por consistencia con el resto de `CoreServices`.
   */
  featureWriter: FeatureWriter;
}

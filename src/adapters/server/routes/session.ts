import { extname } from 'node:path';

import { Router } from 'express';
import multer from 'multer';

import {
  EvidenceFileTooLargeError,
  QaError,
  SessionNotFoundError,
  UnsupportedEvidenceFormatError,
} from '../../../core/types/errors.js';
import type { ParsedFeature } from '../../../core/types/parser.js';
import type { SessionState, StepResult } from '../../../core/types/session.js';
import type { ServerContext } from '../context.js';
import {
  FEATURE_NOT_FOUND,
  INVALID_REQUEST_BODY,
  SESSION_ALREADY_IN_PROGRESS,
  asyncHandler,
  requireStringParam,
} from '../errors.js';
import { buildFeatureRefId, findStepContext, loadCurrentSessionOrNull } from '../sessionQueries.js';
import type { CoreServices } from '../services.js';

/**
 * Mismos 4 valores que `StepResult` (`core/types/session.ts`). Se duplica
 * como array runtime (el type original es solo un tipo, no existe como
 * valor) únicamente para poder validar el body de
 * `POST /api/session/step/:stepId/result` ANTES de llamar a
 * `SessionEngine.setStepResult` — que sí valida `defectDescription`
 * obligatorio en `'fail'`, pero no valida que `result` sea uno de estos 4
 * valores (aceptaría cualquier string y lo guardaría tal cual).
 */
const STEP_RESULTS: readonly StepResult[] = ['pass', 'fail', 'skip', 'pending'];

function isStepResult(value: unknown): value is StepResult {
  return typeof value === 'string' && (STEP_RESULTS as readonly string[]).includes(value);
}

/**
 * Multer en memoria (`memoryStorage`), no en disco temporal.
 *
 * Decisión de diseño: los archivos de evidencia (screenshots, videos cortos,
 * PDFs) de una sesión de QA manual son, en la práctica, pequeños a
 * medianos (el propio default de `evidence.maxFileSizeMB` es 50MB) y este es
 * un server local de un solo usuario (ARCHITECTURE.md, "Comunicación
 * UI↔server") — no un servicio expuesto a internet con adversarios subiendo
 * archivos gigantes a propósito. Guardar en memoria evita: (1) tener que
 * limpiar archivos temporales huérfanos si la validación de tamaño/formato
 * rechaza el archivo (con `diskStorage`, multer ya lo escribió a disco ANTES
 * de que la ruta pueda validarlo), y (2) una segunda copia de I/O (temp →
 * destino final) que `diskStorage` requeriría. Deliberadamente NO se fija
 * `limits.fileSize` en la config de multer: se prefiere dejar que el buffer
 * completo llegue y comparar su tamaño REAL contra
 * `config.evidence.maxFileSizeMB` a mano (ver más abajo), para poder lanzar
 * `EvidenceFileTooLargeError` con el tamaño exacto del archivo rechazado en
 * vez de que multer aborte la conexión con su propio error genérico sin ese
 * detalle.
 */
const upload = multer({ storage: multer.memoryStorage() });

function extractFeatureIds(body: unknown): string[] {
  if (!body || typeof body !== 'object' || !('featureIds' in body)) {
    throw new QaError(
      'El body debe incluir "featureIds": string[] (ids de features a correr, ver GET /api/features).',
      INVALID_REQUEST_BODY,
    );
  }

  const { featureIds } = body as { featureIds: unknown };
  if (
    !Array.isArray(featureIds) ||
    featureIds.length === 0 ||
    !featureIds.every((id) => typeof id === 'string')
  ) {
    throw new QaError('"featureIds" debe ser un array no vacío de strings.', INVALID_REQUEST_BODY);
  }

  return featureIds;
}

/**
 * Rutas de sesión: seleccionar features, consultar/navegar el estado,
 * subir/quitar evidencia y marcar resultados.
 *
 * Decisión de diseño (`POST /api/session/select` sobre una sesión en
 * curso): si ya existe una sesión con `status !== 'completed'`, se rechaza
 * con `409` (`SESSION_ALREADY_IN_PROGRESS`) a menos que el caller pase
 * `?force=true` — para no pisar accidentalmente progreso no completado
 * (evidencia/resultados ya registrados) solo porque la UI reenvió la
 * pantalla de selección. `force=true` es una confirmación explícita del QA
 * ("sí, quiero descartar la sesión anterior y empezar de nuevo"). Si la
 * sesión anterior YA está `'completed'`, se permite seleccionar de nuevo sin
 * pedir confirmación (empezar una sesión nueva sobre trabajo ya terminado no
 * arriesga perder nada).
 */
export function createSessionRouter(context: ServerContext, services: CoreServices): Router {
  const router = Router();

  router.post(
    '/session/select',
    asyncHandler(async (req, res) => {
      const featureIds = extractFeatureIds(req.body);
      const force = req.query.force === 'true';

      const existing = await loadCurrentSessionOrNull(services.sessionEngine);
      if (existing && existing.status !== 'completed' && !force) {
        throw new QaError(
          'Ya hay una sesión en curso sin completar. Repetí la solicitud con "?force=true" si ' +
            'querés descartarla y empezar una nueva (se perderá el progreso no exportado a un reporte).',
          SESSION_ALREADY_IN_PROGRESS,
        );
      }

      const allFeatures = await services.gherkinParser.parseDirectory(context.featuresDir);
      const featuresById = new Map<string, ParsedFeature>(
        allFeatures.map((feature) => [buildFeatureRefId(context.featuresDir, feature), feature]),
      );

      const selected: ParsedFeature[] = featureIds.map((id) => {
        const feature = featuresById.get(id);
        if (!feature) {
          throw new QaError(`No se encontró ninguna feature con id "${id}".`, FEATURE_NOT_FOUND);
        }
        return feature;
      });

      const session = await services.sessionEngine.createSession(
        selected,
        context.config.projectName,
      );
      res.status(201).json({ session, currentStep: services.sessionEngine.getCurrentStep() });
    }),
  );

  router.get(
    '/session',
    asyncHandler(async (_req, res) => {
      const session = await requireSession(context, services);
      res.json({ session, currentStep: services.sessionEngine.getCurrentStep() });
    }),
  );

  /**
   * `GET /api/session/step/:stepId/evidence` — metadata completa
   * (`EvidenceFile[]`, incluyendo `kind`/`thumbnailPath`/`sizeBytes`) de la
   * evidencia ya adjuntada a un step.
   *
   * Agregado en fase 5b (`ui/`), fuera de la lista original de endpoints de
   * ARCHITECTURE.md ("Fase 5a"/"API REST del server"): es un bugfix mínimo
   * al contrato de API, no una ruta nueva de negocio. `StepExecution` (ver
   * `core/types/session.ts`) solo guarda `evidenceFileIds: string[]` —
   * `SessionState` (lo único que la UI podía leer hasta ahora vía
   * `GET /api/session`/`POST .../result`/`POST .../navigate`) nunca expone
   * `kind`/`thumbnailPath`/`sizeBytes`/`originalFilename` para evidencia
   * subida en una request anterior. Eso bloqueaba por completo el requisito
   * de UX "preview de evidencias ya adjuntadas" en cualquier momento que no
   * sea inmediatamente después de un `POST .../evidence` (p. ej. tras
   * recargar la página, o al "continuar una sesión existente" — ambos casos
   * pedidos explícitamente en la consigna de esta fase). La única pieza de
   * `core/**` que hacía falta (`EvidenceStore.list(stepId)`) ya existía
   * completa desde fase 2 (reconstruye la metadata escaneando el filesystem,
   * ver su JSDoc en `core/types/evidence.ts`) — no requirió ningún cambio en
   * `core/**`, solo exponerla vía HTTP con el mismo patrón que el resto de
   * esta ruta (`findStepContext` para validar que el step exista).
   */
  router.get(
    '/session/step/:stepId/evidence',
    asyncHandler(async (req, res) => {
      const session = await requireSession(context, services);
      const stepId = requireStringParam(req.params.stepId, 'stepId');
      findStepContext(session, stepId); // lanza InvalidStepTransitionError si el step no existe.

      const evidenceFiles = await services.evidenceStore.list(stepId);
      res.json({ evidenceFiles });
    }),
  );

  router.post(
    '/session/step/:stepId/evidence',
    upload.array('files', 10),
    asyncHandler(async (req, res) => {
      const session = await requireSession(context, services);
      const stepId = requireStringParam(req.params.stepId, 'stepId');
      const { featureId, scenarioId } = findStepContext(session, stepId);

      const files = req.files as Express.Multer.File[] | undefined;
      if (!files || files.length === 0) {
        throw new QaError(
          'No se recibió ningún archivo (campo multipart esperado: "files").',
          INVALID_REQUEST_BODY,
        );
      }

      const maxSizeBytes = context.config.evidence.maxFileSizeMB * 1024 * 1024;
      const allowedFormats = context.config.evidence.allowedFormats.map((format) =>
        format.toLowerCase(),
      );

      // Se valida TODO el lote antes de guardar nada: si un archivo del
      // lote es inválido, se rechaza la solicitud completa en vez de
      // guardar parcialmente algunos archivos y fallar a mitad de camino.
      for (const file of files) {
        const extension = extname(file.originalname).replace(/^\./, '').toLowerCase();
        if (!allowedFormats.includes(extension)) {
          throw new UnsupportedEvidenceFormatError(file.originalname, extension, allowedFormats);
        }
        if (file.size > maxSizeBytes) {
          throw new EvidenceFileTooLargeError(file.originalname, file.size, maxSizeBytes);
        }
      }

      const evidenceFiles = [];
      for (const file of files) {
        const evidenceFile = await services.evidenceStore.save({
          featureId,
          scenarioId,
          stepId,
          originalFilename: file.originalname,
          buffer: file.buffer,
        });
        await services.sessionEngine.addEvidence(stepId, evidenceFile.id);
        evidenceFiles.push(evidenceFile);
      }

      res.status(201).json({ evidenceFiles, session: services.sessionEngine.getState() });
    }),
  );

  router.delete(
    '/session/step/:stepId/evidence/:evidenceId',
    asyncHandler(async (req, res) => {
      const session = await requireSession(context, services);
      const stepId = requireStringParam(req.params.stepId, 'stepId');
      const evidenceId = requireStringParam(req.params.evidenceId, 'evidenceId');
      findStepContext(session, stepId); // lanza InvalidStepTransitionError si el step no existe.

      // Se borra primero el archivo físico y DESPUÉS la referencia en la
      // sesión (y no al revés): si el borrado físico fallara, preferimos
      // dejar una referencia "huérfana" pero recuperable en session.json
      // antes que una sesión que ya no la referencia pero cuyo archivo
      // sigue ocupando disco. `EvidenceStore.remove` es no-op si el archivo
      // ya no existe (ver su JSDoc), así que reintentar este DELETE nunca
      // falla por "ya borrado".
      await services.evidenceStore.remove(stepId, evidenceId);
      const updated = await services.sessionEngine.removeEvidence(stepId, evidenceId);
      res.json({ session: updated });
    }),
  );

  router.post(
    '/session/step/:stepId/result',
    asyncHandler(async (req, res) => {
      await requireSession(context, services);

      const body = (req.body ?? {}) as {
        result?: unknown;
        defectDescription?: unknown;
        notes?: unknown;
      };
      if (!isStepResult(body.result)) {
        throw new QaError(
          `"result" debe ser uno de: ${STEP_RESULTS.join(', ')}.`,
          INVALID_REQUEST_BODY,
        );
      }
      if (body.defectDescription !== undefined && typeof body.defectDescription !== 'string') {
        throw new QaError('"defectDescription" debe ser un string.', INVALID_REQUEST_BODY);
      }
      if (body.notes !== undefined && typeof body.notes !== 'string') {
        throw new QaError('"notes" debe ser un string.', INVALID_REQUEST_BODY);
      }

      const stepId = requireStringParam(req.params.stepId, 'stepId');
      const updated = await services.sessionEngine.setStepResult(stepId, body.result, {
        defectDescription: body.defectDescription,
        notes: body.notes,
      });
      res.json({ session: updated, currentStep: services.sessionEngine.getCurrentStep() });
    }),
  );

  router.post(
    '/session/navigate',
    asyncHandler(async (req, res) => {
      await requireSession(context, services);

      const body = (req.body ?? {}) as Record<string, unknown>;
      let updated: SessionState;

      if (body.direction === 'next') {
        updated = await services.sessionEngine.next();
      } else if (body.direction === 'previous') {
        updated = await services.sessionEngine.previous();
      } else if (
        typeof body.featureIndex === 'number' &&
        typeof body.scenarioIndex === 'number' &&
        typeof body.stepIndex === 'number'
      ) {
        updated = await services.sessionEngine.goTo({
          featureIndex: body.featureIndex,
          scenarioIndex: body.scenarioIndex,
          stepIndex: body.stepIndex,
        });
      } else {
        throw new QaError(
          'El body debe ser { "direction": "next" | "previous" } o ' +
            '{ "featureIndex", "scenarioIndex", "stepIndex" } (números).',
          INVALID_REQUEST_BODY,
        );
      }

      res.json({ session: updated, currentStep: services.sessionEngine.getCurrentStep() });
    }),
  );

  return router;
}

async function requireSession(
  context: ServerContext,
  services: CoreServices,
): Promise<SessionState> {
  const session = await loadCurrentSessionOrNull(services.sessionEngine);
  if (!session) throw new SessionNotFoundError(context.sessionFilePath);
  return session;
}

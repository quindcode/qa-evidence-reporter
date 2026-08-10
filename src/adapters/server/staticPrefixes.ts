/**
 * Prefijos bajo los que `createApp` sirve contenido estático (ver `app.ts`).
 * Viven en su propio módulo (en vez de repetir el literal en `app.ts` y en
 * `routes/report.ts`, que necesita construir `reportUrl` con el mismo
 * prefijo que usa el mount de `express.static`) para que ambos no puedan
 * divergir silenciosamente.
 */

/** `express.static(context.evidenceBaseDir)`, para previews de evidencia ya adjuntada sin necesitar base64. */
export const EVIDENCE_STATIC_PREFIX = '/evidence-files';

/** `express.static(context.reportsDir)`, para previsualizar el último reporte generado sin descargar el ZIP. */
export const REPORTS_STATIC_PREFIX = '/reports-static';

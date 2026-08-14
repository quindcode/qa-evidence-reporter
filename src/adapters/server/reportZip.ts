import { PassThrough } from 'node:stream';

import { ZipArchive, type ArchiverError } from 'archiver';

/**
 * Empaqueta `reportsDir` como `.zip` en memoria — mismo contenido que
 * `GET /report/export-zip` (`routes/report.ts`), pero como `Buffer` en vez
 * de streamear a una response HTTP. Necesario para adjuntar el reporte a
 * Jira/Azure DevOps: esas APIs necesitan los bytes completos para armar un
 * `FormData`, no un stream a un socket de cliente — por eso vive en un
 * archivo propio en vez de modificar la ruta de export existente (que sigue
 * streameando directo a `res`, la forma más eficiente para una descarga
 * real).
 */
export async function buildReportZipBuffer(reportsDir: string): Promise<Buffer> {
  return new Promise((resolvePromise, rejectPromise) => {
    const chunks: Buffer[] = [];
    const passthrough = new PassThrough();
    passthrough.on('data', (chunk: Buffer) => chunks.push(chunk));
    passthrough.on('end', () => resolvePromise(Buffer.concat(chunks)));
    passthrough.on('error', rejectPromise);

    const archive = new ZipArchive();
    archive.on('error', (error: ArchiverError) => rejectPromise(error));
    archive.pipe(passthrough);
    archive.directory(reportsDir, false);
    void archive.finalize();
  });
}

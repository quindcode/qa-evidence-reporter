import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Jimp } from 'jimp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resolveEvidenceKind } from '../types/evidence.js';
import { slugify } from '../shared/slugify.js';
import { createEvidenceStore } from './evidenceStore.js';

/** PNG sintético de 10x10 rojo, generado con `jimp` (mismo approach sugerido en la consigna de la fase). */
async function makePngBuffer(): Promise<Buffer> {
  const image = new Jimp({ width: 10, height: 10, color: 0xff0000ff });
  return image.getBuffer('image/png');
}

describe('createEvidenceStore', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'qa-evidence-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  describe('save — imágenes', () => {
    it('guarda el buffer en la ruta esperada y genera un thumbnail junto al original', async () => {
      const store = createEvidenceStore(dir);
      const buffer = await makePngBuffer();

      const evidence = await store.save({
        featureId: 'f0-login',
        scenarioId: 'f0-login_s0-successful-login',
        stepId: 'f0-login_s0-successful-login_st0',
        originalFilename: 'screenshot.png',
        buffer,
      });

      expect(evidence.kind).toBe('image');
      expect(evidence.originalFilename).toBe('screenshot.png');
      expect(evidence.sizeBytes).toBe(buffer.length);
      expect(evidence.path).toBe(
        'f0-login/f0-login_s0-successful-login/f0-login_s0-successful-login_st0/screenshot.png',
      );
      expect(evidence.thumbnailPath).toBe(`${evidence.path}.thumb.png`);

      // El archivo original y el thumbnail existen de verdad en disco.
      await expect(stat(join(dir, evidence.path))).resolves.toBeDefined();
      await expect(stat(join(dir, evidence.thumbnailPath!))).resolves.toBeDefined();

      // El thumbnail es una imagen válida, redimensionada a 320px de ancho.
      const thumbBuffer = await readFile(join(dir, evidence.thumbnailPath!));
      const thumbImage = await Jimp.read(thumbBuffer);
      expect(thumbImage.width).toBe(320);
    });

    it('ids determinísticos: guardar el mismo input dos veces produce el mismo id', async () => {
      const store = createEvidenceStore(dir);
      const buffer = await makePngBuffer();
      const input = {
        featureId: 'f0-login',
        scenarioId: 'f0-login_s0-successful-login',
        stepId: 'f0-login_s0-successful-login_st0',
        originalFilename: 'screenshot.png',
        buffer,
      };

      const first = await store.save(input);
      const second = await store.save(input);
      expect(first.id).toBe(second.id);
    });
  });

  describe('save — video', () => {
    it('NO genera thumbnail para un archivo de video', async () => {
      const store = createEvidenceStore(dir);
      const buffer = Buffer.from('contenido-de-video-cualquiera');

      const evidence = await store.save({
        featureId: 'f0-login',
        scenarioId: 'f0-login_s0-successful-login',
        stepId: 'f0-login_s0-successful-login_st0',
        originalFilename: 'recording.mp4',
        buffer,
      });

      expect(evidence.kind).toBe('video');
      expect(evidence.thumbnailPath).toBeUndefined();
      await expect(stat(join(dir, evidence.path))).resolves.toBeDefined();
    });
  });

  describe('save — pdf / other', () => {
    it('clasifica pdf como kind "pdf" sin thumbnail', async () => {
      const store = createEvidenceStore(dir);
      const evidence = await store.save({
        featureId: 'f0-login',
        scenarioId: 'f0-login_s0-successful-login',
        stepId: 'f0-login_s0-successful-login_st0',
        originalFilename: 'reporte.pdf',
        buffer: Buffer.from('%PDF-1.4'),
      });

      expect(evidence.kind).toBe('pdf');
      expect(evidence.thumbnailPath).toBeUndefined();
    });

    it('nunca rechaza un formato desconocido: cae en kind "other"', async () => {
      const store = createEvidenceStore(dir);
      const evidence = await store.save({
        featureId: 'f0-login',
        scenarioId: 'f0-login_s0-successful-login',
        stepId: 'f0-login_s0-successful-login_st0',
        originalFilename: 'datos.xyz',
        buffer: Buffer.from('lo-que-sea'),
      });

      expect(evidence.kind).toBe('other');
      expect(evidence.thumbnailPath).toBeUndefined();
    });
  });

  describe('list', () => {
    it('reconstruye desde el filesystem las evidencias guardadas para un step, ignorando otros steps', async () => {
      const store = createEvidenceStore(dir);
      await store.save({
        featureId: 'f0-login',
        scenarioId: 'f0-login_s0-successful-login',
        stepId: 'f0-login_s0-successful-login_st0',
        originalFilename: 'a.png',
        buffer: await makePngBuffer(),
      });
      await store.save({
        featureId: 'f0-login',
        scenarioId: 'f0-login_s0-successful-login',
        stepId: 'f0-login_s0-successful-login_st0',
        originalFilename: 'b.mp4',
        buffer: Buffer.from('video'),
      });
      // Evidencia de OTRO step: no debe aparecer en el list() del primero.
      await store.save({
        featureId: 'f0-login',
        scenarioId: 'f0-login_s0-successful-login',
        stepId: 'f0-login_s0-successful-login_st1',
        originalFilename: 'c.pdf',
        buffer: Buffer.from('%PDF'),
      });

      const files = await store.list('f0-login_s0-successful-login_st0');
      expect(files).toHaveLength(2);
      expect(files.map((f) => f.originalFilename).sort()).toEqual(['a.png', 'b.mp4']);
    });

    it('devuelve un array vacío si el step no tiene evidencia (o no existe todavía en disco)', async () => {
      const store = createEvidenceStore(dir);
      const files = await store.list('no-existe');
      expect(files).toEqual([]);
    });
  });

  describe('getThumbnail', () => {
    it('devuelve la ruta del thumbnail dado el id de la evidencia', async () => {
      const store = createEvidenceStore(dir);
      const evidence = await store.save({
        featureId: 'f0-login',
        scenarioId: 'f0-login_s0-successful-login',
        stepId: 'f0-login_s0-successful-login_st0',
        originalFilename: 'a.png',
        buffer: await makePngBuffer(),
      });

      const thumbnail = await store.getThumbnail(evidence.id);
      expect(thumbnail).toBe(evidence.thumbnailPath);
    });

    it('devuelve null si el id no existe o el archivo no tiene thumbnail', async () => {
      const store = createEvidenceStore(dir);
      const video = await store.save({
        featureId: 'f0-login',
        scenarioId: 'f0-login_s0-successful-login',
        stepId: 'f0-login_s0-successful-login_st0',
        originalFilename: 'v.mp4',
        buffer: Buffer.from('video'),
      });

      expect(await store.getThumbnail(video.id)).toBeNull();
      expect(await store.getThumbnail('id-inexistente')).toBeNull();
    });
  });
});

describe('resolveEvidenceKind', () => {
  it('clasifica extensiones conocidas (con o sin punto, case-insensitive)', () => {
    expect(resolveEvidenceKind('png')).toBe('image');
    expect(resolveEvidenceKind('.PNG')).toBe('image');
    expect(resolveEvidenceKind('JPG')).toBe('image');
    expect(resolveEvidenceKind('mp4')).toBe('video');
    expect(resolveEvidenceKind('webm')).toBe('video');
    expect(resolveEvidenceKind('pdf')).toBe('pdf');
  });

  it('cae en "other" para extensiones desconocidas', () => {
    expect(resolveEvidenceKind('xyz')).toBe('other');
    expect(resolveEvidenceKind('')).toBe('other');
  });
});

describe('slugify', () => {
  it('convierte a minúsculas y reemplaza espacios por guiones', () => {
    expect(slugify('Successful Login')).toBe('successful-login');
  });

  it('quita acentos/diacríticos', () => {
    expect(slugify('Iniciación de sesión')).toBe('iniciacion-de-sesion');
  });

  it('colapsa separadores repetidos y recorta guiones al inicio/final', () => {
    expect(slugify('  ¡Hola,   Mundo!!  ')).toBe('hola-mundo');
  });

  it('devuelve un fallback legible si el texto queda vacío tras limpiar', () => {
    expect(slugify('😀😀😀')).toBe('sin-titulo');
  });
});

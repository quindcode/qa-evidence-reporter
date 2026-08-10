// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EvidenceArea } from './EvidenceArea';
import type { EvidenceFile } from '../types';

// Ver `FeatureSelect.test.tsx` para por qué esto se registra a mano en cada archivo.
afterEach(cleanup);

const IMAGE_EVIDENCE: EvidenceFile = {
  id: 'ev1',
  originalFilename: 'captura.png',
  path: 'f0/s0/st0/captura.png',
  kind: 'image',
  sizeBytes: 2048,
  thumbnailPath: 'f0/s0/st0/captura.png.thumb.png',
  uploadedAt: new Date().toISOString(),
};

describe('EvidenceArea', () => {
  it('elegir un archivo por el input dispara onUpload con ese archivo', () => {
    const onUpload = vi.fn();
    render(
      <EvidenceArea evidenceFiles={[]} uploading={false} onUpload={onUpload} onDelete={vi.fn()} />,
    );

    const file = new File(['contenido'], 'captura.png', { type: 'image/png' });
    const input = screen.getByLabelText(/adjuntar evidencia/i) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    expect(onUpload).toHaveBeenCalledTimes(1);
    expect(onUpload.mock.calls[0][0]).toEqual([file]);
  });

  it('soltar archivos sobre la dropzone dispara onUpload', () => {
    const onUpload = vi.fn();
    const { container } = render(
      <EvidenceArea evidenceFiles={[]} uploading={false} onUpload={onUpload} onDelete={vi.fn()} />,
    );

    const dropzone = container.querySelector('.evidence-dropzone') as HTMLElement;
    const file = new File(['contenido'], 'video.mp4', { type: 'video/mp4' });
    fireEvent.drop(dropzone, { dataTransfer: { files: [file] } });

    expect(onUpload).toHaveBeenCalledTimes(1);
    expect(onUpload.mock.calls[0][0]).toEqual([file]);
  });

  it('pegar una imagen del portapapeles (fuera de un campo de texto) dispara onUpload', () => {
    const onUpload = vi.fn();
    render(
      <EvidenceArea evidenceFiles={[]} uploading={false} onUpload={onUpload} onDelete={vi.fn()} />,
    );

    const file = new File(['img'], 'pegada.png', { type: 'image/png' });
    const pasteEvent = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
    Object.defineProperty(pasteEvent, 'clipboardData', {
      value: { items: [{ kind: 'file', getAsFile: () => file }] },
    });
    document.body.dispatchEvent(pasteEvent);

    expect(onUpload).toHaveBeenCalledTimes(1);
    expect(onUpload.mock.calls[0][0]).toEqual([file]);
  });

  it('pegar mientras el foco está en un <textarea> NO dispara onUpload', () => {
    const onUpload = vi.fn();
    render(
      <EvidenceArea evidenceFiles={[]} uploading={false} onUpload={onUpload} onDelete={vi.fn()} />,
    );

    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);

    const file = new File(['img'], 'pegada.png', { type: 'image/png' });
    const pasteEvent = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
    Object.defineProperty(pasteEvent, 'clipboardData', {
      value: { items: [{ kind: 'file', getAsFile: () => file }] },
    });
    Object.defineProperty(pasteEvent, 'target', { value: textarea });
    document.dispatchEvent(pasteEvent);

    expect(onUpload).not.toHaveBeenCalled();
  });

  it('renderiza el thumbnail de una evidencia de imagen y permite quitarla', () => {
    const onDelete = vi.fn();
    render(
      <EvidenceArea
        evidenceFiles={[IMAGE_EVIDENCE]}
        uploading={false}
        onUpload={vi.fn()}
        onDelete={onDelete}
      />,
    );

    const thumb = screen.getByAltText('captura.png') as HTMLImageElement;
    expect(thumb.src).toContain('/evidence-files/f0/s0/st0/captura.png.thumb.png');

    fireEvent.click(screen.getByRole('button', { name: /quitar captura.png/i }));
    expect(onDelete).toHaveBeenCalledWith('ev1');
  });
});

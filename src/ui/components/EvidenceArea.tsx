import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';

import { EVIDENCE_STATIC_PREFIX } from '../api';
import type { EvidenceFile } from '../types';

export interface EvidenceAreaProps {
  evidenceFiles: EvidenceFile[];
  uploading: boolean;
  onUpload: (files: File[]) => void;
  onDelete: (evidenceId: string) => void;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
}

function evidenceUrl(relativePath: string): string {
  return `${EVIDENCE_STATIC_PREFIX}/${relativePath.split('/').map(encodeURIComponent).join('/')}`;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Área de evidencia del step actual: botón + file picker, drag & drop, paste
 * de portapapeles, y preview de lo ya adjuntado (ARCHITECTURE.md, "UX del
 * runner", y la consigna de esta fase).
 *
 * El listener de `paste` se agrega a nivel de `document` (no solo sobre el
 * `<div>` de esta área) para que pegar funcione sin tener que hacer click
 * primero en la zona — pero se ignora por completo si el foco está en un
 * campo de texto (notas/descripción de defecto), para no robarle una imagen
 * pegada por accidente a quien está escribiendo (aunque pegar una imagen
 * dentro de un `<textarea>` normal no hace nada de todas formas, es una
 * defensa explícita y barata).
 */
export function EvidenceArea({
  evidenceFiles,
  uploading,
  onUpload,
  onDelete,
}: EvidenceAreaProps): JSX.Element {
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onPaste(event: ClipboardEvent): void {
      if (isTypingTarget(event.target)) return;
      const items = event.clipboardData?.items;
      if (!items) return;

      const files: File[] = [];
      for (const item of items) {
        if (item.kind !== 'file') continue;
        const file = item.getAsFile();
        if (file) files.push(file);
      }
      if (files.length > 0) {
        event.preventDefault();
        onUpload(files);
      }
    }

    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [onUpload]);

  function handleDrop(event: JSX.TargetedDragEvent<HTMLDivElement>): void {
    event.preventDefault();
    setIsDraggingOver(false);
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (files.length > 0) onUpload(files);
  }

  function handleFileInputChange(event: JSX.TargetedEvent<HTMLInputElement>): void {
    const files = Array.from(event.currentTarget.files ?? []);
    if (files.length > 0) onUpload(files);
    event.currentTarget.value = '';
  }

  return (
    <div class="evidence-area">
      <div
        class={'evidence-dropzone' + (isDraggingOver ? ' evidence-dropzone--active' : '')}
        onDragOver={(event) => {
          event.preventDefault();
          setIsDraggingOver(true);
        }}
        onDragLeave={() => setIsDraggingOver(false)}
        onDrop={handleDrop}
      >
        <p>Arrastrá imágenes o videos acá, pegalos con Ctrl+V, o</p>
        <button
          type="button"
          class="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? 'Subiendo…' : 'Elegir archivos'}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*,video/*,.pdf"
          class="visually-hidden"
          onChange={handleFileInputChange}
          aria-label="Adjuntar evidencia"
        />
      </div>

      {evidenceFiles.length > 0 && (
        <ul class="evidence-list">
          {evidenceFiles.map((evidence) => (
            <li key={evidence.id} class="evidence-item">
              <EvidenceThumbnail evidence={evidence} />
              <div class="evidence-item__meta">
                <span class="evidence-item__name" title={evidence.originalFilename}>
                  {evidence.originalFilename}
                </span>
                <span class="evidence-item__size">{formatSize(evidence.sizeBytes)}</span>
              </div>
              <button
                type="button"
                class="evidence-item__remove"
                onClick={() => onDelete(evidence.id)}
                aria-label={`Quitar ${evidence.originalFilename}`}
                title="Quitar evidencia"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EvidenceThumbnail({ evidence }: { evidence: EvidenceFile }): JSX.Element {
  if (evidence.kind === 'image') {
    const src = evidence.thumbnailPath
      ? evidenceUrl(evidence.thumbnailPath)
      : evidenceUrl(evidence.path);
    return <img class="evidence-item__thumb" src={src} alt={evidence.originalFilename} />;
  }

  if (evidence.kind === 'video') {
    return (
      <video
        class="evidence-item__thumb"
        src={evidenceUrl(evidence.path)}
        controls
        preload="metadata"
      />
    );
  }

  const icon = evidence.kind === 'pdf' ? '📄' : '📎';
  return (
    <div class="evidence-item__thumb evidence-item__thumb--icon" aria-hidden="true">
      {icon}
    </div>
  );
}

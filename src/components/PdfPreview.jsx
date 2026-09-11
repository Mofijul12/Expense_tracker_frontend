import { useEffect, useRef, useState } from 'react';

/**
 * Shows a generated PDF before it is saved, so the export can be checked —
 * and abandoned — without a stray file landing in Downloads first.
 *
 * The blob is held by the caller; this component only owns the object URL,
 * which it revokes when the dialog closes so the blob can be collected.
 */
export default function PdfPreview({ open, title, subtitle, file, onClose }) {
  const [url, setUrl] = useState(null);
  const panelRef = useRef(null);

  useEffect(() => {
    if (!open || !file?.blob) return undefined;
    const next = URL.createObjectURL(file.blob);
    setUrl(next);
    return () => {
      URL.revokeObjectURL(next);
      setUrl(null);
    };
  }, [open, file]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    panelRef.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open || !file) return null;

  const kb = Math.max(1, Math.round(file.blob.size / 1024));

  const download = () => {
    const a = document.createElement('a');
    a.href = url;
    a.download = file.filename;
    a.click();
  };

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={`${title} — PDF preview`}
        tabIndex={-1}
        ref={panelRef}
        // The scrim closes on click; the panel must not pass its own clicks up.
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal-head">
          <div className="modal-heading">
            <div className="modal-title">{title}</div>
            <div className="modal-sub">
              {subtitle} · {kb} kB
            </div>
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close preview">
            <i className="ph ph-x" />
          </button>
        </header>

        {file.dropped && (
          <div className="banner error modal-note">
            <i className="ph ph-warning-circle" />
            Some characters aren&apos;t in the PDF font and were replaced with &ldquo;?&rdquo;. Latin
            text exports exactly.
          </div>
        )}

        <div className="modal-body">
          {/* Mobile browsers — iOS Safari especially — refuse to render a PDF
              in a frame and leave it blank, so the fallback link underneath is
              the way through on a phone rather than a nicety. */}
          <iframe className="pdf-frame" src={url} title={`${title} preview`} />
          <div className="pdf-fallback muted-sm">
            Preview not showing?{' '}
            <a href={url} target="_blank" rel="noreferrer">
              Open it in a new tab
            </a>
            .
          </div>
        </div>

        <footer className="modal-foot">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={download}>
            <i className="ph ph-download-simple" style={{ fontSize: 14 }} />
            Download PDF
          </button>
        </footer>
      </div>
    </div>
  );
}

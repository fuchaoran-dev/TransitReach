import { useEffect, useRef, useState } from 'react';
import { Check, Copy, QrCode, X } from 'lucide-react';
import QRCode from 'qrcode';
import { shareLinkFor } from '../roomLink';

/** The room code is what people read aloud; the full link is copied rather than shown truncated. */
export function ShareLink({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const [clipboardFailed, setClipboardFailed] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [qr, setQr] = useState<{ link: string; value: string } | null>(null);
  const [qrErrorLink, setQrErrorLink] = useState<string | null>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const link = shareLinkFor(code);

  useEffect(() => {
    if (!qrOpen || qr?.link === link) return;
    let cancelled = false;
    void QRCode.toDataURL(link, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 320,
      color: { dark: '#0f172a', light: '#ffffff' },
    }).then(value => {
      if (!cancelled) {
        setQr({ link, value });
        setQrErrorLink(null);
      }
    }).catch(() => {
      if (!cancelled) setQrErrorLink(link);
    });
    return () => { cancelled = true; };
  }, [link, qr, qrOpen]);

  useEffect(() => () => {
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
  }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setClipboardFailed(false);
      setCopied(true);
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => {
        setCopied(false);
        copiedTimer.current = null;
      }, 2000);
    } catch {
      // Clipboard access can be refused; show the link so it can be selected by hand.
      setClipboardFailed(true);
    }
  };

  return (
    <div className="rounded-xl border border-[#294456] bg-[#132433] p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Room code</p>
          <p className="font-mono text-xl font-bold tracking-[0.18em] text-white">{code}</p>
        </div>
        <div className="flex shrink-0 gap-1.5">
          <button type="button" className="btn-icon !h-9 !w-9" onClick={copy} aria-label={copied ? 'Invitation link copied' : 'Copy link'} title={copied ? 'Copied' : 'Copy invitation link'} aria-live="polite">
            {copied ? <Check size={17} aria-hidden="true" /> : <Copy size={17} aria-hidden="true" />}
          </button>
          <button type="button" className="btn-icon !h-9 !w-9" onClick={() => setQrOpen(value => !value)} aria-expanded={qrOpen} aria-label={qrOpen ? 'Hide room QR code' : 'Show room QR code'} title="Show QR code">
            {qrOpen ? <X size={17} aria-hidden="true" /> : <QrCode size={17} aria-hidden="true" />}
          </button>
        </div>
      </div>
      {qrOpen && <div className="mt-3 rounded-lg bg-white p-3 text-center">
        {qr?.link === link ? <img src={qr.value} alt={`QR code for room ${code}`} className="mx-auto h-40 w-40" />
          : qrErrorLink === link ? <p role="alert" className="text-xs text-rose-700">QR code unavailable. Copy the invite link instead.</p>
            : <p role="status" className="py-12 text-xs text-slate-600">Creating QR code…</p>}
        <p className="mt-2 font-mono text-sm font-bold tracking-[0.16em] text-slate-900">{code}</p>
      </div>}
      {clipboardFailed && <input readOnly aria-label="Room link" value={link} onFocus={event => event.currentTarget.select()} className="glass-input mt-2 w-full p-2 text-xs" />}
      <p className="mt-2 text-xs text-slate-400">Share only with your group.</p>
    </div>
  );
}

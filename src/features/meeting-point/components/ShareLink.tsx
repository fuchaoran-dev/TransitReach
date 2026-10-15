import { useState } from 'react';
import { Check, Link2 } from 'lucide-react';
import { shareLinkFor } from '../roomLink';

/** The room code is what people read aloud; the full link is copied rather than shown truncated. */
export function ShareLink({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const [clipboardFailed, setClipboardFailed] = useState(false);
  const link = shareLinkFor(code);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setClipboardFailed(false);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
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
        <button type="button" className="btn-secondary inline-flex shrink-0 items-center gap-1.5 text-sm" onClick={copy} aria-live="polite">
          {copied ? <Check size={16} aria-hidden="true" /> : <Link2 size={16} aria-hidden="true" />}
          {copied ? 'Copied' : 'Copy invite'}
        </button>
      </div>
      {clipboardFailed && <input readOnly aria-label="Room link" value={link} onFocus={event => event.currentTarget.select()} className="glass-input mt-2 w-full p-2 text-xs" />}
      <p className="mt-2 text-xs text-slate-400">Share only with your group.</p>
    </div>
  );
}

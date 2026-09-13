import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { shareLinkFor } from '../roomLink';

export function ShareLink({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const link = shareLinkFor(code);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be refused; the link stays selectable in the field beside the button.
    }
  };

  return (
    <div className="space-y-2">
      <div className="text-sm font-bold text-slate-900">
        Room <span className="font-mono tracking-wider">{code}</span>
      </div>
      <div className="flex gap-2">
        <input
          readOnly
          aria-label="Room link"
          value={link}
          onFocus={event => event.currentTarget.select()}
          className="glass-input flex-1 min-w-0 p-2 text-sm"
        />
        <button type="button" className="btn-secondary inline-flex items-center gap-1.5" onClick={copy}>
          {copied ? <Check size={16} /> : <Copy size={16} />}
          {copied ? 'Copied' : 'Copy link'}
        </button>
      </div>
      <p className="text-xs text-slate-500">
        Anyone with this link can join and see everyone's starting points. The room is deleted
        24 hours after it was created.
      </p>
    </div>
  );
}

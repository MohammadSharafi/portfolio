import { useEffect, useRef, useState } from 'react';
import { Check, Send, X } from 'lucide-react';
import { useEngine } from '../engine/store';
import { profile } from '@/data/profile';
import { buildMailtoUrl, validateContactForm, type ContactFormErrors } from '@/lib/contact';
import { cn } from '@/lib/utils';

/**
 * The page in the open notebook, as somewhere to actually write.
 *
 * A portfolio whose only contact route is an address to copy loses the people
 * who were interested for exactly as long as it takes to open a mail client
 * and retype it. This is the room's version of a contact form.
 *
 * It composes a `mailto:` rather than posting anywhere, and that is a decision
 * rather than a shortcut. A form that POSTs needs somewhere to POST to: a
 * backend to run, a third-party form service holding strangers' names and
 * messages, a spam problem, and a privacy story to write. A `mailto:` needs
 * none of it — the message goes from the visitor's own client to my inbox, I
 * never operate a database of people who wrote to me, and there is no endpoint
 * to leak. The trade is honest and worth naming in the UI, which is what the
 * line under the button does: the visitor should know their mail app is about
 * to open, and nothing should be secretly collected.
 *
 * The draft is kept in `sessionStorage` so that opening a mail client, coming
 * back and finding the note blank cannot happen.
 */

const DRAFT_KEY = 'room-note-draft';

interface Draft {
  name: string;
  email: string;
  message: string;
}

const EMPTY: Draft = { name: '', email: '', message: '' };

function readDraft(): Draft {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as Partial<Draft>;
    return {
      name: typeof parsed.name === 'string' ? parsed.name : '',
      email: typeof parsed.email === 'string' ? parsed.email : '',
      message: typeof parsed.message === 'string' ? parsed.message : '',
    };
  } catch {
    // A corrupt or unavailable store must not stop someone writing to me.
    return EMPTY;
  }
}

export function MessageNote() {
  const open = useEngine((state) => state.messageOpen);
  const setOpen = useEngine((state) => state.setMessageOpen);

  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [errors, setErrors] = useState<ContactFormErrors>({});
  const [sent, setSent] = useState(false);
  const firstField = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setDraft(readDraft());
      setSent(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    firstField.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    // Capture, so this closes the note before the room's own Escape handler
    // pulls the camera back out of the object as well — two things unwinding
    // from one keypress reads as the site losing its place.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, setOpen]);

  const update = (field: keyof Draft, value: string) => {
    const next = { ...draft, [field]: value };
    setDraft(next);
    try {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify(next));
    } catch {
      // Private mode, or a full quota. The note still works, it just will not
      // survive a reload — which is not worth failing the interaction over.
    }
    if (errors[field]) setErrors({ ...errors, [field]: undefined });
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const found = validateContactForm(draft);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    window.location.href = buildMailtoUrl(draft, profile.email);
    setSent(true);
  };

  if (!open) return null;

  return (
    /* A panel cannot be anchored to the top *and* the bottom.

       Both `bottom-6` and `sm:top-1/2` were set, so above the breakpoint the
       box had two vertical anchors. CSS resolves that by stretching it to span
       the gap — and the content is taller than the gap, so the submit button
       and the line under it rendered *outside* the card, over the room. Every
       field worked; it simply looked broken, which from the outside is the
       same thing.

       `sm:bottom-auto` releases the bottom anchor, so the height goes back to
       being the content's and `top-1/2` plus the translate centres it. */
    <div className="pointer-events-auto absolute inset-x-4 bottom-6 mx-auto max-w-sm rounded-2xl border border-white/10 bg-black/80 p-5 backdrop-blur-xl sm:inset-x-auto sm:bottom-auto sm:left-8 sm:top-1/2 sm:-translate-y-1/2">
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="absolute right-3 top-3 rounded-full p-1.5 text-white/50 transition-colors hover:bg-white/10 hover:text-white"
        aria-label="Close the note"
      >
        <X className="size-4" aria-hidden="true" />
      </button>

      <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-emerald-300">
        The notebook
      </p>
      <h2 className="mt-1.5 font-display text-lg font-semibold text-white">Leave a note</h2>

      {sent ? (
        <div className="mt-4">
          <p className="flex items-start gap-2 text-sm leading-relaxed text-white/70">
            <Check className="mt-0.5 size-4 shrink-0 text-emerald-400" aria-hidden="true" />
            Your mail client should be opening with the message ready. If nothing happened, write to{' '}
            <a
              href={`mailto:${profile.email}`}
              className="text-sky-300 underline underline-offset-4"
            >
              {profile.email}
            </a>
            .
          </p>
          <button
            type="button"
            onClick={() => setSent(false)}
            className="mt-4 text-xs text-white/40 transition-colors hover:text-white/70"
          >
            Write another
          </button>
        </div>
      ) : (
        <form onSubmit={submit} className="mt-4 space-y-3" noValidate>
          <Field
            id="note-name"
            label="Your name"
            error={errors.name}
            {...{ ref: firstField }}
            value={draft.name}
            onChange={(value) => update('name', value)}
          />
          <Field
            id="note-email"
            label="Email"
            type="email"
            error={errors.email}
            value={draft.email}
            onChange={(value) => update('email', value)}
          />

          <div>
            <label
              htmlFor="note-message"
              className="block text-[0.7rem] font-medium uppercase tracking-[0.14em] text-white/45"
            >
              Message
            </label>
            <textarea
              id="note-message"
              rows={4}
              value={draft.message}
              onChange={(event) => update('message', event.target.value)}
              aria-invalid={errors.message ? true : undefined}
              aria-describedby={errors.message ? 'note-message-error' : undefined}
              className={cn(
                'mt-1.5 w-full resize-none rounded-lg border bg-white/[0.04] px-3 py-2 text-sm text-white placeholder:text-white/25 focus:outline-none focus:ring-1',
                errors.message
                  ? 'border-red-400/50 focus:ring-red-400/50'
                  : 'border-white/10 focus:border-white/25 focus:ring-white/20'
              )}
              placeholder="What are you working on?"
            />
            {errors.message ? (
              <p id="note-message-error" className="mt-1 text-[0.7rem] text-red-300/90">
                {errors.message}
              </p>
            ) : null}
          </div>

          <button
            type="submit"
            className="flex w-full items-center justify-center gap-2 rounded-full bg-white px-4 py-2.5 text-sm font-medium text-black transition-opacity hover:opacity-90"
          >
            <Send className="size-3.5" aria-hidden="true" />
            Open in your mail app
          </button>
          <p className="text-[0.7rem] leading-relaxed text-white/35">
            This opens your own mail client with the note filled in. Nothing is posted to a server
            and nothing is stored — the draft stays in this tab only.
          </p>
        </form>
      )}
    </div>
  );
}

const Field = ({
  id,
  label,
  type = 'text',
  value,
  error,
  onChange,
  ref,
}: {
  id: string;
  label: string;
  type?: string;
  value: string;
  error?: string | undefined;
  onChange: (value: string) => void;
  ref?: React.Ref<HTMLInputElement>;
}) => (
  <div>
    <label
      htmlFor={id}
      className="block text-[0.7rem] font-medium uppercase tracking-[0.14em] text-white/45"
    >
      {label}
    </label>
    <input
      ref={ref}
      id={id}
      type={type}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      aria-invalid={error ? true : undefined}
      aria-describedby={error ? `${id}-error` : undefined}
      className={cn(
        'mt-1.5 w-full rounded-lg border bg-white/[0.04] px-3 py-2 text-sm text-white placeholder:text-white/25 focus:outline-none focus:ring-1',
        error
          ? 'border-red-400/50 focus:ring-red-400/50'
          : 'border-white/10 focus:border-white/25 focus:ring-white/20'
      )}
    />
    {error ? (
      <p id={`${id}-error`} className="mt-1 text-[0.7rem] text-red-300/90">
        {error}
      </p>
    ) : null}
  </div>
);

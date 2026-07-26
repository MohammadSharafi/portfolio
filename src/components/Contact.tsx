import { useId, useState } from 'react';
import { Check, Copy, Mail, Send } from 'lucide-react';
import { profile, socialLinks } from '@/data/profile';
import {
  buildMailtoUrl,
  validateContactForm,
  type ContactFormErrors,
  type ContactFormValues,
} from '@/lib/contact';
import { cn } from '@/lib/utils';
import { Section } from './ui/Section';
import { Reveal } from './ui/Reveal';

type FormState = ContactFormValues;

function CopyEmailButton({ email }: { email: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(email);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be denied; the address stays visible either way.
    }
  };

  return (
    <button
      type="button"
      onClick={copy}
      className="glass inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm transition-colors hover:bg-primary hover:text-primary-foreground"
    >
      {copied ? (
        <Check className="size-4" aria-hidden="true" />
      ) : (
        <Copy className="size-4" aria-hidden="true" />
      )}
      {copied ? 'Copied' : 'Copy address'}
    </button>
  );
}

export function Contact() {
  const fieldId = useId();
  const [values, setValues] = useState<FormState>({ name: '', email: '', message: '' });
  const [errors, setErrors] = useState<ContactFormErrors>({});
  const [submitted, setSubmitted] = useState(false);

  const update =
    (field: keyof FormState) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setValues((current) => ({ ...current, [field]: event.target.value }));
      setErrors((current) => ({ ...current, [field]: undefined }));
    };

  // No backend: a validated submit hands a fully composed message to the user's
  // own mail client, so nothing silently disappears into a dead endpoint.
  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextErrors = validateContactForm(values);
    setErrors(nextErrors);

    if (Object.keys(nextErrors).length > 0) return;

    window.location.href = buildMailtoUrl(values, profile.email);
    setSubmitted(true);
  };

  const fieldClass = (hasError: boolean) =>
    cn(
      'w-full rounded-xl border bg-transparent px-4 py-3 text-sm transition-colors placeholder:text-muted-foreground/70',
      hasError ? 'border-red-500/70' : 'border-border focus:border-primary'
    );

  return (
    <Section
      id="contact"
      eyebrow="Contact"
      title="Let's build something"
      description="Open to senior engineering roles and consulting in digital health, mobile and applied AI."
      width="narrow"
      className="bg-muted/40"
    >
      <div className="grid gap-8 lg:grid-cols-[1fr_1.1fr]">
        <Reveal direction="left" className="space-y-6">
          <div className="glass-strong rounded-2xl p-6 shadow-soft">
            <div className="flex size-11 items-center justify-center rounded-xl bg-primary/12">
              <Mail className="size-5 text-primary" aria-hidden="true" />
            </div>
            <h3 className="mt-4 font-display text-base font-semibold">Email</h3>
            <a
              href={`mailto:${profile.email}`}
              className="mt-1 block break-all text-sm text-primary hover:underline"
            >
              {profile.email}
            </a>
            <p className="mt-3 text-sm text-muted-foreground">
              Based in {profile.location} ({profile.timezone}). I usually reply within a day.
            </p>
            <div className="mt-4">
              <CopyEmailButton email={profile.email} />
            </div>
          </div>

          <div>
            <h3 className="font-display text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Elsewhere
            </h3>
            <ul className="mt-3 space-y-2">
              {socialLinks
                .filter((link) => link.label !== 'Email')
                .map(({ label, href, icon: Icon, handle }) => (
                  <li key={label}>
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="glass flex items-center gap-3 rounded-xl px-4 py-3 text-sm transition-colors hover:border-primary/40"
                    >
                      <Icon className="size-4 text-primary" aria-hidden="true" />
                      <span className="font-medium">{label}</span>
                      <span className="ml-auto truncate text-muted-foreground">{handle}</span>
                    </a>
                  </li>
                ))}
            </ul>
          </div>
        </Reveal>

        <Reveal direction="right">
          <form
            onSubmit={onSubmit}
            noValidate
            className="glass-strong space-y-4 rounded-2xl p-6 shadow-soft"
          >
            <div>
              <label htmlFor={`${fieldId}-name`} className="mb-1.5 block text-sm font-medium">
                Name
              </label>
              <input
                id={`${fieldId}-name`}
                name="name"
                type="text"
                autoComplete="name"
                value={values.name}
                onChange={update('name')}
                aria-invalid={Boolean(errors.name)}
                aria-describedby={errors.name ? `${fieldId}-name-error` : undefined}
                className={fieldClass(Boolean(errors.name))}
                placeholder="Your name"
              />
              {errors.name ? (
                <p id={`${fieldId}-name-error`} className="mt-1.5 text-sm text-red-500">
                  {errors.name}
                </p>
              ) : null}
            </div>

            <div>
              <label htmlFor={`${fieldId}-email`} className="mb-1.5 block text-sm font-medium">
                Email
              </label>
              <input
                id={`${fieldId}-email`}
                name="email"
                type="email"
                autoComplete="email"
                value={values.email}
                onChange={update('email')}
                aria-invalid={Boolean(errors.email)}
                aria-describedby={errors.email ? `${fieldId}-email-error` : undefined}
                className={fieldClass(Boolean(errors.email))}
                placeholder="you@company.com"
              />
              {errors.email ? (
                <p id={`${fieldId}-email-error`} className="mt-1.5 text-sm text-red-500">
                  {errors.email}
                </p>
              ) : null}
            </div>

            <div>
              <label htmlFor={`${fieldId}-message`} className="mb-1.5 block text-sm font-medium">
                Message
              </label>
              <textarea
                id={`${fieldId}-message`}
                name="message"
                rows={5}
                value={values.message}
                onChange={update('message')}
                aria-invalid={Boolean(errors.message)}
                aria-describedby={errors.message ? `${fieldId}-message-error` : undefined}
                className={cn(fieldClass(Boolean(errors.message)), 'resize-y')}
                placeholder="What are you building?"
              />
              {errors.message ? (
                <p id={`${fieldId}-message-error`} className="mt-1.5 text-sm text-red-500">
                  {errors.message}
                </p>
              ) : null}
            </div>

            <button
              type="submit"
              className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-primary px-6 py-3 font-medium text-primary-foreground transition-transform hover:scale-[1.02]"
            >
              <Send className="size-4" aria-hidden="true" />
              Compose email
            </button>

            <p className="text-center text-xs text-muted-foreground" role="status">
              {submitted
                ? 'Your mail client should now be open with the message ready to send.'
                : 'Opens your own mail client with this message pre-filled — nothing is sent from this page.'}
            </p>
          </form>
        </Reveal>
      </div>
    </Section>
  );
}

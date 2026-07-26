export interface ContactFormValues {
  name: string;
  email: string;
  message: string;
}

export type ContactFormErrors = Partial<Record<keyof ContactFormValues, string>>;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateContactForm(values: ContactFormValues): ContactFormErrors {
  const errors: ContactFormErrors = {};

  if (values.name.trim().length < 2) {
    errors.name = 'Please enter your name.';
  }
  if (!EMAIL_PATTERN.test(values.email.trim())) {
    errors.email = 'Please enter a valid email address.';
  }
  if (values.message.trim().length < 10) {
    errors.message = 'A little more detail helps — at least 10 characters.';
  }

  return errors;
}

export function buildMailtoUrl(values: ContactFormValues, to: string): string {
  const subject = `Portfolio enquiry from ${values.name.trim()}`;
  const body = `${values.message.trim()}\n\n—\n${values.name.trim()}\n${values.email.trim()}`;
  return `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

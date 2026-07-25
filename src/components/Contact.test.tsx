import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Contact } from './Contact';
import { buildMailtoUrl, validateContactForm } from '@/lib/contact';

const valid = {
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  message: 'I would like to talk about a Flutter project.',
};

describe('validateContactForm', () => {
  it('accepts a complete submission', () => {
    expect(validateContactForm(valid)).toEqual({});
  });

  it('rejects a missing name', () => {
    expect(validateContactForm({ ...valid, name: ' ' })).toHaveProperty('name');
  });

  it('rejects a malformed email', () => {
    expect(validateContactForm({ ...valid, email: 'ada@' })).toHaveProperty('email');
    expect(validateContactForm({ ...valid, email: 'ada example.com' })).toHaveProperty('email');
  });

  it('rejects a message that is too short to act on', () => {
    expect(validateContactForm({ ...valid, message: 'hi' })).toHaveProperty('message');
  });
});

describe('buildMailtoUrl', () => {
  it('encodes the subject and body into a mailto link', () => {
    const url = buildMailtoUrl(valid, 'me@example.com');

    expect(url.startsWith('mailto:me@example.com?')).toBe(true);
    expect(url).toContain(encodeURIComponent('Portfolio enquiry from Ada Lovelace'));
    expect(url).toContain(encodeURIComponent(valid.message));
  });

  it('escapes characters that would otherwise break the URL', () => {
    const url = buildMailtoUrl({ ...valid, message: 'a&b=c d' }, 'me@example.com');
    expect(url).toContain(encodeURIComponent('a&b=c d'));
    expect(url).not.toContain('a&b=c d');
  });
});

describe('<Contact />', () => {
  it('surfaces validation errors instead of navigating away', async () => {
    const user = userEvent.setup();
    render(<Contact />);

    await user.click(screen.getByRole('button', { name: /compose email/i }));

    expect(await screen.findByText(/please enter your name/i)).toBeInTheDocument();
    expect(screen.getByText(/valid email address/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^name$/i)).toHaveAttribute('aria-invalid', 'true');
  });

  it('clears a field error once the visitor corrects it', async () => {
    const user = userEvent.setup();
    render(<Contact />);

    await user.click(screen.getByRole('button', { name: /compose email/i }));
    expect(await screen.findByText(/please enter your name/i)).toBeInTheDocument();

    await user.type(screen.getByLabelText(/^name$/i), 'Ada');
    expect(screen.queryByText(/please enter your name/i)).not.toBeInTheDocument();
  });
});

import { describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Projects } from './Projects';
import { projects } from '@/data/projects';

describe('<Projects />', () => {
  it('lists every project before any filter is applied', () => {
    render(<Projects />);
    projects.forEach((project) => {
      expect(screen.getByRole('heading', { name: project.title })).toBeInTheDocument();
    });
  });

  it('narrows the grid to the selected category', async () => {
    const user = userEvent.setup();
    render(<Projects />);

    const filters = screen.getByRole('group', { name: /filter projects/i });
    await user.click(within(filters).getByRole('button', { name: /^Mobile/ }));

    const mobile = projects.filter((p) => p.category === 'Mobile');
    const others = projects.filter((p) => p.category !== 'Mobile');

    mobile.forEach((project) => {
      expect(screen.getByRole('heading', { name: project.title })).toBeInTheDocument();
    });

    // Filtered-out cards stay mounted until their exit animation finishes.
    await waitFor(() => {
      others.forEach((project) => {
        expect(screen.queryByRole('heading', { name: project.title })).not.toBeInTheDocument();
      });
    });
  });

  it('marks the active filter for assistive technology', async () => {
    const user = userEvent.setup();
    render(<Projects />);

    const filters = screen.getByRole('group', { name: /filter projects/i });
    const all = within(filters).getByRole('button', { name: /^All/ });
    const backend = within(filters).getByRole('button', { name: /^Backend/ });

    expect(all).toHaveAttribute('aria-pressed', 'true');

    await user.click(backend);
    expect(backend).toHaveAttribute('aria-pressed', 'true');
    expect(all).toHaveAttribute('aria-pressed', 'false');
  });

  it('only offers categories that contain at least one project', () => {
    render(<Projects />);
    const filters = screen.getByRole('group', { name: /filter projects/i });

    within(filters)
      .getAllByRole('button')
      .forEach((button) => {
        // Label renders as e.g. "Backend1" — the trailing digits are the count.
        const count = Number(/(\d+)$/.exec(button.textContent ?? '')?.[1]);
        expect(count).toBeGreaterThan(0);
      });
  });
});

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Navbar } from './Navbar';
import { navItems } from '@/data/navigation';

describe('<Navbar />', () => {
  it('links to every section', () => {
    render(<Navbar />);
    navItems.forEach((item) => {
      const links = screen.getAllByRole('link', { name: item.label });
      expect(links.length).toBeGreaterThan(0);
      expect(links[0]).toHaveAttribute('href', `#${item.id}`);
    });
  });

  it('opens and closes the mobile menu, keeping aria-expanded in sync', async () => {
    const user = userEvent.setup();
    render(<Navbar />);

    const trigger = screen.getByRole('button', { name: /open menu/i });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    await user.click(trigger);
    const opened = screen.getByRole('button', { name: /close menu/i });
    expect(opened).toHaveAttribute('aria-expanded', 'true');

    await user.click(opened);
    expect(screen.getByRole('button', { name: /open menu/i })).toHaveAttribute(
      'aria-expanded',
      'false'
    );
  });

  it('closes the mobile menu on Escape and restores focus to the trigger', async () => {
    const user = userEvent.setup();
    render(<Navbar />);

    const trigger = screen.getByRole('button', { name: /open menu/i });
    await user.click(trigger);
    expect(screen.getByRole('button', { name: /close menu/i })).toBeInTheDocument();

    await user.keyboard('{Escape}');

    const restored = screen.getByRole('button', { name: /open menu/i });
    expect(restored).toHaveAttribute('aria-expanded', 'false');
    expect(restored).toHaveFocus();
  });

  it('offers the résumé as a download', () => {
    render(<Navbar />);
    const [resume] = screen.getAllByRole('link', { name: /résumé/i });
    expect(resume).toHaveAttribute('href', '/cv.pdf');
    expect(resume).toHaveAttribute('download');
  });
});

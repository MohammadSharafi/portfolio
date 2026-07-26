import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Journey } from './Journey';
import { journey } from '@/data/journey';

describe('<Journey />', () => {
  it('renders the whole story as a list in the static variant', () => {
    render(<Journey activeIndex={0} variant="static" />);
    for (const chapter of journey) {
      expect(screen.getByText(chapter.title)).toBeInTheDocument();
    }
  });

  /**
   * The overlay only cross-fades between chapters — it must never drop the ones
   * the camera has not reached, or a screen reader would get whichever single
   * paragraph happened to be visible at the scroll position it started from.
   */
  it('keeps every chapter in the document in the overlay variant', () => {
    render(<Journey activeIndex={3} variant="overlay" />);
    for (const chapter of journey) {
      expect(screen.getByText(chapter.title)).toBeInTheDocument();
    }
  });

  it('reads the chapters in narrative order', () => {
    render(<Journey activeIndex={0} variant="overlay" />);
    const headings = screen.getAllByRole('heading', { level: 2 });
    expect(headings.map((heading) => heading.textContent)).toEqual(
      journey.map((chapter) => chapter.title)
    );
  });
});

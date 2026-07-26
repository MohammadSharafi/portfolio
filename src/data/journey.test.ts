import { describe, expect, it } from 'vitest';
import { journey } from './journey';
import { buildJourney } from '@/three/journey';

describe('journey chapters', () => {
  it('numbers the chapters in order from 01', () => {
    expect(journey.map((chapter) => chapter.index)).toEqual(['01', '02', '03', '04', '05', '06']);
  });

  it('gives every chapter a unique id', () => {
    expect(new Set(journey.map((chapter) => chapter.id)).size).toBe(journey.length);
  });

  it('gives every chapter the copy the caption renders', () => {
    for (const chapter of journey) {
      expect(chapter.place.length).toBeGreaterThan(0);
      expect(chapter.period.length).toBeGreaterThan(0);
      expect(chapter.title.length).toBeGreaterThan(0);
      expect(chapter.body.length).toBeGreaterThan(40);
    }
  });

  /**
   * The 3D world builds the first five chapters as stages and the room supplies
   * the last. Adding a chapter to the copy without adding a stage would leave a
   * caption the camera never travels to, which is invisible in review because
   * the caption still renders — it just narrates an empty frame.
   */
  it('has one 3D stage per chapter, with the room as the last', () => {
    const { stages } = buildJourney();
    expect(stages).toHaveLength(journey.length - 1);
  });

  it('places the stages in the order the camera meets them', () => {
    const { stages } = buildJourney();
    const anchors = stages.map((stage) => stage.root.position.x);
    // The camera drives toward the origin, so each stage sits nearer than the last.
    expect([...anchors].sort((a, b) => b - a)).toEqual(anchors);
    expect(anchors.at(-1)).toBeGreaterThan(0);
  });
});

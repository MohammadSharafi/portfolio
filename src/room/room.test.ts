import { describe, expect, it } from 'vitest';
import { toObjectId } from './systems/objectId';
import { objectIds, roomObjects, roomObjectById } from './data/objects';
import { experience } from '@/data/experience';
import { profile } from '@/data/profile';

/**
 * The room's two silent failure modes.
 *
 * Nothing in this file tests rendering. It tests the two places where the room
 * has repeatedly broken without breaking: a mesh name that no longer resolves to
 * an object, and a panel link that goes nowhere. Both leave the site loading
 * cleanly, the console empty and the object simply not responding, which is why
 * they survived being looked at for weeks at a time.
 */

describe('toObjectId', () => {
  it('resolves a mesh named exactly for its object', () => {
    expect(toObjectId('ix_keyboard')).toBe('keyboard');
    expect(toObjectId('ix_sticky_notes')).toBe('sticky-notes');
  });

  it('ignores the suffix glTF adds when it splits a multi-material mesh', () => {
    expect(toObjectId('ix_chair_3')).toBe(null); // not in the registry at all
    expect(toObjectId('ix_keyboard_2')).toBe('keyboard');
    expect(toObjectId('ix_monitor_code_1')).toBe('monitor-code');
  });

  it('resolves a named sub-part to the object it belongs to', () => {
    // These are the surfaces the runtime paints, and they are the largest and
    // most obviously clickable parts of their objects. Every one of them used
    // to be dead: clicking a monitor's screen did nothing, and only the few
    // centimetres of bezel around it registered.
    expect(toObjectId('ix_monitor_health_display')).toBe('monitor-health');
    expect(toObjectId('ix_monitor_code_display')).toBe('monitor-code');
    expect(toObjectId('ix_laptop_display')).toBe('laptop');
    expect(toObjectId('ix_laptop_lid_body')).toBe('laptop');
    expect(toObjectId('ix_whiteboard_face')).toBe('whiteboard');
    expect(toObjectId('ix_cv_face')).toBe('cv');
  });

  it('prefers the longest match, so a sub-part never steals its parent', () => {
    // `sticky-notes` is a registry id in its own right and must not collapse to
    // some shorter prefix on the way past.
    expect(toObjectId('ix_sticky_notes')).toBe('sticky-notes');
  });

  it('returns null for anything not in the registry', () => {
    expect(toObjectId('desk_top')).toBe(null);
    expect(toObjectId('ix_nonsense')).toBe(null);
    expect(toObjectId('ix_book_spine_0')).toBe(null);
  });
});

describe('the object registry', () => {
  it('has one entry per id, and no duplicates', () => {
    expect(roomObjects.map((entry) => entry.id).sort()).toEqual([...objectIds].sort());
    expect(roomObjectById.size).toBe(objectIds.length);
  });

  it('never links to a bare hash', () => {
    // The room and the written site are separate branches of `App`. While the
    // room is showing, `#experience` scrolls to nothing — the section is not in
    // the document — so every cross-link has to switch branches first.
    for (const entry of roomObjects) {
      const href = entry.panel.link?.href;
      if (!href) continue;
      expect(href.startsWith('#'), `${entry.id} links to a section that is not on this page`).toBe(
        false
      );
      if (href.includes('#')) expect(href.startsWith('?text=1#')).toBe(true);
    }
  });

  it('offers the CV as a download of the real file', () => {
    const cv = roomObjectById.get('cv');
    expect(cv?.panel.link?.href).toBe(profile.cvPath);
    expect(cv?.panel.link?.download).toBe(profile.cvFileName);
  });

  it('lists every role on the CV panel, not just the ones the page fits', () => {
    expect(roomObjectById.get('cv')?.panel.items).toHaveLength(experience.length);
  });

  it('gives every object a camera stop that is not the origin', () => {
    for (const entry of roomObjects) {
      const { position, target } = entry.stop;
      expect(position).toHaveLength(3);
      expect(target).toHaveLength(3);
      expect(position.some((value) => value !== 0)).toBe(true);
      // A stop that looks at where it stands has nothing to frame.
      expect(position).not.toEqual(target);
    }
  });
});

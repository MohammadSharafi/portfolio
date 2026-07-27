import { objectIds, type ObjectId } from '../data/objects';

/** Blender tags interactive objects with this prefix; the ids follow it. */
const PREFIX = 'ix_';

/**
 * Maps a mesh name from the GLB back to a registry id.
 *
 * Two things make this more than a lookup.
 *
 * glTF splits a multi-material mesh into one node per material and suffixes the
 * names (`ix_keyboard_1`, `ix_keyboard_2`), so the numeric tail is dropped —
 * otherwise every object built from more than one material would silently stop
 * being interactive.
 *
 * And a named sub-part belongs to its parent. Some objects carry their readable
 * surface as a separate mesh so the runtime can paint it: `ix_monitor_code` has
 * `ix_monitor_code_display`, the whiteboard has `ix_whiteboard_face`, the CV has
 * `ix_cv_face`. Matching only the whole name left every one of those dead —
 * clicking a monitor's actual screen, the brightest and most obviously clickable
 * thing in the room, did nothing at all, and the click only registered on the
 * few centimetres of plastic bezel around it. So the trailing segments are
 * dropped one at a time until something matches, longest first: `sticky-notes`
 * still beats `sticky`, and `monitor-code-display` falls back to `monitor-code`.
 */
export function toObjectId(name: string): ObjectId | null {
  if (!name.startsWith(PREFIX)) return null;
  const parts = name.slice(PREFIX.length).replace(/_\d+$/, '').split('_');
  for (let end = parts.length; end > 0; end -= 1) {
    const stem = parts.slice(0, end).join('-');
    if ((objectIds as readonly string[]).includes(stem)) return stem as ObjectId;
  }
  return null;
}

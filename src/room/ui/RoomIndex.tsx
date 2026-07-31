import { useEffect, useMemo, useRef } from 'react';
import { LayoutGrid, X } from 'lucide-react';
import { useEngine } from '../engine/store';
import { objectGroups, roomObjects, type ObjectId } from '../data/objects';
import { cn } from '@/lib/utils';

/**
 * Everything there is to find, when you ask for it.
 *
 * This replaces a rail of fifteen pill buttons that was pinned across the
 * bottom of the frame at all times. That rail had three problems and only the
 * first was cosmetic: it spent a permanent strip of a 3D scene on a menu; it
 * overflowed into a horizontal scroller on any phone, so the last five objects
 * were reachable only by dragging a bar most people never noticed; and it
 * flattened a room with a desk end and a lounge end into one undifferentiated
 * row of nouns, which taught a visitor nothing about where anything was.
 *
 * A room is not a nav bar. So the list is grouped the way the content is
 * grouped — the work, the craft, the story, the room itself — it says what
 * each thing is rather than only naming it, and it stays out of the frame
 * until asked for.
 *
 * It remains the room's entire keyboard and screen-reader surface: the canvas
 * is `aria-hidden` and has no tab stops, so every object must have a real
 * button here whether or not it is on screen. That constraint is why this is a
 * disclosure rather than something clever with hotspots — a control that only
 * exists once you have found it in 3D is not an accessible control.
 */
export function RoomIndex() {
  const open = useEngine((state) => state.indexOpen);
  const setOpen = useEngine((state) => state.setIndexOpen);
  const focused = useEngine((state) => state.focused);
  const discovered = useEngine((state) => state.discovered);
  const focus = useEngine((state) => state.focus);

  const panelRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);

  const grouped = useMemo(
    () =>
      objectGroups.map((group) => ({
        group,
        entries: roomObjects.filter((entry) => entry.group === group),
      })),
    []
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        toggleRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  const choose = (id: ObjectId) => {
    focus(id);
    setOpen(false);
  };

  const found = discovered.length;
  const total = roomObjects.length;

  return (
    <>
      <button
        ref={toggleRef}
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls="room-index"
        className="pointer-events-auto flex items-center gap-2 rounded-full bg-black/55 px-3.5 py-2 text-xs font-medium text-white/70 backdrop-blur-md transition-colors hover:text-white"
      >
        <LayoutGrid className="size-3.5" aria-hidden="true" />
        What&rsquo;s in here
        {/* Progress, stated rather than implied by a scattering of dots. It is
          the one number that makes exploring feel finite. */}
        <span className="font-mono text-[0.65rem] text-white/40">
          {found}/{total}
        </span>
      </button>

      {open ? (
        <div
          id="room-index"
          ref={panelRef}
          className="pointer-events-auto absolute left-4 top-28 max-h-[calc(100vh-9rem)] w-[min(20rem,calc(100vw-2rem))] overflow-y-auto rounded-2xl border border-white/10 bg-black/75 p-4 backdrop-blur-xl"
        >
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <h2 className="font-display text-sm font-semibold text-white">
                What&rsquo;s in here
              </h2>
              <p className="mt-0.5 text-[0.7rem] text-white/40">
                Or just click things in the room.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                toggleRef.current?.focus();
              }}
              className="rounded-full p-1.5 text-white/50 transition-colors hover:bg-white/10 hover:text-white"
              aria-label="Close the index"
            >
              <X className="size-3.5" aria-hidden="true" />
            </button>
          </div>

          {grouped.map(({ group, entries }) => (
            <section key={group} className="mt-3 first:mt-0">
              <h3 className="px-1 font-mono text-[0.6rem] uppercase tracking-[0.2em] text-white/30">
                {group}
              </h3>
              <ul className="mt-1.5 space-y-0.5">
                {entries.map((entry) => {
                  const seen = discovered.includes(entry.id);
                  return (
                    <li key={entry.id}>
                      <button
                        type="button"
                        onClick={() => choose(entry.id)}
                        aria-current={focused === entry.id ? 'true' : undefined}
                        className={cn(
                          'w-full rounded-lg px-2.5 py-2 text-left transition-colors',
                          focused === entry.id ? 'bg-white/15' : 'hover:bg-white/10'
                        )}
                      >
                        <span className="flex items-center gap-2">
                          <span
                            className={cn(
                              'size-1 shrink-0 rounded-full',
                              seen ? 'bg-emerald-400' : 'bg-white/25'
                            )}
                            aria-hidden="true"
                          />
                          <span className="text-sm font-medium text-white/85">{entry.label}</span>
                        </span>
                        {/* The guide line, not the hover hint. A list that
                          only names things makes a visitor click all fifteen
                          to find the two they came for. */}
                        <span className="mt-0.5 block pl-3 text-[0.7rem] leading-snug text-white/40">
                          {entry.guide}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      ) : null}
    </>
  );
}

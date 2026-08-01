import { useEffect } from 'react';
import { MousePointerClick, Footprints, Compass, Music4, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useEngine } from '../engine/store';
import { cn } from '@/lib/utils';
import { isTouch } from '../engine/touchInput';

/**
 * How anyone is supposed to know what this is.
 *
 * The room asks a visitor to do three things no web page has ever asked them
 * to do — click objects instead of links, take control of a robot, fly it —
 * and it was telling them none of it. There was a single line of grey text
 * reading "Click anything in the room", which describes one of the three and
 * is the sort of hint that gets read as decoration.
 *
 * This is deliberately a *guide* and not a tutorial: four cards, readable in
 * about fifteen seconds, dismissible at any point and never shown again. It
 * does not gate the room, it does not lock the camera, and it does not make
 * anyone press keys to prove they read it — a portfolio that holds a recruiter
 * hostage to an onboarding flow has misjudged whose time is scarce.
 *
 * `guideStep` is persisted. A returning visitor gets the room, not the lesson.
 */

interface Step {
  icon: LucideIcon;
  title: string;
  body: string;
  keys?: readonly string[];
  /** What this step says on a touchscreen, where the body's talk of holding
   *  Space is simply untrue. Falls back to the keyboard copy when absent. */
  touchBody?: string;
  touchKeys?: readonly string[];
}

const STEPS: readonly Step[] = [
  {
    icon: MousePointerClick,
    title: 'Everything here is clickable',
    body: 'The monitors, the CV standing on the desk, the whiteboard, the shelf. Click one and the camera moves to it and tells you what it is. There is no scrolling and no menu to learn.',
    touchBody:
      'The monitors, the CV standing on the desk, the whiteboard, the shelf. Tap one — or tap any of the labels floating in the room — and the camera moves to it and tells you what it is.',
  },
  {
    icon: Footprints,
    title: 'Or walk it yourself',
    body: 'Take the little robot on the desk and drive it around the room. It is knee-high to a coffee cup, which is the point — the desk looks like a building from down there.',
    touchBody:
      'Take the little robot and drive it around the room with the stick, bottom left. Drag anywhere else to look around. It is knee-high to a coffee cup, which is the point — the desk looks like a building from down there.',
    keys: ['W', 'A', 'D', 'Shift'],
    touchKeys: ['Left stick', 'Drag to look'],
  },
  {
    icon: Compass,
    title: 'It flies, too',
    body: 'Hold Space and the thrusters lift it. Fuel drains while they burn and refills on the ground, so a flight is a trip you plan rather than a hover. Land on the desk, the sofa, the shelves.',
    touchBody:
      'Hold the Fly button and the thrusters lift it. Fuel drains while they burn and refills on the ground, so a flight is a trip you plan rather than a hover. Land on the desk, the sofa, the shelves.',
    keys: ['Space'],
    touchKeys: ['Fly'],
  },
  {
    icon: Music4,
    title: 'The guitar plays',
    body: 'Walk up to the guitar by the wall and press E. It has a real playlist, and the music keeps going while you explore the rest of the room.',
    touchBody:
      'Drive up to the guitar by the wall and tap Play when the button appears. It has a real playlist, and the music keeps going while you explore the rest of the room.',
    keys: ['E'],
    touchKeys: ['Play'],
  },
];

export function Guide() {
  const guideStep = useEngine((state) => state.guideStep);
  const setGuideStep = useEngine((state) => state.setGuideStep);
  const entered = useEngine((state) => state.entered);
  const focused = useEngine((state) => state.focused);

  // `null` is "has never seen it", which means show it from the beginning —
  // not "hide it", which is what treating null as a closed state would do.
  // Dismissal is `guideStep === STEPS.length`, and that is what persists.
  const index = guideStep ?? 0;
  const open = entered && index < STEPS.length;
  const step = STEPS[index];

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setGuideStep(STEPS.length);
      if (event.key === 'ArrowRight' || event.key === 'Enter') {
        setGuideStep(Math.min(STEPS.length, index + 1));
      }
      if (event.key === 'ArrowLeft') setGuideStep(Math.max(0, index - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, index, setGuideStep]);

  // Opening an object means the visitor has worked out how this room behaves.
  // Keeping the lesson on screen at that point is condescending.
  useEffect(() => {
    if (focused !== null && index < STEPS.length) setGuideStep(STEPS.length);
  }, [focused, index, setGuideStep]);

  if (!open || !step) return null;

  const Icon = step.icon;
  const last = index === STEPS.length - 1;

  return (
    <div className="pointer-events-auto absolute bottom-4 left-1/2 w-[min(30rem,calc(100vw-1.5rem))] -translate-x-1/2 sm:bottom-6">
      <div className="relative overflow-hidden rounded-xl border border-white/10 bg-black/80 p-4 backdrop-blur-xl sm:rounded-2xl sm:p-5">
        <button
          type="button"
          onClick={() => setGuideStep(STEPS.length)}
          className="absolute right-3 top-3 rounded-full p-1.5 text-white/40 transition-colors hover:bg-white/10 hover:text-white"
          aria-label="Skip the guide"
        >
          <X className="size-3.5" aria-hidden="true" />
        </button>

        <div className="flex gap-3 sm:gap-4">
          <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-white/10 text-sky-300 sm:size-9 sm:rounded-xl">
            <Icon className="size-4.5" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="pr-6 font-display text-[15px] font-semibold text-white sm:text-base">
              {step.title}
            </h2>
            <p className="mt-1.5 text-[13px] leading-relaxed text-white/60 sm:text-sm">
              {isTouch ? (step.touchBody ?? step.body) : step.body}
            </p>
            {(isTouch ? (step.touchKeys ?? step.keys) : step.keys) ? (
              <p className="mt-3 flex flex-wrap gap-1.5">
                {(isTouch ? (step.touchKeys ?? step.keys) : step.keys)!.map((key) => (
                  <kbd
                    key={key}
                    className="rounded-md border border-white/15 bg-white/10 px-2 py-1 font-mono text-[0.7rem] font-medium text-white/80"
                  >
                    {key}
                  </kbd>
                ))}
              </p>
            ) : null}
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between sm:mt-5">
          <div className="flex gap-1.5" aria-hidden="true">
            {STEPS.map((entry, i) => (
              <span
                key={entry.title}
                className={cn(
                  'h-1 rounded-full transition-all duration-300',
                  i === index ? 'w-5 bg-white/70' : 'w-1 bg-white/20'
                )}
              />
            ))}
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setGuideStep(STEPS.length)}
              className="text-xs text-white/40 transition-colors hover:text-white/70"
            >
              Skip
            </button>
            <button
              type="button"
              onClick={() => setGuideStep(index + 1)}
              className="rounded-full bg-white px-4 py-1.5 text-xs font-medium text-black transition-opacity hover:opacity-90"
            >
              {last ? 'Explore' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Re-opens the guide. Lives in the corner controls, because someone who
 *  dismissed it on their first visit may well want it back on their third. */
export function GuideButton() {
  const setGuideStep = useEngine((state) => state.setGuideStep);
  const guideStep = useEngine((state) => state.guideStep);
  const open = (guideStep ?? 0) < STEPS.length;

  return (
    <button
      type="button"
      onClick={() => setGuideStep(open ? STEPS.length : 0)}
      className="pointer-events-auto rounded-full bg-black/55 px-3 py-2 text-xs font-medium text-white/70 backdrop-blur-md transition-colors hover:text-white"
    >
      {open ? 'Hide guide' : 'How this works'}
    </button>
  );
}

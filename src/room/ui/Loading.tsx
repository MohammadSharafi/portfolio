import { useEffect, useRef, useState } from 'react';
import { useProgress } from '@react-three/drei';
import { profile } from '@/data/profile';
import { useEngine } from '../engine/store';
import { quality } from '../engine/quality';

/**
 * The door.
 *
 * The room is ten megabytes of geometry, a 4096 lightmap and a 2048 aging
 * atlas, and until all of it has arrived the canvas is a black rectangle. What
 * used to happen was that the black rectangle simply sat there — no progress,
 * no name, nothing to read — and on a slow connection that is indistinguishable
 * from a site that is broken. First impressions were being spent on a blank
 * screen.
 *
 * So the wait is the introduction. The name and the line about what I do are
 * readable within the first paint, the bar tells the truth about how far along
 * the load is, and the way in is a deliberate press rather than an automatic
 * cut — which also earns the audio context the user gesture it needs, and
 * means nobody is dropped into a moving camera they did not ask for.
 *
 * `useProgress` is backed by three's DefaultLoadingManager, so this reports
 * bytes the room is genuinely waiting on rather than an animated guess.
 */
export function Loading() {
  const { progress, active } = useProgress();
  const entered = useEngine((state) => state.entered);
  const enter = useEngine((state) => state.enter);
  const setProgress = useEngine((state) => state.setProgress);

  // The loader reports 100 and goes inactive a frame or two before the first
  // real frame is drawn, and cutting on that number puts a black flash between
  // the door and the room. Holding until it has been settled for a beat costs
  // a third of a second and removes it.
  const [settled, setSettled] = useState(false);
  const enterButton = useRef<HTMLButtonElement>(null);

  useEffect(() => setProgress(progress / 100), [progress, setProgress]);

  // Focus the way in once it appears, rather than `autoFocus`. The two look
  // equivalent and are not: `autoFocus` fires on mount, and this button mounts
  // when the load finishes — which for a keyboard user is an unannounced focus
  // jump some minutes after the page arrived. Moving it deliberately, at the
  // moment the control becomes the only thing to do, is the behaviour that
  // needs no apology.
  useEffect(() => {
    if (settled) enterButton.current?.focus();
  }, [settled]);

  useEffect(() => {
    if (active || progress < 100) return;
    const timer = window.setTimeout(() => setSettled(true), 350);
    return () => window.clearTimeout(timer);
  }, [active, progress]);

  // Once dismissed, stay dismissed. Suspense can re-suspend when a later
  // texture streams in, and a door that reappears over a room the visitor is
  // already walking around in reads as a crash.
  if (entered) return null;

  const ready = settled;
  const tier = quality().tier;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-[#05070c] px-6">
      {/* A slow warm wash from where the desk lamp will be, so the door is
        already the room's colour rather than a neutral splash screen. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-70"
        style={{
          background:
            'radial-gradient(60% 55% at 62% 38%, rgba(255,154,66,0.13) 0%, rgba(255,154,66,0) 62%), radial-gradient(48% 42% at 22% 72%, rgba(90,147,255,0.10) 0%, rgba(90,147,255,0) 60%)',
        }}
      />

      <div className="relative w-full max-w-md text-center">
        <p className="font-mono text-[0.65rem] uppercase tracking-[0.35em] text-white/35">
          Portfolio
        </p>
        <h1 className="mt-4 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          {profile.name}
        </h1>
        <p className="mt-2 text-sm text-white/45">{profile.role}</p>
        <p className="mx-auto mt-5 max-w-sm text-sm leading-relaxed text-white/60">
          {profile.tagline}
        </p>

        <div className="mt-9">
          <div
            className="h-px w-full overflow-hidden bg-white/10"
            role="progressbar"
            aria-valuenow={Math.round(progress)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Loading the room"
          >
            <div
              className="h-full bg-gradient-to-r from-sky-400/70 to-emerald-300/80 transition-[width] duration-300 ease-out"
              style={{ width: `${ready ? 100 : progress}%` }}
            />
          </div>

          <div className="mt-5 flex min-h-[2.75rem] items-center justify-center">
            {ready ? (
              <button
                ref={enterButton}
                type="button"
                onClick={enter}
                className="rounded-full bg-white px-7 py-3 text-sm font-medium text-black transition-transform duration-200 hover:scale-[1.03] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white/60"
              >
                Step inside
              </button>
            ) : (
              <p className="font-mono text-[0.7rem] uppercase tracking-[0.2em] text-white/30">
                Building the room · {Math.round(progress)}%
              </p>
            )}
          </div>
        </div>

        {/* Only worth saying on the tier where it changed something. Telling
          someone on a fast machine that quality was reduced would be a lie,
          and telling everyone would be noise. */}
        {ready && tier === 'low' ? (
          <p className="mt-6 text-[0.7rem] leading-relaxed text-white/30">
            Running in the lighter mode for this device. Add{' '}
            <code className="text-white/45">?quality=high</code> to the URL to override it.
          </p>
        ) : null}
      </div>
    </div>
  );
}

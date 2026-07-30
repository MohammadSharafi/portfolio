import { useEffect, useRef } from 'react';
import { Volume2, VolumeX, X } from 'lucide-react';
import { useEngine } from '../engine/store';
import { roomObjects, roomObjectById } from '../data/objects';
import { profile } from '@/data/profile';
import { roomAudio } from '../engine/audio';
import { cn } from '@/lib/utils';

/**
 * The UI layer over the canvas.
 *
 * The canvas itself is `aria-hidden` and has no tab stops, so this is not a
 * convenience layer — it is the only way the room is reachable without a mouse.
 * Every object in the registry gets a real button here whether or not it is on
 * screen, which also means the whole room is in the document for a crawler and
 * a screen reader rather than locked inside a WebGL context.
 */
export function Overlay() {
  const focused = useEngine((state) => state.focused);
  const hovered = useEngine((state) => state.hovered);
  const discovered = useEngine((state) => state.discovered);
  const focus = useEngine((state) => state.focus);
  const unfocus = useEngine((state) => state.unfocus);
  const lampOn = useEngine((state) => state.lampOn);
  const toggleLamp = useEngine((state) => state.toggleLamp);
  const muted = useEngine((state) => state.muted);
  const toggleMuted = useEngine((state) => state.toggleMuted);
  const controlled = useEngine((state) => state.controlled);
  const setControlled = useEngine((state) => state.setControlled);
  const nearby = useEngine((state) => state.nearby);
  const nearbyObject = nearby ? roomObjectById.get(nearby) : undefined;

  const panelRef = useRef<HTMLDivElement>(null);
  const returnTo = useRef<HTMLButtonElement | null>(null);

  const object = focused ? roomObjectById.get(focused) : undefined;

  useEffect(() => {
    if (!focused) return;
    panelRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') unfocus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [focused, unfocus]);

  useEffect(() => {
    roomAudio.setMuted(muted);
  }, [muted]);

  useEffect(() => () => roomAudio.dispose(), []);

  useEffect(() => {
    // Focus goes back to the control that opened the panel, not to the top of
    // the document, so a keyboard user does not lose their place in the room.
    if (!focused) returnTo.current?.focus();
  }, [focused]);

  return (
    <div className="pointer-events-none fixed inset-0 z-40">
      {/*
        Everything the room says, in the document.

        The canvas is aria-hidden and carries no text a crawler or a screen
        reader can reach, and only one panel is ever mounted at a time. Without
        this the site would be a portfolio that a recruiter's search cannot find
        and a screen reader cannot open — which is a real regression, not a
        purist objection. Visually hidden, not display:none, so it is still read.
      */}
      <div className="sr-only">
        <h1>{profile.name}</h1>
        <p>{profile.tagline}</p>
        <p>
          {profile.availability}. Based in {profile.location} ({profile.timezone}).
        </p>
        <p>
          This page is an interactive 3D workspace. <a href="?text=1">Open the written version</a>{' '}
          for the same information as a document.
        </p>
        {roomObjects.map((entry) => (
          <section key={entry.id}>
            <h2>{entry.panel.title}</h2>
            <p>{entry.panel.kicker}</p>
            <p>{entry.panel.body}</p>
            {entry.panel.items.length > 0 ? (
              <ul>
                {entry.panel.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            ) : null}
          </section>
        ))}
      </div>

      <p className="absolute left-1/2 top-6 -translate-x-1/2 text-xs uppercase tracking-[0.25em] text-white/45">
        {hovered ? (roomObjectById.get(hovered)?.hint ?? '') : 'Click anything in the room'}
      </p>

      {/* The object list. Doubles as the keyboard path and as the "what is
        there to find" affordance, so nothing depends on hunting with a mouse. */}
      <a
        href="?text=1"
        className="pointer-events-auto absolute left-4 top-4 rounded-full bg-black/55 px-3.5 py-2 text-xs font-medium text-white/70 backdrop-blur-md transition-colors hover:text-white"
      >
        Read it instead
      </a>

      {/* The game layer's front door. The robot idles on the desk either
        way; this hands it the keyboard. Hidden while a panel is open — the
        panel owns the keys then. */}
      {!focused ? (
        <button
          type="button"
          onClick={() => setControlled(!controlled)}
          aria-pressed={controlled}
          className="pointer-events-auto absolute left-4 top-16 rounded-full bg-black/55 px-3.5 py-2 text-xs font-medium text-white/70 backdrop-blur-md transition-colors hover:text-white"
        >
          {controlled ? 'Stop walking' : 'Walk the room'}
        </button>
      ) : null}

      {controlled && !focused ? (
        <p className="absolute bottom-24 left-1/2 -translate-x-1/2 rounded-full bg-black/55 px-4 py-2 text-xs text-white/75 backdrop-blur-md">
          {nearbyObject ? (
            <>
              <kbd className="rounded bg-white/15 px-1.5 py-0.5 font-semibold">E</kbd> inspect{' '}
              {nearbyObject.label.toLowerCase()}
            </>
          ) : (
            'W to walk · A / D to turn · S to back up · Shift to hurry · Esc to stop'
          )}
        </p>
      ) : null}

      <button
        type="button"
        onClick={toggleMuted}
        aria-pressed={!muted}
        className="pointer-events-auto absolute right-4 top-4 rounded-full bg-black/55 p-2.5 text-white/70 backdrop-blur-md transition-colors hover:text-white"
        aria-label={muted ? 'Turn room sound on' : 'Turn room sound off'}
      >
        {muted ? (
          <VolumeX className="size-4" aria-hidden="true" />
        ) : (
          <Volume2 className="size-4" aria-hidden="true" />
        )}
      </button>

      <nav
        aria-label="Objects in the room"
        className="pointer-events-auto absolute bottom-4 left-1/2 flex max-w-[95vw] -translate-x-1/2 gap-1.5 overflow-x-auto rounded-full bg-black/55 p-1.5 backdrop-blur-md"
      >
        {roomObjects.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={(event) => {
              returnTo.current = event.currentTarget;
              focus(entry.id);
            }}
            aria-current={focused === entry.id ? 'true' : undefined}
            className={cn(
              'relative shrink-0 rounded-full px-3.5 py-2 text-xs font-medium transition-colors',
              focused === entry.id
                ? 'bg-white text-black'
                : 'text-white/70 hover:bg-white/10 hover:text-white'
            )}
          >
            {entry.label}
            {discovered.includes(entry.id) && focused !== entry.id ? (
              <span
                className="absolute right-1.5 top-1.5 size-1 rounded-full bg-emerald-400"
                aria-hidden="true"
              />
            ) : null}
          </button>
        ))}
      </nav>

      {object ? (
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="false"
          aria-labelledby="room-panel-title"
          tabIndex={-1}
          className="pointer-events-auto absolute inset-x-4 bottom-20 mx-auto max-w-md rounded-2xl border border-white/10 bg-black/70 p-5 text-white backdrop-blur-xl outline-none sm:inset-x-auto sm:right-8 sm:top-1/2 sm:-translate-y-1/2"
        >
          <button
            type="button"
            onClick={unfocus}
            className="absolute right-3 top-3 rounded-full p-1.5 text-white/60 transition-colors hover:bg-white/10 hover:text-white"
            aria-label="Close and return to the room"
          >
            <X className="size-4" aria-hidden="true" />
          </button>

          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-sky-300">
            {object.panel.kicker}
          </p>
          <h2 id="room-panel-title" className="mt-1.5 font-display text-xl font-semibold">
            {object.panel.title}
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-white/70">{object.panel.body}</p>

          {object.panel.items.length > 0 ? (
            <ul className="mt-3 space-y-1.5 text-sm text-white/70">
              {object.panel.items.map((item) => (
                <li key={item} className="flex gap-2">
                  <span
                    className="mt-1.5 size-1 shrink-0 rounded-full bg-sky-400"
                    aria-hidden="true"
                  />
                  {item}
                </li>
              ))}
            </ul>
          ) : null}

          {object.id === 'lamp' ? (
            <button
              type="button"
              onClick={() => {
                roomAudio.play('switch');
                toggleLamp();
              }}
              aria-pressed={lampOn}
              className="mt-4 rounded-full bg-white px-4 py-2 text-sm font-medium text-black transition-opacity hover:opacity-90"
            >
              {lampOn ? 'Switch the lamp off' : 'Switch the lamp on'}
            </button>
          ) : null}

          {object.panel.link ? (
            <a
              href={object.panel.link.href}
              // Spread rather than `download={link.download}`, because
              // `exactOptionalPropertyTypes` makes `undefined` a value the prop
              // does not accept, and a bare `download` attribute would name the
              // saved file after the URL instead of the person.
              {...(object.panel.link.download ? { download: object.panel.link.download } : {})}
              className="mt-4 inline-block text-sm font-medium text-sky-300 underline underline-offset-4 hover:text-sky-200"
            >
              {object.panel.link.label} →
            </a>
          ) : null}

          <p className="mt-4 text-[11px] text-white/35">Press Esc to step back</p>
        </div>
      ) : null}
    </div>
  );
}

import { useEffect, useReducer, useRef, useState } from 'react';
import { Square, Volume2, VolumeX, X } from 'lucide-react';
import { useEngine } from '../engine/store';
import { characterState } from '../engine/characterState';
import { Minimap } from './Minimap';
import { RoomIndex } from './RoomIndex';
import { Guide, GuideButton } from './Guide';
import { TouchControls } from './TouchControls';
import { isTouch } from '../engine/touchInput';
import {
  isPlaying,
  loadTracks,
  musicState,
  playTrack,
  stopMusic,
  subscribeMusic,
  type Track,
} from '../engine/music';
import { roomObjects, roomObjectById } from '../data/objects';
import { profile } from '@/data/profile';
import { roomAudio } from '../engine/audio';
import { cn } from '@/lib/utils';

/**
 * The UI layer over the canvas.
 *
 * The canvas itself is `aria-hidden` and has no tab stops, so this is not a
 * convenience layer — it is the only way the room is reachable without a mouse.
 * Every object in the registry gets a real button in the index whether or not
 * it is on screen, which also means the whole room is in the document for a
 * crawler and a screen reader rather than locked inside a WebGL context.
 *
 * The chrome is deliberately thin and corner-bound. It used to include a rail
 * of fifteen pills pinned across the bottom of the frame at all times; that
 * has become `RoomIndex`, which says the same things with more context and
 * only when asked. What is left on screen unprompted is a mute toggle, the way
 * into the room's two modes, and — while driving — the plan and the fuel.
 */
export function Overlay() {
  const focused = useEngine((state) => state.focused);
  const hovered = useEngine((state) => state.hovered);
  const unfocus = useEngine((state) => state.unfocus);
  const lampOn = useEngine((state) => state.lampOn);
  const toggleLamp = useEngine((state) => state.toggleLamp);
  const muted = useEngine((state) => state.muted);
  const toggleMuted = useEngine((state) => state.toggleMuted);
  const controlled = useEngine((state) => state.controlled);
  const setControlled = useEngine((state) => state.setControlled);
  const nearby = useEngine((state) => state.nearby);
  const nearGuitar = useEngine((state) => state.nearGuitar);
  const musicOpen = useEngine((state) => state.musicOpen);
  const entered = useEngine((state) => state.entered);
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

  // Gated on `entered`, and that gate is the whole reason sound-on-by-default
  // works at all. Browsers refuse to start an AudioContext without a user
  // gesture; running this on mount would build the graph before anyone had
  // clicked anything, leave it suspended, and produce silence with a speaker
  // icon claiming otherwise. "Step inside" is a real click, so waiting for it
  // means the context starts allowed.
  useEffect(() => {
    if (!entered) return;
    roomAudio.setMuted(muted);
  }, [muted, entered]);

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
          {profile.availability}. Based in {profile.location} ({profile.timezone}). Email{' '}
          <a href={`mailto:${profile.email}`}>{profile.email}</a>.
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

      {/* Nothing but the door until the visitor has stepped in. Chrome over a
        loading screen is chrome over nothing. */}
      {!entered ? null : (
        <>
          {/* Hidden while driving, and on any narrow screen where it would
            run straight through the buttons either side of it. It is a hint
            about clicking; a visitor holding a stick is past needing it. */}
          {controlled ? null : (
            <p className="pointer-events-none absolute left-1/2 top-6 hidden -translate-x-1/2 text-center text-xs uppercase tracking-[0.25em] text-white/45 sm:block">
              {hovered ? (roomObjectById.get(hovered)?.hint ?? '') : 'Click anything in the room'}
            </p>
          )}

          {/* Top-left: the two ways in, and the way to ask what this is. */}
          {!focused ? (
            <div
              data-room-ui
              className={
                isTouch
                  ? 'absolute left-3 top-3 flex flex-col items-start gap-1.5'
                  : 'absolute left-4 top-4 flex flex-col items-start gap-2'
              }
            >
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setControlled(!controlled)}
                  aria-pressed={controlled}
                  className={
                    isTouch
                      ? 'pointer-events-auto rounded-full bg-black/55 px-3 py-1.5 text-[11px] font-medium text-white/75 backdrop-blur-md'
                      : 'pointer-events-auto rounded-full bg-black/55 px-3.5 py-2 text-xs font-medium text-white/70 backdrop-blur-md transition-colors hover:text-white'
                  }
                >
                  {controlled ? 'Stop walking' : 'Walk the room'}
                </button>
                {isTouch && controlled ? null : <GuideButton />}
              </div>
              {!controlled ? <RoomIndex /> : null}
            </div>
          ) : null}

          {/* The plan, only while driving: it answers "where am I and what is
            behind me", which is a question the follow camera creates and cannot
            itself answer. */}
          {controlled && !focused ? <Minimap /> : null}
          {controlled && !focused ? <FuelGauge /> : null}
          {controlled && !focused ? <GuitarMusic /> : null}

          {/* The key legend is a keyboard's legend, so it only appears where
            there is a keyboard. On touch the same information is the shape of
            the controls themselves — a stick is a stick — and the strip would
            sit exactly where the left thumb goes. */}
          {controlled && !focused && !isTouch ? (
            <p className="absolute bottom-24 left-1/2 -translate-x-1/2 rounded-full bg-black/55 px-4 py-2 text-xs text-white/75 backdrop-blur-md">
              {nearGuitar ? (
                <>
                  <kbd className="rounded bg-white/15 px-1.5 py-0.5 font-semibold">E</kbd>{' '}
                  {musicOpen ? 'close the guitar' : 'play the guitar'}
                </>
              ) : nearbyObject ? (
                <>
                  <kbd className="rounded bg-white/15 px-1.5 py-0.5 font-semibold">E</kbd> inspect{' '}
                  {nearbyObject.label.toLowerCase()}
                </>
              ) : (
                'W to move · A / D to turn · mouse to look · hold Space to fly · Esc to stop'
              )}
            </p>
          ) : null}

          <TouchControls />

          {!controlled ? <Guide /> : null}

          <SoundControl muted={muted} toggleMuted={toggleMuted} />
        </>
      )}

      {object ? (
        <div
          ref={panelRef}
          data-room-ui
          role="dialog"
          aria-modal="false"
          aria-labelledby="room-panel-title"
          tabIndex={-1}
          // `sm:bottom-auto`, for the same reason as the note panel: anchored
          // to both top and bottom, the box stretches to span the gap instead
          // of sizing to its content. Here it did not overflow — the item list
          // has its own max height — it just left a tall empty pool under the
          // text, which read as a panel that had failed to fill itself.
          className="pointer-events-auto absolute inset-x-3 bottom-3 mx-auto max-w-md rounded-xl border border-white/10 bg-black/75 p-4 text-white backdrop-blur-xl outline-none sm:inset-x-auto sm:bottom-auto sm:right-8 sm:top-1/2 sm:max-w-md sm:-translate-y-1/2 sm:rounded-2xl sm:p-5"
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
          <h2
            id="room-panel-title"
            className="mt-1.5 pr-6 font-display text-lg font-semibold sm:text-xl"
          >
            {object.panel.title}
          </h2>
          <p className="mt-2 text-[13px] leading-relaxed text-white/70 sm:text-sm">
            {object.panel.body}
          </p>

          {object.panel.items.length > 0 ? (
            <ul className="mt-3 max-h-[30vh] space-y-1.5 overflow-y-auto text-[13px] text-white/70 sm:max-h-[38vh] sm:text-sm">
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

          {object.panel.action === 'lamp' ? (
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
              className="mt-4 block text-sm font-medium text-sky-300 underline underline-offset-4 hover:text-sky-200"
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

/**
 * The one sound control, top right.
 *
 * This replaces a permanent mute button that sat in the corner doing one job.
 * The corner is the right place for sound and the wrong place for a switch
 * nobody touches: room tone is off by default, so for most visitors that
 * button was a speaker icon with a slash through it and nothing to say.
 *
 * What the corner is *for* is whatever is making noise. Once the guitar is
 * playing, the visitor has a real question — what is this, and how do I stop
 * it — and until now the only answer was to walk the robot back across the
 * room to the guitar and press E, because the track list is only reachable
 * from beside it. So while music is playing this becomes a transport: the
 * title, and a control that stops it. When nothing is playing it falls back to
 * the room-tone toggle, which still has to exist — a page that can make sound
 * with no visible way to silence it is a page people close.
 */
function SoundControl({ muted, toggleMuted }: { muted: boolean; toggleMuted: () => void }) {
  const [, force] = useReducer((n: number) => n + 1, 0);
  useEffect(() => subscribeMusic(force), []);

  const playing = musicState.playing;

  if (playing) {
    return (
      <div
        className={
          isTouch
            ? 'pointer-events-auto absolute right-3 top-3 flex items-center gap-1.5 rounded-full bg-black/60 py-1 pl-2.5 pr-1 backdrop-blur-md'
            : 'pointer-events-auto absolute right-4 top-4 flex items-center gap-2 rounded-full bg-black/60 py-1.5 pl-3 pr-1.5 backdrop-blur-md'
        }
      >
        {/* Three bars that only move while the audio does — the cheapest
          possible "this is the thing making the noise". */}
        <span className="flex h-3.5 items-end gap-0.5" aria-hidden="true">
          {[0, 1, 2].map((bar) => (
            <span
              key={bar}
              className="w-0.5 rounded-full bg-emerald-300"
              style={{
                height: '100%',
                animation: `room-eq 900ms ease-in-out ${bar * 140}ms infinite alternate`,
              }}
            />
          ))}
        </span>
        <span
          className={
            isTouch
              ? 'max-w-[5.5rem] truncate text-[11px] font-medium text-white/85'
              : 'max-w-[9rem] truncate text-xs font-medium text-white/85'
          }
        >
          {playing.title}
        </span>
        <button
          type="button"
          onClick={() => stopMusic()}
          className="rounded-full p-1.5 text-white/60 transition-colors hover:bg-white/10 hover:text-white"
          aria-label={`Stop ${playing.title}`}
        >
          <Square className="size-3.5" aria-hidden="true" />
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={toggleMuted}
      aria-pressed={!muted}
      className={
        isTouch
          ? 'pointer-events-auto absolute right-3 top-3 rounded-full bg-black/55 p-2 text-white/70 backdrop-blur-md'
          : 'pointer-events-auto absolute right-4 top-4 rounded-full bg-black/55 p-2.5 text-white/70 backdrop-blur-md transition-colors hover:text-white'
      }
      aria-label={muted ? 'Turn room sound on' : 'Turn room sound off'}
    >
      {muted ? (
        <VolumeX className="size-4" aria-hidden="true" />
      ) : (
        <Volume2 className="size-4" aria-hidden="true" />
      )}
    </button>
  );
}

/**
 * The thruster gauge.
 *
 * Driven straight from `characterState` on an animation frame rather than
 * through React: fuel changes every frame, and a store value that re-renders
 * the overlay sixty times a second would cost more than the whole flight
 * system. The bar writes its own width and colour and nothing above it
 * re-renders at all.
 */
function FuelGauge() {
  const fill = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let frame = 0;
    const tick = () => {
      const bar = fill.current;
      if (bar) {
        const fuel = characterState.fuel;
        bar.style.width = `${Math.max(0, Math.min(1, fuel)) * 100}%`;
        // Amber under a third, so running dry is something you see coming
        // rather than something that happens to you.
        bar.style.backgroundColor = fuel < 0.34 ? '#ffb648' : '#2ff5c8';
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div
      className={
        isTouch
          ? 'absolute bottom-4 left-1/2 -translate-x-1/2'
          : 'absolute bottom-32 left-1/2 -translate-x-1/2'
      }
    >
      <div className="h-1 w-32 overflow-hidden rounded-full bg-white/15">
        <div ref={fill} className="h-full rounded-full transition-colors duration-200" />
      </div>
    </div>
  );
}

/**
 * The guitar's track list.
 *
 * Deliberately not a web modal: no backdrop, no dimming, no dialog. It is a
 * small lit panel that sits low in the frame like something propped against
 * the guitar, in the same typography and the same glass as the rest of the
 * room's furniture, and the world keeps moving behind it — the robot can
 * still be flown while it is open, which is the whole difference between a
 * diegetic control and a settings screen.
 *
 * The track list is whatever `public/music/music-manifest.json` says, so
 * this component never learns a song's name.
 */
function GuitarMusic() {
  const open = useEngine((state) => state.musicOpen);
  const setMusicOpen = useEngine((state) => state.setMusicOpen);
  const [, force] = useReducer((n: number) => n + 1, 0);
  const [blocked, setBlocked] = useState(false);

  useEffect(() => subscribeMusic(force), []);
  useEffect(() => {
    if (musicState.loading) void loadTracks();
  }, []);

  const choose = async (track: Track) => {
    if (isPlaying(track)) {
      stopMusic();
      return;
    }
    setBlocked(!(await playTrack(track)));
  };

  if (!open) return null;

  return (
    <div className="pointer-events-auto absolute bottom-36 left-1/2 w-72 -translate-x-1/2 rounded-2xl border border-white/10 bg-black/70 p-4 backdrop-blur-md">
      <p className="mb-3 text-[0.65rem] uppercase tracking-[0.25em] text-emerald-300/80">
        The guitar
      </p>
      {musicState.tracks.length === 0 ? (
        <p className="text-xs text-white/50">
          {musicState.loading ? 'Looking for tracks…' : 'No tracks in /public/music yet.'}
        </p>
      ) : (
        <ul className="space-y-1">
          {musicState.tracks.slice(0, 5).map((track) => {
            const live = isPlaying(track);
            return (
              <li key={track.file}>
                <button
                  type="button"
                  onClick={() => void choose(track)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors',
                    live ? 'bg-emerald-400/15 text-emerald-200' : 'text-white/70 hover:bg-white/10'
                  )}
                >
                  <span className="w-3 shrink-0 text-emerald-300">{live ? '▶' : ''}</span>
                  <span className="truncate">{track.title}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {blocked ? (
        <p className="mt-2 text-[0.7rem] text-amber-300/80">
          The browser blocked playback — click once anywhere, then choose again.
        </p>
      ) : null}
      <button
        type="button"
        onClick={() => setMusicOpen(false)}
        className="mt-3 text-[0.7rem] text-white/40 transition-colors hover:text-white/70"
      >
        E or Esc to close · music keeps playing
      </button>
    </div>
  );
}

/**
 * The room's music, as a small player the guitar drives.
 *
 * Data-driven on purpose: the track list is fetched from
 * `/music/music-manifest.json` at runtime, so adding a song is one line of
 * JSON and a file in `public/music/` — the interaction code never learns
 * their names. Static hosting cannot enumerate a directory, which is the
 * only reason a manifest exists rather than true discovery.
 *
 * One `Audio` element rather than the WebAudio graph the room's effects use.
 * Background music wants exactly two things this gives for free — streaming
 * so a four-megabyte file starts before it has finished downloading, and a
 * `loop` flag — and none of what a graph is for. Fades are done on `volume`
 * on a timer, which is inaudible from a graph's own ramp at this length.
 */

export interface Track {
  title: string;
  file: string;
}

const FADE_MS = 900;
/** Background, not foreground: the room's own sounds have to survive it. */
const LEVEL = 0.34;

let element: HTMLAudioElement | null = null;
let fade: number | null = null;
let current: Track | null = null;
const listeners = new Set<() => void>();

/** What the UI reads. Mutated in place; `subscribe` announces the change. */
export const musicState = {
  tracks: [] as Track[],
  playing: null as Track | null,
  loading: true,
};

function announce() {
  for (const listener of listeners) listener();
}

export function subscribeMusic(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Loads the manifest once. Failure is quiet: a room with no music is a room. */
export async function loadTracks(): Promise<void> {
  try {
    const response = await fetch('/music/music-manifest.json');
    if (!response.ok) throw new Error('no manifest');
    const data = (await response.json()) as { tracks?: Track[] };
    musicState.tracks = (data.tracks ?? []).filter((t) => t.file && t.title);
  } catch {
    musicState.tracks = [];
  }
  musicState.loading = false;
  announce();
}

function ramp(to: number, whenDone?: () => void) {
  if (fade !== null) window.clearInterval(fade);
  const audio = element;
  if (!audio) return;
  const from = audio.volume;
  const start = performance.now();
  fade = window.setInterval(() => {
    const t = Math.min(1, (performance.now() - start) / FADE_MS);
    audio.volume = from + (to - from) * t;
    if (t >= 1) {
      if (fade !== null) window.clearInterval(fade);
      fade = null;
      whenDone?.();
    }
  }, 33);
}

/**
 * Start a track, fading out whatever is playing first.
 *
 * Returns whether playback actually began: browsers refuse audio that no
 * gesture asked for, and the caller needs to know rather than showing a
 * "now playing" for silence.
 */
export async function playTrack(track: Track): Promise<boolean> {
  if (!element) {
    element = new Audio();
    element.loop = true;
    element.preload = 'auto';
  }
  const audio = element;

  if (current && audio.src && !audio.paused) {
    await new Promise<void>((resolve) => ramp(0, resolve));
  }

  audio.src = track.file;
  audio.volume = 0;
  try {
    await audio.play();
  } catch {
    return false;
  }
  current = track;
  musicState.playing = track;
  announce();
  ramp(LEVEL);
  return true;
}

/** Fade out and stop. The selection is forgotten; the room goes quiet. */
export function stopMusic(): void {
  if (!element || element.paused) return;
  ramp(0, () => {
    element?.pause();
    current = null;
    musicState.playing = null;
    announce();
  });
}

export function isPlaying(track: Track): boolean {
  return musicState.playing?.file === track.file;
}

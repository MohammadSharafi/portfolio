import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ObjectId } from '../data/objects';

/**
 * The engine's single source of truth.
 *
 * Every manager reads and writes here rather than talking to each other, so a
 * new system — audio, achievements, a minigame — plugs in by subscribing rather
 * than by threading props through the scene graph. Nothing in the R3F tree owns
 * interaction state, which is what keeps the object components small enough to
 * stay readable.
 */

export type Phase = 'loading' | 'intro' | 'exploring' | 'focused';

interface SaveState {
  /** Object ids the visitor has opened at least once, across sessions. */
  discovered: ObjectId[];
  /** Easter eggs found. Kept separate so clearing one does not clear the other. */
  secrets: string[];
  visits: number;
}

interface EngineState extends SaveState {
  phase: Phase;
  /** The object the camera is currently pushed in on, if any. */
  focused: ObjectId | null;
  /** The object under the pointer. Drives the cursor and the hover label. */
  hovered: ObjectId | null;
  /** Desk lamp, which genuinely changes the room's lighting. */
  lampOn: boolean;
  /** Drives the window's outside world and the room's ambient colour. */
  timeOfDay: 'day' | 'dusk' | 'night';
  muted: boolean;
  /** Set once the asset manager reports everything resolved. */
  progress: number;

  setPhase: (phase: Phase) => void;
  focus: (id: ObjectId) => void;
  unfocus: () => void;
  hover: (id: ObjectId | null) => void;
  toggleLamp: () => void;
  cycleTime: () => void;
  toggleMuted: () => void;
  setProgress: (value: number) => void;
  discover: (id: ObjectId) => void;
  findSecret: (id: string) => void;
  resetSave: () => void;
}

const TIMES: Array<EngineState['timeOfDay']> = ['night', 'day', 'dusk'];

export const useEngine = create<EngineState>()(
  persist(
    (set, get) => ({
      discovered: [],
      secrets: [],
      visits: 0,

      phase: 'loading',
      focused: null,
      hovered: null,
      lampOn: true,
      timeOfDay: 'night',
      muted: true,
      progress: 0,

      setPhase: (phase) => set({ phase }),

      focus: (id) => {
        const { discovered } = get();
        set({
          focused: id,
          phase: 'focused',
          hovered: null,
          discovered: discovered.includes(id) ? discovered : [...discovered, id],
        });
      },

      unfocus: () => set({ focused: null, phase: 'exploring' }),
      hover: (id) => set({ hovered: id }),
      toggleLamp: () => set({ lampOn: !get().lampOn }),
      cycleTime: () => {
        const next = TIMES[(TIMES.indexOf(get().timeOfDay) + 1) % TIMES.length];
        set({ timeOfDay: next ?? 'night' });
      },

      toggleMuted: () => set({ muted: !get().muted }),
      setProgress: (progress) => set({ progress }),

      discover: (id) => {
        const { discovered } = get();
        if (!discovered.includes(id)) set({ discovered: [...discovered, id] });
      },

      findSecret: (id) => {
        const { secrets } = get();
        if (!secrets.includes(id)) set({ secrets: [...secrets, id] });
      },

      resetSave: () => set({ discovered: [], secrets: [], visits: 0 }),
    }),
    {
      name: 'room-save-v1',
      // Only the save state survives a reload. Persisting `focused` or `phase`
      // would drop a returning visitor into a camera push-in with no memory of
      // how they got there.
      partialize: (state) => ({
        discovered: state.discovered,
        secrets: state.secrets,
        visits: state.visits,
        lampOn: state.lampOn,
        timeOfDay: state.timeOfDay,
        muted: state.muted,
      }),
    }
  )
);

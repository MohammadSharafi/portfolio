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
  /** True while the visitor is driving the desk robot. */
  controlled: boolean;
  /** The interactable the robot is standing next to, if any. */
  nearby: ObjectId | null;
  /** True while the robot is within reach of the guitar. */
  nearGuitar: boolean;
  /** True while the guitar's track list is open. */
  musicOpen: boolean;
  /** True while the room index (the list of everything there is to find) is
   *  open. Replaces the old bottom rail, which spent a permanent strip of the
   *  frame on fifteen buttons a visitor reads once. */
  indexOpen: boolean;
  /** True while the note composer is open. */
  messageOpen: boolean;
  /** How much of the guide the visitor has been through. `null` means they
   *  have never seen it; a number is the step they reached. Persisted, so a
   *  returning visitor is not taught the controls again. */
  guideStep: number | null;
  /** True once the room has finished loading and been dismissed into. */
  entered: boolean;
  /** Drives the window's outside world and the room's ambient colour. */
  timeOfDay: 'day' | 'dusk' | 'night';
  muted: boolean;
  /** Set once the asset manager reports everything resolved. */
  progress: number;

  setPhase: (phase: Phase) => void;
  setControlled: (value: boolean) => void;
  setNearby: (id: ObjectId | null) => void;
  setNearGuitar: (value: boolean) => void;
  setMusicOpen: (value: boolean) => void;
  setIndexOpen: (value: boolean) => void;
  setMessageOpen: (value: boolean) => void;
  setGuideStep: (value: number | null) => void;
  enter: () => void;
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
      controlled: false,
      nearby: null,
      nearGuitar: false,
      musicOpen: false,
      indexOpen: false,
      messageOpen: false,
      guideStep: null,
      entered: false,
      timeOfDay: 'night',
      muted: true,
      progress: 0,

      setPhase: (phase) => set({ phase }),

      setControlled: (value) => set({ controlled: value, nearby: value ? get().nearby : null }),
      setNearby: (id) => {
        if (get().nearby !== id) set({ nearby: id });
      },
      setNearGuitar: (value) => {
        if (get().nearGuitar !== value)
          set({ nearGuitar: value, musicOpen: value && get().musicOpen });
      },
      setMusicOpen: (value) => set({ musicOpen: value }),
      setIndexOpen: (value) => set({ indexOpen: value }),
      setMessageOpen: (value) => set({ messageOpen: value }),
      setGuideStep: (value) => set({ guideStep: value }),

      // Entering counts a visit. Doing it here rather than on mount means the
      // number tracks people who actually went in, not tabs that were opened
      // and closed while the room was still loading.
      enter: () => set({ entered: true, phase: 'exploring', visits: get().visits + 1 }),

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
        // Persisted so a returning visitor is not walked through the controls
        // a second time. It is the one piece of onboarding state worth keeping.
        guideStep: state.guideStep,
      }),
    }
  )
);

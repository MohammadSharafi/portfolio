/**
 * Audio manager.
 *
 * Every sound here is synthesised in the Web Audio graph rather than fetched.
 * A set of room samples is a megabyte or two of downloads for something most
 * visitors never turn on, and this site has shipped with zero third-party
 * requests since the rebuild — a CDN full of clicks and hums would be the first
 * thing to break that. Noise bursts through a filter get within a hair of a
 * recorded keyswitch at a fraction of the cost.
 *
 * Nothing is created until the visitor actually asks for sound. Browsers refuse
 * to start an AudioContext without a gesture anyway, and constructing one on
 * load just to leave it suspended wastes a thread on every page view.
 */

export type Cue = 'key' | 'knock' | 'switch' | 'lid' | 'open' | 'step' | 'land';

class RoomAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private fan: { source: AudioBufferSourceNode; gain: GainNode } | null = null;
  private noise: AudioBuffer | null = null;
  /** The thruster: one continuous voice whose level is driven by the flight
   *  system, rather than a cue fired repeatedly. */
  private thrust: {
    source: AudioBufferSourceNode;
    gain: GainNode;
    filter: BiquadFilterNode;
    tone: OscillatorNode;
    toneGain: GainNode;
  } | null = null;

  /** Lazily builds the graph. Safe to call repeatedly. */
  private ensure(): AudioContext | null {
    if (this.ctx) return this.ctx;
    if (typeof window === 'undefined') return null;

    const Ctor =
      window.AudioContext ??
      (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;

    const ctx = new Ctor();
    const master = ctx.createGain();
    master.gain.value = 0.0001;
    master.connect(ctx.destination);

    // One second of white noise, reused by every percussive cue. Generating it
    // per hit would allocate a buffer on the audio thread for each keypress.
    const noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;

    this.ctx = ctx;
    this.master = master;
    this.noise = noise;
    return ctx;
  }

  setMuted(muted: boolean) {
    const ctx = muted ? this.ctx : this.ensure();
    if (!ctx || !this.master) return;

    if (!muted && ctx.state === 'suspended') void ctx.resume();
    // Ramped, not switched: a gain step from 0 to 1 is an audible click in
    // itself, which is a poor first impression for a mute button.
    this.master.gain.cancelScheduledValues(ctx.currentTime);
    this.master.gain.setTargetAtTime(muted ? 0.0001 : 0.6, ctx.currentTime, 0.05);

    if (muted) this.stopFan();
    else this.startFan();
  }

  /** The tower's fan: filtered noise, quiet, always there once sound is on. */
  private startFan() {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noise || this.fan) return;

    const source = ctx.createBufferSource();
    source.buffer = this.noise;
    source.loop = true;

    const band = ctx.createBiquadFilter();
    band.type = 'lowpass';
    band.frequency.value = 320;
    band.Q.value = 0.7;

    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.gain.setTargetAtTime(0.045, ctx.currentTime, 1.2);

    source.connect(band).connect(gain).connect(this.master);
    source.start();
    this.fan = { source, gain };
  }

  private stopFan() {
    if (!this.fan || !this.ctx) return;
    const { source, gain } = this.fan;
    gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.2);
    window.setTimeout(() => source.stop(), 600);
    this.fan = null;
  }

  play(cue: Cue) {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noise || this.master.gain.value < 0.01) return;

    const now = ctx.currentTime;
    const source = ctx.createBufferSource();
    source.buffer = this.noise;

    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    source.connect(filter).connect(gain).connect(this.master);

    // Each cue is the same noise burst shaped differently: a keyswitch is
    // bright and instant, a mug on wood is duller and rings a little longer.
    const shape: Record<
      Cue,
      { type: BiquadFilterType; freq: number; peak: number; decay: number }
    > = {
      key: { type: 'bandpass', freq: 2600, peak: 0.5, decay: 0.035 },
      knock: { type: 'lowpass', freq: 900, peak: 0.7, decay: 0.14 },
      switch: { type: 'bandpass', freq: 1500, peak: 0.55, decay: 0.05 },
      lid: { type: 'lowpass', freq: 480, peak: 0.35, decay: 0.3 },
      open: { type: 'bandpass', freq: 700, peak: 0.3, decay: 0.22 },
      // A 12 cm machine on floorboards. Small, light and hard — high and very
      // short, nothing like a boot. The pitch is jittered on every hit in
      // `play`, because two identical footsteps in a row is the single most
      // recognisable tell of a game with three footstep samples.
      step: { type: 'bandpass', freq: 1700, peak: 0.16, decay: 0.045 },
      // Both feet at once plus the weight behind them: lower, louder, longer.
      land: { type: 'lowpass', freq: 620, peak: 0.4, decay: 0.16 },
    };

    const { type, freq, peak, decay } = shape[cue];
    filter.type = type;
    // Footsteps get a random ±12% on the filter, which is what stops a walk
    // cycle sounding like a metronome. Everything else is a discrete event the
    // ear does not compare against its neighbour.
    filter.frequency.value = cue === 'step' ? freq * (0.88 + Math.random() * 0.24) : freq;
    filter.Q.value = cue === 'knock' ? 0.8 : 2.4;

    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(peak, now + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + decay);

    // Offset into the buffer so repeated hits are not identical samples, which
    // is what makes a keyboard sound like a machine gun rather than a keyboard.
    source.start(now, Math.random() * 0.5, decay + 0.05);
  }

  /**
   * The thrusters, as one continuous voice.
   *
   * Deliberately not a cue fired every frame. A jet is a *sustained* sound
   * whose character changes with throttle, and retriggering a burst at 60 Hz
   * produces a buzz at 60 Hz — the rate becomes the pitch, which is the
   * classic way engine audio gives itself away.
   *
   * Two layers, because filtered noise alone reads as wind rather than as a
   * machine: a band of noise for the roar, and a low sawtooth for the body of
   * it. Both are started once and left running at zero gain; `setThrust`
   * only moves gains and frequencies, so there is no allocation on the audio
   * thread while flying.
   *
   * `level` is 0 to 1 — the flight system's own throttle.
   */
  setThrust(level: number) {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noise) return;
    const amount = Math.max(0, Math.min(1, level));

    if (!this.thrust) {
      // Nothing to start up for silence; wait until the thrusters first light.
      if (amount <= 0.001) return;

      const source = ctx.createBufferSource();
      source.buffer = this.noise;
      source.loop = true;

      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 620;
      filter.Q.value = 0.9;

      const gain = ctx.createGain();
      gain.gain.value = 0;

      const tone = ctx.createOscillator();
      tone.type = 'sawtooth';
      tone.frequency.value = 92;
      const toneGain = ctx.createGain();
      toneGain.gain.value = 0;

      source.connect(filter).connect(gain).connect(this.master);
      tone.connect(toneGain).connect(this.master);
      source.start();
      tone.start();

      this.thrust = { source, gain, filter, tone, toneGain };
    }

    const { gain, filter, tone, toneGain } = this.thrust;
    const now = ctx.currentTime;
    // Short time constants: a thruster has to feel wired to the key, and the
    // ear reads any lag here as the sound belonging to something else.
    gain.gain.setTargetAtTime(amount * 0.075, now, 0.05);
    toneGain.gain.setTargetAtTime(amount * 0.022, now, 0.05);
    // Opening the band and lifting the fundamental with throttle is what makes
    // it read as *more* thrust rather than merely louder thrust.
    filter.frequency.setTargetAtTime(520 + amount * 700, now, 0.08);
    tone.frequency.setTargetAtTime(78 + amount * 46, now, 0.08);
  }

  dispose() {
    this.stopFan();
    if (this.thrust) {
      this.thrust.source.stop();
      this.thrust.tone.stop();
      this.thrust = null;
    }
    void this.ctx?.close();
    this.ctx = null;
    this.master = null;
    this.noise = null;
  }
}

export const roomAudio = new RoomAudio();

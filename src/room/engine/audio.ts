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

export type Cue = 'key' | 'knock' | 'switch' | 'lid' | 'open';

class RoomAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private fan: { source: AudioBufferSourceNode; gain: GainNode } | null = null;
  private noise: AudioBuffer | null = null;

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
    };

    const { type, freq, peak, decay } = shape[cue];
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = cue === 'knock' ? 0.8 : 2.4;

    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(peak, now + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + decay);

    // Offset into the buffer so repeated hits are not identical samples, which
    // is what makes a keyboard sound like a machine gun rather than a keyboard.
    source.start(now, Math.random() * 0.5, decay + 0.05);
  }

  dispose() {
    this.stopFan();
    void this.ctx?.close();
    this.ctx = null;
    this.master = null;
    this.noise = null;
  }
}

export const roomAudio = new RoomAudio();

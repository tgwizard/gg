/**
 * Sound effects, synthesized with the Web Audio API: no files to load or license, and
 * each sound is a few soft tones or a shaped puff of noise, easy to tune. They're quiet
 * on purpose. On by default; the speaker in the top bar (or Settings) turns them off,
 * remembered per browser. Browsers only allow sound once the page has been clicked or
 * typed into, so anything before that is silently skipped.
 *
 * While the tab is in the background only `turn` plays, as a nudge that you're up.
 */
import { useSyncExternalStore } from "react";

export type Sfx =
  /** It's your turn. */
  | "turn"
  /** A card slid or dealt. */
  | "card"
  /** A card turned over. */
  | "flip"
  /** Chips clinking. */
  | "chip"
  /** A piece set down on a board. */
  | "place"
  /** A Go stone clacked down on wood. */
  | "stone"
  /** A disc dropping into a slot and landing with a little bounce (Four in a Row). */
  | "drop"
  /** A piece taking another. */
  | "capture"
  /** Check, or something pointed at you. */
  | "check"
  /** Something dropped in water (Finns i sjön, a Battleship miss). */
  | "splash"
  /** A heavy hit (Battleship). */
  | "hit"
  /** Going under. */
  | "sink"
  /** Knuckles on the table (checking in poker). */
  | "knock"
  /** A run of train cars set down. */
  | "claim"
  /** A cannon firing (a soft thump). */
  | "cannon"
  /** A cannonball bursting on the ground. */
  | "boom"
  /** A heartbeat: your time is nearly up. */
  | "heartbeat"
  /** Something done well (a book, a ticket). */
  | "good"
  | "win"
  | "lose";

export const SFX: Sfx[] = ["turn", "card", "flip", "chip", "place", "stone", "drop", "capture", "check", "splash", "hit", "sink", "knock", "claim", "cannon", "boom", "heartbeat", "good", "win", "lose"];

const KEY = "gg.sound";
const VOLUME = 0.18;
const listeners = new Set<() => void>();
let on = stored();
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuffer: AudioBuffer | null = null;

function stored(): boolean {
  try {
    return localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}

export function soundOn() {
  return on;
}

export function setSoundOn(value: boolean) {
  on = value;
  try {
    localStorage.setItem(KEY, value ? "on" : "off");
  } catch {
    // Not remembered; fine.
  }
  for (const l of listeners) l();
  if (value) play("good");
}

export function useSoundOn(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => on,
  );
}

/** The audio graph, made on first use; null when the browser won't play yet. */
function audio(): AudioContext | null {
  if (typeof AudioContext === "undefined") return null;
  if (!ctx) {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = VOLUME;
    // A gentle limiter, so several sounds at once don't clip.
    const limit = ctx.createDynamicsCompressor();
    limit.threshold.value = -12;
    master.connect(limit).connect(ctx.destination);
    noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx.state === "running" ? ctx : null;
}

// Sound only after a click or key, as browsers require; this wakes the context then.
if (typeof window !== "undefined") {
  const wake = () => {
    if (on) audio();
  };
  window.addEventListener("pointerdown", wake, { capture: true });
  window.addEventListener("keydown", wake, { capture: true });
}

/** A tone with a soft attack and an exponential fade, optionally gliding in pitch. */
function tone(a: AudioContext, at: number, freq: number, length: number, opts: { type?: OscillatorType; gain?: number; to?: number; attack?: number } = {}) {
  const osc = a.createOscillator();
  const env = a.createGain();
  osc.type = opts.type ?? "sine";
  osc.frequency.setValueAtTime(freq, at);
  if (opts.to) osc.frequency.exponentialRampToValueAtTime(opts.to, at + length);
  const peak = opts.gain ?? 0.5;
  env.gain.setValueAtTime(0.0001, at);
  env.gain.exponentialRampToValueAtTime(peak, at + (opts.attack ?? 0.005));
  env.gain.exponentialRampToValueAtTime(0.0001, at + length);
  osc.connect(env).connect(master!);
  osc.start(at);
  osc.stop(at + length + 0.02);
}

/** A puff of filtered noise: paper, felt, water. */
function noise(a: AudioContext, at: number, length: number, opts: { freq: number; to?: number; q?: number; type?: BiquadFilterType; gain?: number; attack?: number }) {
  const src = a.createBufferSource();
  src.buffer = noiseBuffer;
  src.playbackRate.value = 0.8 + Math.random() * 0.4;
  const filter = a.createBiquadFilter();
  filter.type = opts.type ?? "bandpass";
  filter.Q.value = opts.q ?? 1;
  filter.frequency.setValueAtTime(opts.freq, at);
  if (opts.to) filter.frequency.exponentialRampToValueAtTime(opts.to, at + length);
  const env = a.createGain();
  env.gain.setValueAtTime(0.0001, at);
  env.gain.exponentialRampToValueAtTime(opts.gain ?? 0.5, at + (opts.attack ?? 0.004));
  env.gain.exponentialRampToValueAtTime(0.0001, at + length);
  src.connect(filter).connect(env).connect(master!);
  src.start(at, Math.random() * 0.5);
  src.stop(at + length + 0.02);
}

/** A little randomness, so repeats don't sound mechanical. */
const vary = (x: number, by = 0.04) => x * (1 + (Math.random() * 2 - 1) * by);

// Soft and round on purpose: sines and gently filtered noise, low in pitch, short.
const SOUNDS: Record<Sfx, (a: AudioContext, t: number) => void> = {
  turn(a, t) {
    // Two mellow notes, a fifth apart, with a slow fade.
    tone(a, t, 523.25, 0.7, { gain: 0.22, attack: 0.02 });
    tone(a, t + 0.13, 783.99, 0.9, { gain: 0.18, attack: 0.02 });
  },
  card(a, t) {
    // A soft brush of felt, not a hiss.
    noise(a, t, 0.06, { freq: vary(900, 0.1), q: 0.6, type: "lowpass", gain: 0.22, attack: 0.008 });
  },
  flip(a, t) {
    noise(a, t, 0.07, { freq: 700, to: 1600, q: 0.7, type: "lowpass", gain: 0.2, attack: 0.008 });
  },
  chip(a, t) {
    tone(a, t, vary(1500), 0.07, { gain: 0.06, attack: 0.003 });
    tone(a, t + 0.04, vary(1900), 0.06, { gain: 0.04, attack: 0.003 });
  },
  place(a, t) {
    tone(a, t, vary(190), 0.08, { to: 130, gain: 0.32, attack: 0.003 });
  },
  stone(a, t) {
    // A short hard click over a little body of wood.
    tone(a, t, vary(2400, 0.06), 0.025, { gain: 0.07, attack: 0.001 });
    tone(a, t, vary(330), 0.07, { to: 210, gain: 0.26, attack: 0.002 });
  },
  drop(a, t) {
    // A wooden disc landing in its slot: a knock with a bright edge, then a smaller one as it settles from the bounce.
    tone(a, t, vary(1700, 0.06), 0.03, { gain: 0.06, attack: 0.001 });
    tone(a, t, vary(260), 0.09, { to: 170, gain: 0.3, attack: 0.002 });
    tone(a, t + 0.11, vary(300), 0.05, { to: 210, gain: 0.1, attack: 0.002 });
  },
  capture(a, t) {
    tone(a, t, vary(200), 0.09, { to: 120, gain: 0.34, attack: 0.003 });
    tone(a, t + 0.07, vary(160), 0.08, { to: 110, gain: 0.22, attack: 0.003 });
  },
  check(a, t) {
    tone(a, t, 440, 0.3, { gain: 0.1, attack: 0.02 });
  },
  splash(a, t) {
    noise(a, t, 0.35, { freq: 1400, to: 250, q: 0.5, type: "lowpass", gain: 0.22, attack: 0.03 });
  },
  hit(a, t) {
    tone(a, t, 95, 0.3, { to: 50, gain: 0.4, attack: 0.005 });
  },
  sink(a, t) {
    tone(a, t, 80, 0.6, { to: 38, gain: 0.38, attack: 0.01 });
    noise(a, t + 0.05, 0.6, { freq: 500, to: 120, type: "lowpass", gain: 0.12, attack: 0.08 });
  },
  knock(a, t) {
    for (const i of [0, 1]) tone(a, t + i * 0.12, vary(150), 0.06, { to: 100, gain: 0.25, attack: 0.003 });
  },
  claim(a, t) {
    for (let i = 0; i < 3; i++) tone(a, t + i * 0.08, vary(220, 0.06), 0.06, { to: 150, gain: 0.18, attack: 0.003 });
  },
  cannon(a, t) {
    // A muffled thump and a short puff, like a toy cannon: low, round, quick to fade.
    tone(a, t, vary(120), 0.22, { to: 55, gain: 0.3, attack: 0.004 });
    noise(a, t, 0.25, { freq: 700, to: 180, q: 0.6, type: "lowpass", gain: 0.14, attack: 0.006 });
  },
  boom(a, t) {
    // A soft, distant crump: a low tone under a puff of dark noise.
    tone(a, t, vary(75), 0.4, { to: 40, gain: 0.28, attack: 0.008 });
    noise(a, t + 0.01, 0.45, { freq: 420, to: 90, q: 0.5, type: "lowpass", gain: 0.16, attack: 0.02 });
  },
  heartbeat(a, t) {
    // Lub-dub: two low thumps, the second softer, with a little overtone so laptop speakers carry it.
    tone(a, t, 95, 0.14, { to: 58, gain: 0.5, attack: 0.008 });
    tone(a, t, 190, 0.1, { to: 120, gain: 0.1, attack: 0.008 });
    tone(a, t + 0.22, 82, 0.12, { to: 54, gain: 0.36, attack: 0.008 });
    tone(a, t + 0.22, 164, 0.08, { to: 110, gain: 0.07, attack: 0.008 });
  },
  good(a, t) {
    tone(a, t, 659.25, 0.45, { gain: 0.12, attack: 0.015 });
    tone(a, t + 0.09, 880, 0.55, { gain: 0.1, attack: 0.015 });
  },
  win(a, t) {
    for (const [i, f] of [392, 523.25, 659.25, 783.99].entries()) tone(a, t + i * 0.12, f, 0.9, { gain: 0.14, attack: 0.02 });
  },
  lose(a, t) {
    tone(a, t, 392, 0.6, { gain: 0.1, attack: 0.02 });
    tone(a, t + 0.2, 329.63, 0.8, { gain: 0.09, attack: 0.02 });
  },
};

/** Play a sound now, or `delay` seconds from now (if sound is on and the browser lets us). */
export function play(sfx: Sfx, delay = 0) {
  if (!on || (document.hidden && sfx !== "turn")) return;
  const a = audio();
  if (!a) return;
  SOUNDS[sfx](a, a.currentTime + 0.01 + Math.max(0, delay));
}

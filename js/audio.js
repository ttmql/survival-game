/* Procedural chiptune score and combat sound effects.
   Everything is synthesized at runtime; the only external sound is the
   required Music/chicken.wav used for creature hurt cries. */
(function () {
  "use strict";

  const A = 220;
  // Convert a MIDI note number to a frequency (A440 is MIDI 69).
  const midi = (note) => A * Math.pow(2, (note - 69) / 12);

  // Chord tones expressed as semitone offsets from a root.
  const major7 = [0, 4, 7, 11];
  const minor7 = [0, 3, 7, 10];
  const dominant7 = [0, 4, 7, 10];

  // Each track is a 32/64-step loop: melody/harmony/bass/arp are MIDI note
  // arrays (null = rest), `counter`/`sparkle` are optional extra voices,
  // and `drums` picks a percussion pattern. Tempo is BPM of eighth notes.
  const TRACKS = Object.freeze({
    day1: Object.freeze({
      tempo: 122,
      wave: "triangle",
      instrument: "marimba",
      volume: 0.12,
      swing: 0.06,
      length: 64,
      chords: [
        { root: 48, tones: major7 },
        { root: 45, tones: dominant7 },
        { root: 50, tones: minor7 },
        { root: 43, tones: dominant7 },
        { root: 48, tones: major7 },
        { root: 45, tones: dominant7 },
        { root: 50, tones: minor7 },
        { root: 43, tones: dominant7 },
      ],
      melody: [
        72, 76, 79, 76, 74, 72, 76, null,
        69, 72, 76, 79, 77, 76, 74, 72,
        72, 76, 79, 84, 83, 79, 76, 74,
        72, 74, 76, 79, 76, 74, 72, null,
        67, 71, 74, 71, 72, 76, 79, 76,
        77, 81, 84, 81, 79, 77, 76, 74,
        72, 76, 79, 76, 74, 72, 69, 72,
        74, 76, 77, 79, 81, 79, 76, 72,
      ],
      harmony: [
        64, null, 67, null, 60, 64, 67, null,
        57, null, 60, 64, 65, 64, 62, null,
        64, null, 67, null, 71, 67, 64, null,
        64, 67, 69, null, 67, 64, 60, null,
        60, null, 64, null, 67, 64, 59, null,
        65, null, 69, 72, 69, 65, 62, null,
        64, null, 67, null, 62, 60, 57, null,
        62, 65, 69, 72, 69, 65, 60, null,
      ],
      bass: [
        36, null, 43, null, 36, null, 43, null,
        33, null, 40, null, 33, null, 40, null,
        38, null, 45, null, 38, null, 45, null,
        31, null, 38, null, 31, null, 43, null,
        36, null, 43, null, 36, null, 43, null,
        33, null, 40, null, 33, null, 40, null,
        38, null, 45, null, 38, null, 45, null,
        31, null, 38, null, 43, null, 43, null,
      ],
      arp: [
        60, 64, 67, 72, 64, 67, 72, 76,
        57, 60, 64, 69, 60, 64, 69, 72,
        62, 65, 69, 74, 65, 69, 74, 77,
        55, 59, 62, 67, 59, 62, 67, 71,
        60, 64, 67, 72, 64, 67, 72, 76,
        57, 60, 64, 69, 64, 69, 72, 76,
        62, 65, 69, 74, 69, 74, 77, 81,
        55, 59, 62, 67, 62, 67, 71, 74,
      ],
      counter: [
        null, 60, null, 64, null, 67, null, 64,
        null, 57, null, 60, null, 64, null, 60,
        null, 62, null, 65, null, 69, null, 65,
        null, 55, null, 59, null, 62, null, 59,
        null, 60, null, 64, null, 67, null, 64,
        null, 57, null, 60, null, 64, null, 60,
        null, 62, null, 65, null, 69, null, 65,
        null, 55, null, 59, null, 62, null, 67,
      ],
      sparkle: [
        null, null, 84, null, null, null, 88, null,
        null, null, 81, null, null, null, 84, null,
        null, null, 86, null, null, null, 89, null,
        null, null, 79, null, null, null, 84, null,
        null, null, 84, null, null, null, 88, null,
        null, null, 81, null, null, null, 84, null,
        null, null, 86, null, null, null, 89, null,
        null, null, 79, null, null, null, 84, null,
      ],
      counterInstrument: "mallet",
      sparkleInstrument: "bell",
      drums: "cartoon",
    }),
    day2: Object.freeze({
      tempo: 108,
      wave: "square",
      instrument: "synth",
      volume: 0.11,
      swing: 0,
      length: 64,
      chords: [
        { root: 48, tones: major7 },
        { root: 43, tones: major7 },
        { root: 45, tones: minor7 },
        { root: 41, tones: major7 },
        { root: 48, tones: major7 },
        { root: 43, tones: major7 },
        { root: 45, tones: minor7 },
        { root: 41, tones: major7 },
      ],
      melody: [
        76, 76, 79, 76, 74, 72, 74, null,
        71, 74, 79, 74, 72, 71, 67, null,
        72, 72, 76, 72, 71, 69, 67, null,
        69, 72, 76, 79, 77, 76, 74, 72,
        76, 76, 79, 83, 81, 79, 76, 74,
        74, 71, 74, 79, 77, 74, 71, 67,
        72, 74, 76, 79, 76, 74, 72, 69,
        71, 72, 74, 76, 79, 76, 74, 72,
      ],
      harmony: [
        64, null, 67, null, 72, null, 67, null,
        62, null, 67, null, 71, null, 67, null,
        60, null, 64, null, 69, null, 64, null,
        60, null, 65, null, 69, null, 65, null,
        64, null, 67, null, 72, null, 76, null,
        62, null, 67, null, 74, null, 71, null,
        60, null, 64, null, 72, null, 69, null,
        60, null, 65, null, 69, null, 72, null,
      ],
      bass: [
        36, null, null, 36, 43, null, 36, null,
        31, null, null, 31, 38, null, 31, null,
        33, null, null, 33, 40, null, 33, null,
        29, null, null, 29, 36, null, 29, null,
        36, null, null, 36, 43, null, 36, null,
        31, null, null, 31, 38, null, 31, null,
        33, null, null, 33, 40, null, 33, null,
        29, null, null, 29, 36, null, 29, null,
      ],
      arp: [
        72, 76, 79, 84, 79, 76, 72, 76,
        67, 71, 74, 79, 74, 71, 67, 71,
        69, 72, 76, 81, 76, 72, 69, 72,
        65, 69, 72, 77, 72, 69, 65, 69,
        72, 76, 79, 84, 79, 76, 72, 76,
        67, 71, 74, 79, 74, 71, 67, 71,
        69, 72, 76, 81, 76, 72, 69, 72,
        65, 69, 72, 77, 72, 69, 65, 69,
      ],
      counter: [
        null, null, 84, null, 83, null, 79, null,
        null, null, 79, null, 78, null, 74, null,
        null, null, 81, null, 79, null, 76, null,
        null, null, 77, null, 76, null, 72, null,
        null, null, 84, null, 83, null, 86, null,
        null, null, 83, null, 79, null, 74, null,
        null, null, 81, null, 84, null, 81, null,
        null, null, 77, null, 76, null, 72, null,
      ],
      sparkle: [
        null, null, null, 96, null, null, null, null,
        null, null, null, 91, null, null, null, null,
        null, null, null, 93, null, null, null, null,
        null, null, null, 89, null, null, null, null,
        null, null, null, 96, null, null, null, null,
        null, null, null, 91, null, null, null, null,
        null, null, null, 93, null, null, null, null,
        null, null, null, 89, null, null, null, null,
      ],
      counterInstrument: "bell",
      sparkleInstrument: "bell",
      drums: "pop",
    }),
    dusk: Object.freeze({
      tempo: 56,
      wave: "sine",
      instrument: "strings",
      volume: 0.155,
      swing: 0,
      length: 64,
      chords: [
        { root: 50, tones: minor7 },
        { root: 46, tones: major7 },
        { root: 43, tones: minor7 },
        { root: 45, tones: dominant7 },
        { root: 50, tones: minor7 },
        { root: 41, tones: major7 },
        { root: 43, tones: minor7 },
        { root: 45, tones: dominant7 },
      ],
      melody: [
        74, null, 77, null, 81, null, 77, null,
        74, null, 70, null, 74, null, 77, null,
        74, null, 77, 81, 79, null, 77, null,
        76, null, 73, null, 69, null, null, null,
        74, null, 77, null, 81, null, 84, null,
        81, null, 77, null, 74, null, 72, null,
        74, null, 70, null, 67, null, 70, null,
        69, null, 73, null, 76, null, 74, null,
      ],
      harmony: [
        65, null, 69, null, 74, null, 69, null,
        65, null, 62, null, 65, null, 69, null,
        67, null, 70, 74, 72, null, 70, null,
        69, null, 64, null, 61, null, null, null,
        65, null, 69, null, 74, null, 77, null,
        72, null, 69, null, 65, null, 64, null,
        67, null, 62, null, 58, null, 62, null,
        61, null, 64, null, 69, null, 65, null,
      ],
      bass: [
        38, null, null, null, 45, null, null, null,
        34, null, null, null, 41, null, null, null,
        31, null, null, null, 38, null, null, null,
        33, null, null, null, 40, null, null, null,
        38, null, null, null, 45, null, null, null,
        29, null, null, null, 36, null, null, null,
        31, null, null, null, 38, null, null, null,
        33, null, null, null, 40, null, null, null,
      ],
      arp: [
        62, 65, 69, 74, 65, 69, 74, 77,
        58, 62, 65, 70, 62, 65, 70, 74,
        55, 58, 62, 67, 58, 62, 67, 70,
        57, 61, 64, 69, 61, 64, 69, 73,
        62, 65, 69, 74, 69, 74, 77, 81,
        58, 62, 65, 70, 65, 70, 74, 77,
        55, 58, 62, 67, 62, 67, 70, 74,
        57, 61, 64, 69, 64, 69, 73, 76,
      ],
      counter: [
        null, null, 86, null, null, 81, null, null,
        null, null, 82, null, null, 77, null, null,
        null, null, 86, null, null, 89, null, null,
        null, null, 81, null, null, 76, null, null,
        null, null, 86, null, null, 93, null, null,
        null, null, 89, null, null, 84, null, null,
        null, null, 82, null, null, 86, null, null,
        null, null, 81, null, null, 76, null, null,
      ],
      counterInstrument: "strings",
      drums: "none",
    }),
    dawn: Object.freeze({
      tempo: 60,
      wave: "sine",
      instrument: "strings",
      volume: 0.15,
      swing: 0,
      length: 64,
      chords: [
        { root: 45, tones: minor7 },
        { root: 41, tones: major7 },
        { root: 48, tones: major7 },
        { root: 43, tones: major7 },
        { root: 45, tones: minor7 },
        { root: 40, tones: minor7 },
        { root: 41, tones: major7 },
        { root: 43, tones: major7 },
      ],
      melody: [
        69, null, 72, 76, 81, null, 76, null,
        69, null, 72, 77, 76, null, 72, null,
        72, null, 76, 79, 84, null, 79, null,
        74, null, 71, 67, 74, null, null, null,
        69, null, 72, 76, 81, null, 88, null,
        83, null, 79, 76, 72, null, 71, null,
        69, null, 72, 77, 81, null, 84, null,
        79, null, 74, 71, 67, null, 71, null,
      ],
      harmony: [
        60, null, 64, 69, 72, null, 69, null,
        60, null, 64, 69, 65, null, 64, null,
        64, null, 67, 72, 76, null, 72, null,
        67, null, 62, 59, 67, null, null, null,
        60, null, 64, 69, 72, null, 76, null,
        67, null, 64, 60, 59, null, 55, null,
        60, null, 64, 69, 72, null, 77, null,
        67, null, 62, 59, 55, null, 62, null,
      ],
      bass: [
        33, null, null, null, 40, null, null, null,
        29, null, null, null, 36, null, null, null,
        36, null, null, null, 43, null, null, null,
        31, null, null, null, 38, null, null, null,
        33, null, null, null, 40, null, null, null,
        28, null, null, null, 35, null, null, null,
        29, null, null, null, 36, null, null, null,
        31, null, null, null, 38, null, null, null,
      ],
      arp: [
        57, 60, 64, 69, 60, 64, 69, 72,
        53, 57, 60, 65, 57, 60, 65, 69,
        60, 64, 67, 72, 64, 67, 72, 76,
        55, 59, 62, 67, 59, 62, 67, 71,
        57, 60, 64, 69, 64, 69, 72, 76,
        53, 57, 60, 65, 60, 65, 69, 72,
        60, 64, 67, 72, 67, 72, 76, 79,
        55, 59, 62, 67, 62, 67, 71, 74,
      ],
      counter: [
        null, null, 81, null, null, 84, null, null,
        null, null, 77, null, null, 81, null, null,
        null, null, 84, null, null, 88, null, null,
        null, null, 79, null, null, 74, null, null,
        null, null, 81, null, null, 88, null, null,
        null, null, 83, null, null, 79, null, null,
        null, null, 84, null, null, 88, null, null,
        null, null, 86, null, null, 83, null, null,
      ],
      counterInstrument: "strings",
      drums: "none",
    }),
    sad: Object.freeze({
      tempo: 62,
      wave: "sine",
      instrument: "strings",
      volume: 0.16,
      swing: 0,
      chords: [
        { root: 45, tones: minor7 },
        { root: 41, tones: major7 },
        { root: 48, tones: major7 },
        { root: 43, tones: dominant7 },
      ],
      melody: [
        57, null, 60, 64, 65, null, 64, 60,
        57, null, 60, 64, 67, null, 65, 64,
        60, null, 64, 67, 69, null, 67, 64,
        62, null, 65, 69, 67, null, 64, null,
      ],
      harmony: [
        52, null, 55, 60, 53, null, 52, 48,
        52, null, 55, 60, 55, null, 53, 52,
        55, null, 60, 64, 57, null, 55, 52,
        50, null, 53, 57, 55, null, 52, null,
      ],
      bass: [
        33, null, null, null, 29, null, 31, null,
        29, null, null, null, 36, null, 33, null,
        36, null, null, null, 32, null, 35, null,
        31, null, null, null, 38, null, 35, null,
      ],
      arp: [
        57, 60, 64, 67, 60, 64, 67, 72,
        57, 60, 64, 67, 60, 64, 67, 72,
        60, 64, 67, 72, 64, 67, 72, 76,
        62, 65, 69, 72, 65, 69, 72, 77,
      ],
      drums: "sad",
    }),
    night: Object.freeze({
      tempo: 58,
      wave: "sine",
      instrument: "piano",
      volume: 0.15,
      swing: 0,
      chords: [
        { root: 50, tones: minor7 },
        { root: 46, tones: major7 },
        { root: 43, tones: minor7 },
        { root: 45, tones: dominant7 },
      ],
      melody: [
        74, null, null, 77, null, 81, null, 77,
        74, null, null, 70, null, 69, null, null,
        74, null, 77, null, 81, null, 84, 81,
        79, null, 77, null, 74, null, 69, null,
      ],
      harmony: [
        62, null, 65, null, null, 69, null, null,
        62, null, 65, null, null, 67, null, null,
        62, null, 65, null, 69, null, 72, null,
        67, null, 65, null, 62, null, 60, null,
      ],
      bass: [
        38, null, null, null, null, null, null, null,
        34, null, null, null, 41, null, null, null,
        31, null, null, null, 38, null, null, null,
        33, null, null, null, null, null, null, null,
      ],
      arp: [
        62, 65, 69, 74, 65, 69, 74, 77,
        62, 65, 69, 74, 65, 69, 74, 77,
        62, 65, 69, 74, 65, 69, 74, 77,
        69, 72, 77, 81, 72, 77, 81, 84,
      ],
      drums: "night",
    }),
    combat: Object.freeze({
      tempo: 154,
      wave: "square",
      instrument: "combat",
      volume: 0.11,
      swing: 0,
      chords: [
        { root: 40, tones: minor7 },
        { root: 36, tones: major7 },
        { root: 38, tones: major7 },
        { root: 35, tones: dominant7 },
      ],
      melody: [
        64, 67, 71, 74, 76, 74, 71, 67,
        72, 76, 79, 76, 74, 71, 67, 64,
        64, 67, 71, 74, 79, 76, 74, 71,
        72, 74, 76, 79, 83, 79, 76, 74,
      ],
      harmony: [
        52, null, 55, 59, 55, 59, 62, null,
        55, null, 59, 62, 60, 62, 64, null,
        52, null, 55, 59, 55, 59, 62, null,
        55, 59, 60, 62, 64, 62, 60, 59,
      ],
      bass: [
        28, 28, 28, null, 35, 35, 35, null,
        36, 36, 36, null, 43, 43, 43, null,
        26, 26, 26, null, 33, 33, 33, null,
        31, 31, 31, null, 38, 38, 38, null,
      ],
      arp: [
        52, 55, 59, 62, 55, 59, 62, 67,
        52, 55, 59, 62, 55, 59, 62, 67,
        52, 55, 59, 62, 55, 59, 62, 67,
        55, 59, 62, 67, 59, 62, 67, 71,
      ],
      drums: "combat",
    }),
  });

  /**
   * Owns the Web Audio graph and both the procedural score and the sound
   * effects. All music/sfx are synthesized; the only sample is chicken.wav.
   * Automated tests construct it with `?mute=1` so no real scheduling runs.
   */
  class AudioDirector {
    constructor() {
      this.ctx = null;
      this.master = null;
      this.musicGain = null;
      this.musicFilter = null;
      this.sfxGain = null;
      this.drumGain = null;
      this.delay = null;
      this.delayWet = null;
      this.compressor = null;
      this.noiseBuffer = null;
      this.scene = null;
      this.sceneToken = 0;
      this.started = false;
      this.step = 0;
      this.nextNoteTime = 0;
      this.timer = 0;
      this.chickenSoundUrl = "Music/chicken.wav";
      this.animalHurtCount = 0;
      this.monsterHurtCount = 0;
      this.playerHurtCount = 0;
      this.actionSounds = {
        dig: 0,
        mine: 0,
        chop: 0,
        craftSuccess: 0,
        craftFail: 0,
        place: 0,
        respawn: 0,
      };
      this.animalSound = null;
      this.muted = false;
      this.musicLevel = 0.24;
    }

    start() {
      this.started = true;
      try {
        // Automated browser tests opt out of real scheduling so timing and
        // input checks stay deterministic; production has no mute parameter.
        if (new URLSearchParams(window.location.search).get("mute") === "1") {
          this.muted = true;
          return;
        }
        const AudioCtor = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtor) return;
        if (!this.ctx) {
          this.ctx = new AudioCtor();
          this.master = this.ctx.createGain();
          this.master.gain.value = 0.7;
          this.compressor = this.ctx.createDynamicsCompressor();
          this.compressor.threshold.value = -18;
          this.compressor.knee.value = 20;
          this.compressor.ratio.value = 3;
          this.compressor.attack.value = 0.006;
          this.compressor.release.value = 0.22;
          this.master.connect(this.compressor);
          this.compressor.connect(this.ctx.destination);

          this.musicFilter = this.ctx.createBiquadFilter();
          this.musicFilter.type = "lowpass";
          this.musicFilter.frequency.value = 5200;
          this.musicGain = this.ctx.createGain();
          this.musicGain.gain.value = this.musicLevel;
          this.musicGain.connect(this.musicFilter);
          this.musicFilter.connect(this.master);

          this.delay = this.ctx.createDelay(1);
          this.delay.delayTime.value = 0.27;
          this.delayWet = this.ctx.createGain();
          this.delayWet.gain.value = 0.12;
          const feedback = this.ctx.createGain();
          feedback.gain.value = 0.2;
          this.musicFilter.connect(this.delay);
          this.delay.connect(feedback);
          feedback.connect(this.delay);
          this.delay.connect(this.delayWet);
          this.delayWet.connect(this.master);

          this.sfxGain = this.ctx.createGain();
          this.sfxGain.gain.value = 0.78;
          this.sfxGain.connect(this.master);
          this.drumGain = this.ctx.createGain();
          this.drumGain.gain.value = 0.8;
          this.drumGain.connect(this.master);

          const length = Math.max(1, Math.floor(this.ctx.sampleRate * 0.35));
          this.noiseBuffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
          const data = this.noiseBuffer.getChannelData(0);
          for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;

          this.animalSound = new Audio(this.chickenSoundUrl);
          this.animalSound.preload = "auto";
          this.timer = window.setInterval(() => this.tick(), 40);
        }
        this.resume();
        this.nextNoteTime = this.ctx.currentTime + 0.04;
        this.step = 0;
      } catch (error) {
        // Audio is optional; the game must continue when it is unavailable.
      }
    }

    resume() {
      if (!this.ctx) return;
      if (this.ctx.state === "suspended") {
        const resumed = this.ctx.resume();
        if (resumed && typeof resumed.catch === "function") resumed.catch(() => {});
      }
    }

    setScene(scene) {
      if (!TRACKS[scene]) return;
      if (this.scene === scene) return;
      this.scene = scene;
      this.step = 0;
      if (!this.ctx || !this.musicGain) return;
      const now = this.ctx.currentTime;
      const token = ++this.sceneToken;
      this.musicGain.gain.cancelScheduledValues(now);
      this.musicGain.gain.setTargetAtTime(0.0001, now, 0.035);
      this.nextNoteTime = now + 0.05;
      window.setTimeout(() => {
        if (token !== this.sceneToken || !this.musicGain) return;
        this.musicGain.gain.setTargetAtTime(this.musicLevel, this.ctx.currentTime, 0.12);
      }, 150);
    }

    update({ phase, day, combat }) {
      if (!this.started) return;
      let scene;
      if (combat) scene = "combat";
      else if (phase === "night") scene = "night";
      else if (phase === "dawn") scene = "dawn";
      else if (phase === "dusk") scene = "dusk";
      else scene = day % 2 === 0 ? "day2" : "day1";
      this.setScene(scene);
      this.resume();
    }

  // -------------------------------------------------------------------
  // Score scheduling. `tick()` runs on a setInterval and schedules steps
  // slightly ahead of the audio clock; `setScene` fades between tracks.
  // -------------------------------------------------------------------

    createVoiceNode(voice, kind) {
      const node = this.ctx[kind]();
      voice.nodes.push(node);
      this.activeAudioNodes = (this.activeAudioNodes || 0) + 1;
      if (kind === "createOscillator" || kind === "createBufferSource") {
        voice.active++;
        node.addEventListener("ended", () => {
          if (--voice.active) return;
          for (const finished of voice.nodes) finished.disconnect();
          this.activeAudioNodes -= voice.nodes.length;
          voice.nodes.length = 0;
        }, { once: true });
      }
      return node;
    }

    tick() {
      if (!this.ctx || !this.scene) return;
      if (this.ctx.state !== "running") return;
      const track = TRACKS[this.scene];
      if (!track) return;
      const stepDuration = 60 / track.tempo / 2;
      const horizon = this.ctx.currentTime + 0.25;
      // Background/slow frames must not replay a backlog of already-expired notes.
      if (this.nextNoteTime < this.ctx.currentTime - 0.1) this.nextNoteTime = this.ctx.currentTime + 0.04;
      let guard = 0;
      while (this.nextNoteTime < horizon && guard < 28) {
        const swingOffset = track.swing && this.step % 2 === 1 ? stepDuration * track.swing : 0;
        this.scheduleStep(track, this.step, this.nextNoteTime + swingOffset, stepDuration);
        this.nextNoteTime += stepDuration;
        this.step = (this.step + 1) % (track.length || 32);
        guard += 1;
      }
    }

    note(frequency, when, duration, wave, volume, options = {}) {
      const audioVoice = { nodes: [], active: 0 };
      if (!this.ctx || !this.musicGain) return;
      const pan = options.pan || 0;
      const output = this.createVoiceNode(audioVoice, "createGain");
      const panner = typeof this.ctx.createStereoPanner === "function"
        ? this.createVoiceNode(audioVoice, "createStereoPanner")
        : null;
      output.gain.setValueAtTime(0.0001, when);
      output.gain.linearRampToValueAtTime(volume, when + 0.018);
      output.gain.exponentialRampToValueAtTime(0.0001, when + Math.max(0.04, duration));
      if (panner) {
        panner.pan.value = pan;
        output.connect(panner);
        panner.connect(this.musicGain);
      } else {
        output.connect(this.musicGain);
      }

      const oscillators = [];
      const first = this.createVoiceNode(audioVoice, "createOscillator");
      first.type = wave;
      first.frequency.setValueAtTime(frequency, when);
      oscillators.push(first);
      if (options.fat) {
        const second = this.createVoiceNode(audioVoice, "createOscillator");
        second.type = wave;
        second.frequency.setValueAtTime(frequency, when);
        second.detune.setValueAtTime(6, when);
        oscillators.push(second);
      }
      for (const oscillator of oscillators) {
        const level = this.createVoiceNode(audioVoice, "createGain");
        level.gain.value = 1 / oscillators.length;
        oscillator.connect(level);
        level.connect(output);
        oscillator.start(when);
        oscillator.stop(when + Math.max(0.05, duration) + 0.03);
      }
    }

    scheduleStep(track, step, when, stepDuration) {
      const chordIndex = Math.floor(step / 8) % track.chords.length;
      const chord = track.chords[chordIndex];

      const melody = track.melody[step];
      if (melody !== null && melody !== undefined) {
        this.instrumentNote(
          midi(melody), when, stepDuration * 1.75, track,
          track.volume, 0.12, "lead"
        );
      }

      const harmony = track.harmony[step];
      if (harmony !== null && harmony !== undefined) {
        this.instrumentNote(
          midi(harmony), when, stepDuration * 2.0, track,
          track.volume * 0.42, -0.2, "harmony"
        );
      }

      const bass = track.bass[step];
      if (bass !== null && bass !== undefined) {
        this.instrumentNote(
          midi(bass), when, stepDuration * 3.4, track,
          track.volume * 0.62, -0.05, "bass"
        );
      }

      const arp = track.arp[step];
      if (arp !== null && arp !== undefined) {
        this.instrumentNote(
          midi(arp), when, stepDuration * 0.9, track,
          track.volume * 0.2, 0.28, "arp"
        );
      }

      if (track.counter && track.counter[step] !== null && track.counter[step] !== undefined) {
        this.secondaryNote(
          track.counterInstrument,
          track.counter[step],
          when,
          stepDuration * 1.4,
          track.volume * 0.3,
          -0.24
        );
      }

      if (track.sparkle && track.sparkle[step] !== null && track.sparkle[step] !== undefined) {
        this.secondaryNote(
          track.sparkleInstrument,
          track.sparkle[step],
          when,
          stepDuration * 0.65,
          track.volume * 0.24,
          0.34
        );
      }

      if (step % 8 === 0) {
        for (const interval of chord.tones) {
          this.instrumentNote(
            midi(chord.root + interval),
            when,
            stepDuration * 7.6,
            track,
            track.volume * 0.13,
            -0.04,
            "pad"
          );
        }
      }

      this.drums(track.drums, step, when, stepDuration);
    }

    secondaryNote(instrument, note, when, duration, volume, pan) {
      const frequency = midi(note);
      if (instrument === "bell") {
        this.bell(when, frequency, volume);
      } else if (instrument === "mallet") {
        this.malletNote(frequency, when, duration, volume, pan, "counter");
      } else if (instrument === "strings") {
        this.stringNote(frequency, when, duration, volume, pan, "counter");
      } else if (instrument === "piano") {
        this.pianoNote(frequency, when, duration, volume, pan, "counter");
      } else {
        this.synthNote(frequency, when, duration, volume, pan, "counter");
      }
    }

    // Route a note's role to the matching instrument implementation.
    instrumentNote(frequency, when, duration, track, volume, pan, role) {
      if (track.instrument === "strings") {
        this.stringNote(frequency, when, duration, volume, pan, role);
      } else if (track.instrument === "piano") {
        this.pianoNote(frequency, when, duration, volume, pan, role);
      } else if (track.instrument === "marimba") {
        this.malletNote(frequency, when, duration, volume, pan, role);
      } else if (track.instrument === "synth") {
        this.synthNote(frequency, when, duration, volume, pan, role);
      } else {
        this.note(frequency, when, duration, track.wave, volume, {
          pan,
          fat: role === "pad",
        });
      }
    }

    stringNote(frequency, when, duration, volume, pan, role) {
      const audioVoice = { nodes: [], active: 0 };
      if (!this.ctx || !this.musicGain) return;
      const attack = role === "pad" ? 0.52 : 0.24;
      const output = this.createVoiceNode(audioVoice, "createGain");
      const filter = this.createVoiceNode(audioVoice, "createBiquadFilter");
      filter.type = "lowpass";
      filter.frequency.setValueAtTime(role === "pad" ? 1150 : 1750, when);
      filter.Q.value = 0.42;
      const panner = typeof this.ctx.createStereoPanner === "function"
        ? this.createVoiceNode(audioVoice, "createStereoPanner")
        : null;
      output.gain.setValueAtTime(0.0001, when);
      output.gain.linearRampToValueAtTime(volume, when + attack);
      output.gain.setValueAtTime(volume, when + Math.max(attack, duration * 0.62));
      output.gain.exponentialRampToValueAtTime(0.0001, when + duration);
      filter.connect(output);
      if (panner) {
        panner.pan.value = pan;
        output.connect(panner);
        panner.connect(this.musicGain);
      } else {
        output.connect(this.musicGain);
      }

      const voices = [
        { detune: -6, type: "triangle", level: 0.42 },
        { detune: 0, type: "sawtooth", level: 0.16 },
        { detune: 6, type: "triangle", level: 0.42 },
      ];
      for (const voice of voices) {
        const oscillator = this.createVoiceNode(audioVoice, "createOscillator");
        const level = this.createVoiceNode(audioVoice, "createGain");
        oscillator.type = voice.type;
        oscillator.frequency.setValueAtTime(frequency, when);
        oscillator.detune.setValueAtTime(voice.detune, when);
        level.gain.value = voice.level;
        oscillator.connect(level);
        level.connect(filter);
        oscillator.start(when);
        oscillator.stop(when + duration + 0.04);
      }
    }

    pianoNote(frequency, when, duration, volume, pan, role) {
      const audioVoice = { nodes: [], active: 0 };
      if (!this.ctx || !this.musicGain) return;
      const output = this.createVoiceNode(audioVoice, "createGain");
      const panner = typeof this.ctx.createStereoPanner === "function"
        ? this.createVoiceNode(audioVoice, "createStereoPanner")
        : null;
      output.gain.setValueAtTime(0.0001, when);
      output.gain.linearRampToValueAtTime(volume, when + 0.008);
      output.gain.exponentialRampToValueAtTime(0.0001, when + Math.max(0.2, duration));
      if (panner) {
        panner.pan.value = pan;
        output.connect(panner);
        panner.connect(this.musicGain);
      } else {
        output.connect(this.musicGain);
      }

      const harmonics = [
        { ratio: 1, wave: "triangle", level: 0.68 },
        { ratio: 2, wave: "sine", level: 0.2 },
        { ratio: 3, wave: "sine", level: 0.08 },
      ];
      for (const harmonic of harmonics) {
        const oscillator = this.createVoiceNode(audioVoice, "createOscillator");
        const level = this.createVoiceNode(audioVoice, "createGain");
        oscillator.type = harmonic.wave;
        oscillator.frequency.setValueAtTime(frequency * harmonic.ratio, when);
        oscillator.detune.setValueAtTime(2, when);
        level.gain.value = harmonic.level;
        oscillator.connect(level);
        level.connect(output);
        oscillator.start(when);
        oscillator.stop(when + Math.max(0.22, duration) + 0.03);
      }
    }

    malletNote(frequency, when, duration, volume, pan, role) {
      const audioVoice = { nodes: [], active: 0 };
      if (!this.ctx || !this.musicGain) return;
      const output = this.createVoiceNode(audioVoice, "createGain");
      const panner = typeof this.ctx.createStereoPanner === "function"
        ? this.createVoiceNode(audioVoice, "createStereoPanner")
        : null;
      output.gain.setValueAtTime(volume, when);
      output.gain.exponentialRampToValueAtTime(0.0001, when + Math.min(0.8, Math.max(0.12, duration * 0.75)));
      if (panner) {
        panner.pan.value = pan;
        output.connect(panner);
        panner.connect(this.musicGain);
      } else {
        output.connect(this.musicGain);
      }
      for (const [ratio, level] of [[1, 0.8], [4, 0.18]]) {
        const oscillator = this.createVoiceNode(audioVoice, "createOscillator");
        const gain = this.createVoiceNode(audioVoice, "createGain");
        oscillator.type = "sine";
        oscillator.frequency.setValueAtTime(frequency * ratio, when);
        gain.gain.value = level;
        oscillator.connect(gain);
        gain.connect(output);
        oscillator.start(when);
        oscillator.stop(when + 0.85);
      }
    }

    synthNote(frequency, when, duration, volume, pan, role) {
      const audioVoice = { nodes: [], active: 0 };
      if (!this.ctx || !this.musicGain) return;
      const output = this.createVoiceNode(audioVoice, "createGain");
      const filter = this.createVoiceNode(audioVoice, "createBiquadFilter");
      filter.type = "lowpass";
      filter.frequency.setValueAtTime(role === "pad" ? 1400 : 2600, when);
      filter.Q.value = 0.9;
      const panner = typeof this.ctx.createStereoPanner === "function"
        ? this.createVoiceNode(audioVoice, "createStereoPanner")
        : null;
      output.gain.setValueAtTime(0.0001, when);
      output.gain.linearRampToValueAtTime(volume, when + (role === "pad" ? 0.18 : 0.02));
      output.gain.exponentialRampToValueAtTime(0.0001, when + duration);
      filter.connect(output);
      if (panner) {
        panner.pan.value = pan;
        output.connect(panner);
        panner.connect(this.musicGain);
      } else {
        output.connect(this.musicGain);
      }
      const oscillator = this.createVoiceNode(audioVoice, "createOscillator");
      oscillator.type = role === "bass" ? "triangle" : "square";
      oscillator.frequency.setValueAtTime(frequency, when);
      oscillator.detune.setValueAtTime(-3, when);
      oscillator.connect(filter);
      oscillator.start(when);
      oscillator.stop(when + duration + 0.03);
    }

    bell(when, frequency, volume) {
      const audioVoice = { nodes: [], active: 0 };
      if (!this.ctx || !this.musicGain) return;
      const output = this.createVoiceNode(audioVoice, "createGain");
      output.gain.setValueAtTime(volume, when);
      output.gain.exponentialRampToValueAtTime(0.0001, when + 0.9);
      output.connect(this.musicGain);
      for (const [ratio, level] of [[1, 0.7], [2.76, 0.18], [5.4, 0.06]]) {
        const oscillator = this.createVoiceNode(audioVoice, "createOscillator");
        const gain = this.createVoiceNode(audioVoice, "createGain");
        oscillator.type = "sine";
        oscillator.frequency.setValueAtTime(frequency * ratio, when);
        gain.gain.value = level;
        oscillator.connect(gain);
        gain.connect(output);
        oscillator.start(when);
        oscillator.stop(when + 0.92);
      }
    }

    // -------------------------------------------------------------------
    // Drum / percussion voices.
    // -------------------------------------------------------------------

    drums(kind, step, when, stepDuration) {
      if (kind === "cartoon") {
        if (step % 8 === 0 || step === 22) this.kick(when, 0.17);
        if (step % 8 === 4) this.snare(when, 0.085);
        if (step % 2 === 1) this.hat(when, 0.03);
        if (step === 2 || step === 10 || step === 18 || step === 26) this.bell(when, midi(96), 0.03);
        if (step === 30) this.tom(when);
      } else if (kind === "pop") {
        if (step % 4 === 0) this.kick(when, 0.14);
        if (step % 8 === 4) this.snare(when, 0.11);
        if (step % 2 === 1) this.hat(when, 0.04);
        if (step === 14 || step === 30) this.hat(when, 0.05);
        if (step === 62) this.tom(when);
      } else if (kind === "light") {
        if (step % 8 === 0) this.kick(when, 0.17);
        if (step % 8 === 4) this.snare(when, 0.08);
        if (step % 2 === 1) this.hat(when, 0.028);
        if (step === 4 || step === 20) this.bell(when, midi(84), 0.035);
      } else if (kind === "bouncy") {
        if (step % 8 === 0 || step === 14 || step === 30) this.kick(when, 0.16);
        if (step % 8 === 4) this.snare(when, 0.09);
        if (step % 2 === 1) this.hat(when, 0.035);
      } else if (kind === "sad") {
        if (step === 0 || step === 16) this.kick(when, 0.11);
      } else if (kind === "combat") {
        if (step % 4 === 0) this.kick(when, 0.21);
        if (step % 8 === 4) this.snare(when, 0.16);
        if (step % 2 === 1) this.hat(when, 0.045);
        if (step === 14 || step === 30) this.tom(when);
      } else if (kind === "night") {
        if (step === 0 || step === 16) this.softPulse(when, stepDuration * 7);
        if (step === 4 || step === 20) this.bell(when, midi(88), 0.045);
        if (step === 12 || step === 28) this.bell(when, midi(91), 0.03);
      }
    }

    kick(when, volume) {
      const audioVoice = { nodes: [], active: 0 };
      if (!this.ctx) return;
      const oscillator = this.createVoiceNode(audioVoice, "createOscillator");
      const gain = this.createVoiceNode(audioVoice, "createGain");
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(125, when);
      oscillator.frequency.exponentialRampToValueAtTime(42, when + 0.14);
      gain.gain.setValueAtTime(volume, when);
      gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.17);
      oscillator.connect(gain);
      gain.connect(this.drumGain || this.master);
      oscillator.start(when);
      oscillator.stop(when + 0.18);
    }

    snare(when, volume) {
      const audioVoice = { nodes: [], active: 0 };
      if (!this.ctx || !this.noiseBuffer) return;
      const source = this.createVoiceNode(audioVoice, "createBufferSource");
      source.buffer = this.noiseBuffer;
      const filter = this.createVoiceNode(audioVoice, "createBiquadFilter");
      filter.type = "bandpass";
      filter.frequency.value = 1700;
      filter.Q.value = 0.8;
      const gain = this.createVoiceNode(audioVoice, "createGain");
      gain.gain.setValueAtTime(volume, when);
      gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.11);
      source.connect(filter);
      filter.connect(gain);
      gain.connect(this.drumGain || this.master);
      source.start(when);
      source.stop(when + 0.12);

      const tone = this.createVoiceNode(audioVoice, "createOscillator");
      const toneGain = this.createVoiceNode(audioVoice, "createGain");
      tone.type = "triangle";
      tone.frequency.setValueAtTime(190, when);
      toneGain.gain.setValueAtTime(volume * 0.45, when);
      toneGain.gain.exponentialRampToValueAtTime(0.0001, when + 0.08);
      tone.connect(toneGain);
      toneGain.connect(this.drumGain || this.master);
      tone.start(when);
      tone.stop(when + 0.09);
    }

    hat(when, volume) {
      const audioVoice = { nodes: [], active: 0 };
      if (!this.ctx || !this.noiseBuffer) return;
      const source = this.createVoiceNode(audioVoice, "createBufferSource");
      source.buffer = this.noiseBuffer;
      const filter = this.createVoiceNode(audioVoice, "createBiquadFilter");
      filter.type = "highpass";
      filter.frequency.value = 5200;
      const gain = this.createVoiceNode(audioVoice, "createGain");
      gain.gain.setValueAtTime(volume, when);
      gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.045);
      source.connect(filter);
      filter.connect(gain);
      gain.connect(this.drumGain || this.master);
      source.start(when);
      source.stop(when + 0.05);
    }

    tom(when) {
      const audioVoice = { nodes: [], active: 0 };
      if (!this.ctx) return;
      const oscillator = this.createVoiceNode(audioVoice, "createOscillator");
      const gain = this.createVoiceNode(audioVoice, "createGain");
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(150, when);
      oscillator.frequency.exponentialRampToValueAtTime(90, when + 0.12);
      gain.gain.setValueAtTime(0.11, when);
      gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.13);
      oscillator.connect(gain);
      gain.connect(this.drumGain || this.master);
      oscillator.start(when);
      oscillator.stop(when + 0.14);
    }

    softPulse(when, duration) {
      const audioVoice = { nodes: [], active: 0 };
      if (!this.ctx) return;
      const oscillator = this.createVoiceNode(audioVoice, "createOscillator");
      const gain = this.createVoiceNode(audioVoice, "createGain");
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(72, when);
      gain.gain.setValueAtTime(0.0001, when);
      gain.gain.linearRampToValueAtTime(0.045, when + 0.4);
      gain.gain.exponentialRampToValueAtTime(0.0001, when + duration);
      oscillator.connect(gain);
      gain.connect(this.drumGain || this.master);
      oscillator.start(when);
      oscillator.stop(when + duration + 0.02);
    }

    noiseBurst(when, duration, volume, frequency, type = "bandpass", attack = 0) {
      const audioVoice = { nodes: [], active: 0 };
      if (!this.ctx || !this.noiseBuffer) return;
      const source = this.createVoiceNode(audioVoice, "createBufferSource");
      source.buffer = this.noiseBuffer;
      source.playbackRate.value = 0.65 + Math.random() * 0.5;
      const filter = this.createVoiceNode(audioVoice, "createBiquadFilter");
      filter.type = type;
      filter.frequency.setValueAtTime(frequency, when);
      filter.frequency.exponentialRampToValueAtTime(Math.max(120, frequency * 0.35), when + duration);
      const gain = this.createVoiceNode(audioVoice, "createGain");
      gain.gain.setValueAtTime(attack > 0 ? 0.0001 : volume, when);
      if (attack > 0) gain.gain.linearRampToValueAtTime(volume, when + Math.min(attack, duration * 0.5));
      gain.gain.exponentialRampToValueAtTime(0.0001, when + duration);
      source.connect(filter);
      filter.connect(gain);
      gain.connect(this.sfxGain || this.master);
      source.start(when);
      source.stop(when + duration + 0.02);
    }

    // -------------------------------------------------------------------
    // One-shot action sound effects. Each increments a counter first so the
    // browser tests can assert they fired even while muted.
    // -------------------------------------------------------------------

    actionTone(frequency, duration, wave, volume, slideTo = null, delay = 0) {
      const audioVoice = { nodes: [], active: 0 };
      if (!this.ctx || !this.sfxGain) return;
      const when = this.ctx.currentTime + delay;
      const oscillator = this.createVoiceNode(audioVoice, "createOscillator");
      const gain = this.createVoiceNode(audioVoice, "createGain");
      oscillator.type = wave;
      oscillator.frequency.setValueAtTime(frequency, when);
      if (slideTo !== null) {
        oscillator.frequency.exponentialRampToValueAtTime(Math.max(30, slideTo), when + duration);
      }
      gain.gain.setValueAtTime(0.0001, when);
      gain.gain.linearRampToValueAtTime(volume, when + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, when + duration);
      oscillator.connect(gain);
      gain.connect(this.sfxGain);
      oscillator.start(when);
      oscillator.stop(when + duration + 0.02);
    }

    beginAction(name) {
      if (this.actionSounds[name] !== undefined) this.actionSounds[name] += 1;
      return Boolean(this.ctx && !this.muted);
    }

    playFootstep(medium) {
      this.actionSounds["step_"+medium] = (this.actionSounds["step_"+medium] || 0)+1;
      if (!this.ctx || this.muted) return;
      const water = medium === "water", rock = medium === "rock";
      if(water) {
        this.playWaterFlow();
        return;
      }
      this.noiseBurst(this.ctx.currentTime,0.18,rock?0.05:0.04,rock?650:360,"lowpass",0.045);
    }

    waterFlowBuffer() {
      if (this.flowBuffer) return this.flowBuffer;
      const rate = this.ctx.sampleRate, duration = 2;
      const buffer = this.ctx.createBuffer(1, Math.floor(rate * duration), rate);
      const data = buffer.getChannelData(0);
      // Low, smooth turbulence under small liquid eddies. Unlike footsteps on
      // loose ground, this has no dry crackle or high-frequency grit.
      let smooth = 0;
      const filter = 1 - Math.exp(-2 * Math.PI * 420 / rate);
      for (let i = 0; i < data.length; i++) {
        smooth += filter * ((Math.random() * 2 - 1) - smooth);
        data[i] = smooth * 0.24;
      }
      for (let n = 0; n < 48; n++) {
        const start = Math.floor(Math.random() * data.length);
        const length = Math.floor(rate * (0.065 + Math.random() * 0.09));
        const frequency = 360 + Math.random() * 850;
        const level = 0.045 + Math.random() * 0.075;
        for (let j = 0; j < length; j++) {
          const t = j / rate, progress = j / length;
          const envelope = Math.sin(Math.PI * progress) ** 2 * Math.exp(-progress * 3);
          const phase = 2 * Math.PI * frequency * (t - 0.25 * t * progress);
          data[(start + j) % data.length] += Math.sin(phase) * envelope * level;
        }
      }
      this.flowBuffer = buffer;
      return buffer;
    }

    playWaterFlow() {
      const audioVoice = { nodes: [], active: 0 };
      if (!this.ctx || !this.noiseBuffer || this.muted) return;
      const now = this.ctx.currentTime;
      if (now < (this.nextWaterFlowAt || 0)) return;
      this.nextWaterFlowAt = now + 0.3;
      const source = this.createVoiceNode(audioVoice, "createBufferSource"); source.buffer = this.waterFlowBuffer();
      source.loop = true; source.playbackRate.value = 1;
      const low = this.createVoiceNode(audioVoice, "createBiquadFilter"); low.type = "lowpass"; low.frequency.value = 1800; low.Q.value = 0.35;
      const high = this.createVoiceNode(audioVoice, "createBiquadFilter"); high.type = "highpass"; high.frequency.value = 90; high.Q.value = 0.35;
      // Overlapping liquid movement with a soft onset, never a per-step impact.
      const gain = this.createVoiceNode(audioVoice, "createGain");
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.09, now + 0.16);
      gain.gain.linearRampToValueAtTime(0.055, now + 0.38);
      gain.gain.linearRampToValueAtTime(0, now + 0.65);
      source.connect(high); high.connect(low); low.connect(gain); gain.connect(this.sfxGain || this.master);
      source.start(now); source.stop(now + 0.67);
    }

    playFillWater() {
      this.actionSounds.fillWater = (this.actionSounds.fillWater || 0)+1;
      if (!this.ctx || this.muted) return;
      this.noiseBurst(this.ctx.currentTime,0.25,0.12,1000,"lowpass");
      this.actionTone(420,0.16,"sine",0.12,760);
    }

    playDig() {
      if (!this.beginAction("dig")) return;
      this.actionTone(92, 0.22, "sine", 0.26, 46);
      this.noiseBurst(this.ctx.currentTime, 0.18, 0.22, 430, "lowpass");
    }

    playMine() {
      if (!this.beginAction("mine")) return;
      const now = this.ctx.currentTime;
      this.actionTone(185, 0.16, "triangle", 0.2, 85);
      this.actionTone(920, 0.07, "square", 0.08, 540);
      this.noiseBurst(now, 0.12, 0.22, 2100, "bandpass");
    }

    playChop() {
      if (!this.beginAction("chop")) return;
      const now = this.ctx.currentTime;
      for (let hit = 0; hit < 2; hit += 1) {
        const delay = hit * 0.085;
        this.actionTone(150, 0.12, "sine", 0.24 - hit * 0.06, 72, delay);
        this.noiseBurst(now + delay, 0.09, 0.16, 620, "lowpass");
      }
    }

    playCraftSuccess() {
      if (!this.beginAction("craftSuccess")) return;
      const notes = [523.25, 659.25, 783.99];
      notes.forEach((frequency, index) => {
        this.actionTone(frequency, 0.42, "triangle", 0.18, null, index * 0.09);
      });
    }

    playCraftFail() {
      if (!this.beginAction("craftFail")) return;
      this.actionTone(190, 0.24, "square", 0.16, 120);
      this.actionTone(155, 0.28, "sawtooth", 0.1, 95, 0.04);
    }

    playPourWater() {
      if(!this.ctx||this.muted)return;
      this.noiseBurst(this.ctx.currentTime,0.6,0.08,900,"lowpass",0.02);
      this.actionTone(250,0.3,"sine",0.025,130);
    }

    playWaterDrain() {
      if(!this.ctx||this.muted)return;
      this.noiseBurst(this.ctx.currentTime,0.5,0.06,650,"lowpass",0.08);
    }

    playHolyGunShot(volume = 1) {
      this.actionSounds.holyGunShot=(this.actionSounds.holyGunShot||0)+1;
      if(!this.ctx || this.muted || volume<=0)return;
      const now=this.ctx.currentTime;
      // Share a short voice limit across all guns to keep overlapping rain controlled.
      if(now<(this.nextHolyGunSoundAt||0))return;
      this.nextHolyGunSoundAt=now+0.035;
      const level=Math.min(1,volume);
      this.noiseBurst(now,0.045,0.045*level,2300,"lowpass",0.002);
      this.actionTone(800+Math.random()*120,0.055,"triangle",0.035*level,240);
      this.actionTone(135,0.04,"sine",0.025*level,70);
    }

    playEndermanBlink() {
      this.actionSounds.endermanBlink = (this.actionSounds.endermanBlink || 0) + 1;
      if (!this.ctx || this.muted) return;
      const now = this.ctx.currentTime;
      // Keep a group of simultaneous blinks from producing an abrupt volume spike.
      if (now < (this.nextEndermanBlinkAt || 0)) return;
      this.nextEndermanBlinkAt = now + 0.08;
      this.noiseBurst(now, 0.22, 0.075, 1800, "bandpass", 0.015);
      this.actionTone(240, 0.12, "sine", 0.09, 980);
      this.actionTone(780, 0.2, "sine", 0.075, 150, 0.06);
    }

    playPortalOpen() {
      this.actionSounds.portalOpen = (this.actionSounds.portalOpen || 0) + 1;
      if (!this.ctx || this.muted) return;
      const now = this.ctx.currentTime;
      if (now < (this.nextPortalOpenAt || 0)) return;
      this.nextPortalOpenAt = now + 0.08;
      this.noiseBurst(now, 0.45, 0.07, 650, "lowpass", 0.04);
      this.actionTone(95, 0.4, "sine", 0.13, 180);
      this.actionTone(320, 0.32, "sine", 0.055, 120, 0.06);
    }

    playPortalSwap() {
      this.actionSounds.portalSwap = (this.actionSounds.portalSwap || 0) + 1;
      if (!this.ctx || this.muted) return;
      const now = this.ctx.currentTime;
      if (now < (this.nextPortalSwapAt || 0)) return;
      this.nextPortalSwapAt = now + 0.08;
      this.noiseBurst(now, 0.22, 0.1, 1500, "bandpass", 0.012);
      this.actionTone(180, 0.09, "sine", 0.1, 720);
      this.actionTone(650, 0.23, "sine", 0.09, 65, 0.04);
    }

    playSummonerSkill(id, phase) {
      if (!this.ctx || this.muted) return;
      const sweep = {
        flash: [320, 1400, 0.14],
        ignite: [145, 72, 0.23],
        smite: [980, 95, 0.28],
        heal: [430, 860, 0.34],
        barrier: [650, 410, 0.36],
        exhaust: [510, 160, 0.32],
        cleanse: [660, 1320, 0.30],
        teleport: {
          cast: [180, 490, 0.45],
          pulse: [280, 470, 0.25],
          arrive: [500, 1160, 0.36],
          interrupt: [450, 115, 0.24],
        }[phase],
      }[id];
      if (!sweep) return;
      const [from, to, duration] = sweep;
      this.actionTone(from, duration, "triangle", 0.076, to);
      this.actionTone(from * 1.5, duration * 0.78, "sine", 0.04, to * 1.5, 0.055);
    }

    playGiftLand() {
      this.actionSounds.giftLand=(this.actionSounds.giftLand||0)+1;
      if (!this.ctx || this.muted) return;
      this.actionTone(110,0.14,"sine",0.12,60);
      this.noiseBurst(this.ctx.currentTime,0.12,0.07,600,"lowpass",0.02);
      this.actionTone(523.25,0.22,"sine",0.08,523.25,0.06);
      this.actionTone(783.99,0.3,"sine",0.07,783.99,0.16);
    }

    playPlace() {
      if (!this.beginAction("place")) return;
      const now = this.ctx.currentTime;
      this.actionTone(120, 0.13, "sine", 0.24, 65);
      this.noiseBurst(now, 0.1, 0.16, 800, "lowpass");
    }

    playRespawnStele() {
      const audioVoice = { nodes: [], active: 0 };
      if (!this.beginAction("respawn")) return;
      const now = this.ctx.currentTime;
      const notes = [392, 523.25, 659.25, 783.99];
      notes.forEach((frequency, index) => {
        const oscillator = this.createVoiceNode(audioVoice, "createOscillator");
        const gain = this.createVoiceNode(audioVoice, "createGain");
        oscillator.type = "sine";
        oscillator.frequency.setValueAtTime(frequency, now);
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.linearRampToValueAtTime(0.12, now + 0.06 + index * 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.0 + index * 0.12);
        oscillator.connect(gain);
        gain.connect(this.sfxGain);
        oscillator.start(now);
        oscillator.stop(now + 1.2 + index * 0.12);
      });
      this.noiseBurst(now, 0.35, 0.06, 3200, "highpass");
      this.actionTone(1046.5, 0.6, "sine", 0.08, 783.99, 0.12);
    }

    playAnimalHurt() {
      this.animalHurtCount += 1;
      if (this.muted) return;
      try {
        const sound = new Audio(this.chickenSoundUrl);
        sound.volume = 0.65;
        const played = sound.play();
        if (played && typeof played.catch === "function") played.catch(() => {});
      } catch (error) {
        // Keep gameplay independent from media playback failures.
      }
    }

    playMonsterHurt() {
      const audioVoice = { nodes: [], active: 0 };
      this.monsterHurtCount += 1;
      if (this.muted || !this.ctx || !this.sfxGain) return;
      try {
        const now = this.ctx.currentTime;
        const low = this.createVoiceNode(audioVoice, "createOscillator");
        const lowGain = this.createVoiceNode(audioVoice, "createGain");
        low.type = "sawtooth";
        low.frequency.setValueAtTime(185, now);
        low.frequency.exponentialRampToValueAtTime(62, now + 0.38);
        lowGain.gain.setValueAtTime(0.55, now);
        lowGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.44);
        low.connect(lowGain);
        lowGain.connect(this.sfxGain);
        low.start(now);
        low.stop(now + 0.46);

        const growl = this.createVoiceNode(audioVoice, "createOscillator");
        const growlGain = this.createVoiceNode(audioVoice, "createGain");
        growl.type = "square";
        growl.frequency.setValueAtTime(96, now + 0.02);
        growl.frequency.exponentialRampToValueAtTime(43, now + 0.32);
        growlGain.gain.setValueAtTime(0.22, now + 0.02);
        growlGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.36);
        growl.connect(growlGain);
        growlGain.connect(this.sfxGain);
        growl.start(now + 0.02);
        growl.stop(now + 0.38);

        this.noiseBurst(now, 0.18, 0.24, 620, "lowpass");
      } catch (error) {
        // Optional effect.
      }
    }

    playPlayerHurt() {
      const audioVoice = { nodes: [], active: 0 };
      this.playerHurtCount += 1;
      if (this.muted || !this.ctx || !this.sfxGain) return;
      try {
        const now = this.ctx.currentTime;
        const tone = this.createVoiceNode(audioVoice, "createOscillator");
        const gain = this.createVoiceNode(audioVoice, "createGain");
        tone.type = "square";
        tone.frequency.setValueAtTime(320, now);
        tone.frequency.exponentialRampToValueAtTime(120, now + 0.24);
        gain.gain.setValueAtTime(0.38, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);
        tone.connect(gain);
        gain.connect(this.sfxGain);
        tone.start(now);
        tone.stop(now + 0.3);

        const low = this.createVoiceNode(audioVoice, "createOscillator");
        const lowGain = this.createVoiceNode(audioVoice, "createGain");
        low.type = "triangle";
        low.frequency.setValueAtTime(160, now);
        low.frequency.exponentialRampToValueAtTime(70, now + 0.2);
        lowGain.gain.setValueAtTime(0.3, now);
        lowGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.24);
        low.connect(lowGain);
        lowGain.connect(this.sfxGain);
        low.start(now);
        low.stop(now + 0.26);

        this.noiseBurst(now, 0.14, 0.16, 1400, "bandpass");
      } catch (error) {
        // Optional effect.
      }
    }
  }

  globalThis.Wilds = Object.assign(globalThis.Wilds || {}, {
    AudioDirector,
    MUSIC_TRACKS: Object.keys(TRACKS).filter((name) => name !== "sad"),
  });
})();

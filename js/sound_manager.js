// Procedural sound effects, synthesized with the Web Audio API (no files).
// Every sound is built from a warm marimba-like "mallet" voice so the palette
// matches the wooden look of the board. Timings line up with the CSS:
// tiles slide for 100ms, then merged/new tiles pop in, and the end-of-game
// message fades in after 1200ms.

// Pentatonic major scale (semitones): any set of merges sounds consonant
SoundManager.SCALE = [0, 2, 4, 7, 9];

// Frequency of a "2" tile (G4); each doubling climbs one scale step
SoundManager.BASE_FREQ = 392;

// Upper limit for tile pitches so huge tiles don't turn shrill
SoundManager.MAX_FREQ = 3000;

// Tiles at or above this value get an extra shimmering octave layer
SoundManager.BRIGHT_VALUE = 256;

// Seconds, mirrored from style/main.css (--slide and the .game-message
// fade-in delay)
SoundManager.SLIDE_TIME   = 0.11;
SoundManager.MESSAGE_TIME = 0.7;

// Merge chord: max simultaneous notes, gap between them, per-note level
SoundManager.MAX_CHORD  = 4;
SoundManager.STRUM      = 0.022;
SoundManager.MERGE_GAIN = 0.32;

// Max sounding voices; low-priority sounds are dropped above this
SoundManager.MAX_VOICES = 24;

// Minimum gap (s) between two "blocked" thuds, so held keys don't spam
SoundManager.BLOCKED_GAP = 0.15;

// Stereo spread of the board columns (-0.5 left edge .. 0.5 right edge)
SoundManager.PAN_WIDTH = 0.5;

// Master output level when not muted
SoundManager.MASTER_GAIN = 0.8;

// Pitch and level ranges for the per-hit random variation
SoundManager.DETUNE_CENTS = 6;
SoundManager.GAIN_DB      = 1;

// Ratio of the marimba's characteristic second partial
SoundManager.PARTIAL_RATIO = 3.93;

// Small scheduling lookahead so nothing is scheduled in the past
SoundManager.LOOKAHEAD = 0.01;

// Silence floor for exponential envelopes (they can't reach 0)
SoundManager.SILENCE = 0.0001;

// Creates the manager; columns is the board width (used for stereo panning).
// The AudioContext is created lazily on the first sound, which always
// happens inside a key/touch/click handler, so autoplay rules are satisfied.
function SoundManager(columns) {
  this.columns     = columns;
  this.muted       = false;
  this.ctx         = null;
  this.unsupported = false;
  this.voices      = 0;
  this.lastBlocked = -Infinity;
}

// Mutes or unmutes all sound. With announce set, unmuting plays a short
// confirmation tick (muting is silent by definition).
SoundManager.prototype.setMuted = function (muted, announce) {
  this.muted = muted;

  // Cut (or restore) any sound that is still ringing
  if (this.ctx) {
    var level = muted ? 0 : SoundManager.MASTER_GAIN;
    this.master.gain.setTargetAtTime(level, this.ctx.currentTime, 0.015);
  }

  // Wait for the master level to come back before confirming
  if (!muted && announce && this.ready()) {
    this.tick(this.now() + 0.05, 1200, 0.08, 0);
  }
};

// Sound of a move that changed the board.
// summary: { direction, movedCount, merges: [{ value, x, y }], spawned,
//            milestone, newBest, won, over, comboLevel, charged }
SoundManager.prototype.move = function (summary) {
  if (!this.ready()) return;

  var start   = this.now();
  var landing = start + SoundManager.SLIDE_TIME;

  // Step 1: the slide itself
  this.swish(summary.direction, summary.movedCount, start);

  // Step 2: merges ring out when the merged tiles pop in; a long combo
  // lifts the whole chord so the streak is heard
  var sparkleAt = landing;
  if (summary.merges.length) {
    var chord = this.mergeChord(summary.merges, landing,
                                summary.comboLevel || 0);
    sparkleAt = chord.end;

    // A triple (or bigger) merge earns a bell on top of the strum
    if (summary.merges.length >= 3) {
      this.bell(chord.topFreq * 2, chord.end + 0.02, 0.12);
    }
  }

  // Step 3: first time reaching a new big tile
  if (summary.milestone) {
    this.arpeggio(this.noteFor(summary.milestone), sparkleAt + 0.09);
    sparkleAt += 0.3;
  }

  // Step 4: the new tile appears together with the merges
  if (summary.spawned) {
    this.spawn(summary.spawned, landing + 0.01);
  }

  // Step 5: beating the best score (once per game)
  if (summary.newBest) {
    this.sparkle(sparkleAt + 0.05);
    sparkleAt += 0.15;
  }

  // Step 6: the energy bar just filled up
  if (summary.charged) {
    this.energyFull(sparkleAt + 0.08);
  }

  // Step 7: end-of-game moments
  if (summary.won) {
    this.win(landing + 0.1);
  }
  if (summary.over) {
    this.gameOver(start + SoundManager.MESSAGE_TIME);
  }
};

// Dull thud for an action that did nothing (a move into a wall, or an
// item that can't be used); throttled for held keys
SoundManager.prototype.blocked = function () {
  if (!this.ready()) return;

  var now = this.now();
  if (now - this.lastBlocked < SoundManager.BLOCKED_GAP) return;
  this.lastBlocked = now;

  var voice = this.voice({ wet: 0.04 });
  if (!voice) return;

  this.osc(voice, {
    freq: 140, endFreq: 90, when: now,
    attack: 0.004, duration: 0.07, gain: 0.18
  });
  this.noise(voice, {
    when: now, attack: 0.002, duration: 0.03, gain: 0.03,
    filter: { type: "lowpass", from: 600, to: 300, Q: 0.7 }
  });
  this.seal(voice);
};

// "Clear tiles": a downward suction sweep plus a descending pluck for each
// removed tile (tiles: the removed tiles, with their positions)
SoundManager.prototype.clear = function (tiles) {
  if (!this.ready()) return;

  var self  = this;
  var now   = this.now();
  var voice = this.voice({ wet: 0.2 });

  // Step 1: the suction sweep
  if (voice) {
    this.noise(voice, {
      when: now, attack: 0.03, duration: 0.25, gain: 0.2,
      filter: { type: "lowpass", from: 3000, to: 300, Q: 1.5 }
    });
    this.seal(voice);
  }

  // Step 2: one pluck per tile, highest first, each a step lower
  var sorted = tiles.slice().sort(function (a, b) {
    return b.value - a.value;
  });
  var level = 0.2 / Math.sqrt(Math.max(sorted.length, 1));

  sorted.forEach(function (tile, i) {
    var freq = self.noteFor(tile.value) * Math.pow(2, -2 * i / 12);
    self.mallet(freq, now + 0.04 + i * 0.03, {
      gain: level, decay: 0.18, pan: self.panFor(tile.x), wet: 0.18
    });
  });
};

// "Revive": a rising sweep and a major chord entering note by note
SoundManager.prototype.revive = function () {
  if (!this.ready()) return;

  var self  = this;
  var now   = this.now();
  var voice = this.voice({ wet: 0.25 });

  // Step 1: the rising sweep
  if (voice) {
    this.noise(voice, {
      when: now, attack: 0.35, duration: 0.25, gain: 0.15,
      filter: { type: "bandpass", from: 400, to: 3000, Q: 1.2 }
    });
    this.seal(voice);
  }

  // Step 2: G major (G4 B4 D5 G5) rising out of the sweep
  [0, 4, 7, 12].forEach(function (semis, i) {
    self.mallet(self.semitones(semis), now + 0.12 + i * 0.09, {
      gain: 0.22, decay: 0.9, pan: (i - 1.5) * 0.15, wet: 0.25
    });
  });
};

// New game: a light two-note chime, then the ticks of the starting tiles
SoundManager.prototype.restart = function (tiles) {
  if (!this.ready()) return;

  var self = this;
  var now  = this.now();

  this.mallet(this.semitones(12), now, { gain: 0.15, decay: 0.35 });
  this.mallet(this.semitones(19), now + 0.09, { gain: 0.15, decay: 0.45 });

  tiles.forEach(function (tile, i) {
    self.spawn(tile, now + 0.2 + i * 0.06);
  });
};

// "Keep going" after a win: a short, affirmative rising fifth
SoundManager.prototype.keepPlaying = function () {
  if (!this.ready()) return;

  var now = this.now();
  this.mallet(this.semitones(7), now, { gain: 0.15, decay: 0.3 });
  this.mallet(this.semitones(14), now + 0.08, { gain: 0.15, decay: 0.5 });
};

// Swap / hammer armed (on) or put away (off): a soft two-note blip,
// rising or falling
SoundManager.prototype.arm = function (on) {
  if (!this.ready()) return;

  var now   = this.now();
  var notes = on ? [12, 19] : [19, 12];

  this.mallet(this.semitones(notes[0]), now, { gain: 0.12, decay: 0.15 });
  this.mallet(this.semitones(notes[1]), now + 0.05,
              { gain: 0.12, decay: 0.2 });
};

// First tile picked for a swap: the tile's own note, quietly
SoundManager.prototype.pick = function (tile) {
  if (!this.ready()) return;

  this.mallet(this.noteFor(tile.value), this.now(), {
    gain: 0.15, decay: 0.25, pan: this.panFor(tile.x)
  });
};

// Undo: a falling sweep (the slide played backwards) and two falling notes
SoundManager.prototype.undo = function () {
  if (!this.ready()) return;

  var now   = this.now();
  var voice = this.voice({ wet: 0.15 });

  // Step 1: the falling sweep
  if (voice) {
    this.noise(voice, {
      when: now, attack: 0.08, duration: 0.18, gain: 0.25,
      filter: { type: "bandpass", from: 2600, to: 500, Q: 1.4 }
    });
    this.seal(voice);
  }

  // Step 2: D5 down to G4
  this.mallet(this.semitones(7), now + 0.08, { gain: 0.18, decay: 0.3 });
  this.mallet(this.semitones(0), now + 0.17, { gain: 0.18, decay: 0.45 });
};

// Swap: each tile ticks on its own side as they glide across; the game-over
// line follows when the swap left no move
SoundManager.prototype.swap = function (a, b, over) {
  if (!this.ready()) return;

  var now = this.now();

  this.mallet(this.noteFor(a.value), now, {
    gain: 0.16, decay: 0.3, pan: this.panFor(b.x)
  });
  this.mallet(this.noteFor(b.value), now + 0.07, {
    gain: 0.16, decay: 0.3, pan: this.panFor(a.x)
  });
  this.tick(now + 0.2, 1600, 0.12, 0);

  if (over) this.gameOver(now + SoundManager.MESSAGE_TIME);
};

// Hammer: a low thump and a burst of crackling shards
SoundManager.prototype.smash = function (tile) {
  if (!this.ready()) return;

  var now   = this.now();
  var pan   = this.panFor(tile.x);
  var voice = this.voice({ wet: 0.12, pan: pan });

  if (voice) {
    // Step 1: the thump
    this.osc(voice, {
      freq: 160, endFreq: 55, when: now,
      attack: 0.003, duration: 0.22, gain: 0.4
    });

    // Step 2: the shards
    this.noise(voice, {
      when: now + 0.01, attack: 0.002, duration: 0.2, gain: 0.3,
      filter: { type: "highpass", from: 3000, to: 1200, Q: 0.8 }
    });
    this.seal(voice);
  }

  // Step 3: the tile's note, cracked a semitone flat
  this.mallet(this.noteFor(tile.value) * Math.pow(2, -1 / 12), now + 0.02, {
    gain: 0.14, decay: 0.2, pan: pan, dark: true
  });
};

// Energy bar full: a quick rising arpeggio capped by a bell
SoundManager.prototype.energyFull = function (when) {
  var self = this;

  [12, 16, 19, 24].forEach(function (semis, i) {
    self.mallet(self.semitones(semis), when + i * 0.05, {
      gain: 0.14, decay: 0.3, wet: 0.25
    });
  });
  this.bell(this.semitones(36), when + 0.22, 0.08);
};

// Boss mode switched: a bright rising major triad with sparkles (on),
// or the same triad falling (off)
SoundManager.prototype.bossMode = function (on) {
  if (!this.ready()) return;

  var self  = this;
  var now   = this.now();
  var notes = on ? [0, 4, 7, 12, 16] : [12, 7, 4, 0];

  notes.forEach(function (semis, i) {
    self.mallet(self.semitones(semis), now + i * 0.07, {
      gain: 0.2, decay: 0.6, pan: (i - 2) * 0.12, wet: 0.3
    });
  });

  if (on) this.sparkle(now + notes.length * 0.07 + 0.05);
};

// ---------------------------------------------------------------------------
// Composite sounds

// Filtered-noise swish of the sliding tiles: vertical moves sweep the pitch
// up or down, horizontal moves glide across the stereo field
SoundManager.prototype.swish = function (direction, movedCount, when) {
  var side  = direction === 1 ? 1 : (direction === 3 ? -1 : 0);
  var voice = this.voice({ wet: 0.05, low: true, pan: 0 });
  if (!voice) return;

  // Step 1: more moving tiles make a slightly fuller swish (band-passed
  // noise loses most of its energy, hence the high raw level)
  var level = 0.42 * (0.8 + 0.4 * Math.min(movedCount, 8) / 8);

  // Step 2: pick the filter sweep (0 up, 1 right, 2 down, 3 left)
  var from = 1100, to = 1500;
  if (direction === 0) { from = 700;  to = 2200; }
  if (direction === 2) { from = 2200; to = 700; }

  // Step 3: horizontal moves glide toward their side
  if (voice.panner && side) {
    voice.panner.pan.setValueAtTime(-side * 0.1, when);
    voice.panner.pan.linearRampToValueAtTime(side * 0.35, when + 0.09);
  }

  this.noise(voice, {
    when: when, attack: 0.015, duration: 0.075, gain: level,
    filter: { type: "bandpass", from: from, to: to, Q: 1.1 }
  });
  this.seal(voice);
};

// Plays the merges of one move as a quick upward strum, lifted by a whole
// tone per combo level. Returns { end, topFreq } so follow-up sounds can be
// placed after it.
SoundManager.prototype.mergeChord = function (merges, when, comboLevel) {
  var self  = this;
  var lift  = Math.pow(2, 2 * comboLevel / 12);

  // Step 1: keep the highest notes, ordered low to high
  var notes = merges.slice().sort(function (a, b) {
    return a.value - b.value;
  }).slice(-SoundManager.MAX_CHORD);

  // Step 2: keep the total loudness steady however many notes there are
  var level = SoundManager.MERGE_GAIN / Math.sqrt(notes.length);
  var top   = 0;

  // Step 3: strum; bigger tiles ring longer, and big ones shimmer
  notes.forEach(function (merge, i) {
    var freq   = Math.min(self.noteFor(merge.value) * lift,
                          SoundManager.MAX_FREQ);
    var step   = self.stepFor(merge.value);
    var at     = when + i * SoundManager.STRUM;
    var pan    = self.panFor(merge.x);
    var bright = merge.value >= SoundManager.BRIGHT_VALUE;

    self.mallet(freq, at, {
      gain: level, decay: 0.35 + 0.06 * step, pan: pan,
      wet: bright ? 0.28 : 0.14
    });

    if (bright) {
      self.mallet(freq * 2, at, {
        gain: level * 0.35, decay: 1.1, pan: pan, wet: 0.35
      });
    }

    top = freq;
  });

  return {
    end:     when + (notes.length - 1) * SoundManager.STRUM,
    topFreq: top
  };
};

// Rising major arpeggio above a freshly reached big tile
// (the tile's own note has just sounded as the root)
SoundManager.prototype.arpeggio = function (root, when) {
  var self = this;

  [4, 7, 12].forEach(function (semis, i) {
    var freq = Math.min(root * Math.pow(2, semis / 12),
                        SoundManager.MAX_FREQ);
    self.mallet(freq, when + i * 0.06, {
      gain: 0.18, decay: 0.3, wet: 0.22
    });
  });
};

// Two bright glints for a new best score
SoundManager.prototype.sparkle = function (when) {
  this.bell(2637, when, 0.1);        // E7
  this.bell(3136, when + 0.07, 0.1); // G7
};

// Soft wooden tick of a newly spawned tile; a 4 sounds a fourth lower
SoundManager.prototype.spawn = function (tile, when) {
  var isFour = tile.value > 2;
  var freq   = isFour ? 1600 * Math.pow(2, -5 / 12) : 1600;
  var level  = isFour ? 0.16 : 0.13;

  this.tick(when, freq, level, this.panFor(tile.x));
};

// Win (the 2048 tile): a mallet fanfare over a slowly opening pad,
// with a few sparkles scattered on top
SoundManager.prototype.win = function (when) {
  var self = this;

  // Step 1: fanfare G5 B5 D6 G6 B6
  [12, 16, 19, 24, 28].forEach(function (semis, i) {
    self.mallet(self.semitones(semis), when + i * 0.07, {
      gain: 0.3, decay: 0.9, pan: (i - 2) * 0.12, wet: 0.3
    });
  });

  // Step 2: detuned sawtooth pad (G4 D5 G5) through an opening low-pass
  var padStart = when + 0.25;
  var voice = this.voice({
    wet: 0.35, filter: { type: "lowpass", frequency: 400, Q: 0.8 }
  });

  if (voice) {
    var cutoff = voice.filter.frequency;
    cutoff.setValueAtTime(400, padStart);
    cutoff.exponentialRampToValueAtTime(2400, padStart + 0.8);
    cutoff.exponentialRampToValueAtTime(900, padStart + 1.6);

    [0, 7, 12].forEach(function (semis) {
      [-8, 8].forEach(function (cents) {
        self.osc(voice, {
          type: "sawtooth", freq: self.semitones(semis), detune: cents,
          when: padStart, attack: 0.4, duration: 1.2, gain: 0.028
        });
      });
    });
    this.seal(voice);
  }

  // Step 3: sparkles scattered over the pad
  for (var i = 0; i < 6; i++) {
    this.bell(2000 + Math.random() * 1200,
              padStart + 0.1 + Math.random() * 1.1, 0.04);
  }
};

// Game over: a soft, darker descending minor line (D5 Bb4 G4) with a low G
// underneath, timed with the game-over message fading in
SoundManager.prototype.gameOver = function (when) {
  var self = this;

  [7, 3, 0].forEach(function (semis, i) {
    self.mallet(self.semitones(semis), when + i * 0.28, {
      gain: 0.3, decay: i === 2 ? 2 : 1.2, wet: 0.3, dark: true
    });
  });

  var voice = this.voice({ wet: 0.3 });
  if (voice) {
    this.osc(voice, {
      freq: this.semitones(-12), when: when + 0.56,
      attack: 0.05, duration: 2, gain: 0.12
    });
    this.seal(voice);
  }
};

// Bell-like ping (inharmonic 2.76x partial), used for glints and accents
SoundManager.prototype.bell = function (freq, when, level) {
  var voice = this.voice({ wet: 0.3, low: true });
  if (!voice) return;

  freq = Math.min(freq, SoundManager.MAX_FREQ * 1.1);

  this.osc(voice, {
    freq: freq, when: when, attack: 0.002, duration: 0.6,
    gain: level, detune: this.jitterCents()
  });
  this.osc(voice, {
    freq: freq * 2.76, when: when, attack: 0.002, duration: 0.15,
    gain: level * 0.3
  });
  this.seal(voice);
};

// Very short sine tick (spawn ticks and the unmute confirmation)
SoundManager.prototype.tick = function (when, freq, level, pan) {
  var voice = this.voice({ wet: 0.06, low: true, pan: pan });
  if (!voice) return;

  this.osc(voice, {
    freq: freq, when: when, attack: 0.002, duration: 0.035,
    gain: level * this.jitterGain(), detune: this.jitterCents()
  });
  this.seal(voice);
};

// ---------------------------------------------------------------------------
// Instruments

// Struck-bar voice: a sine fundamental, the marimba's fast-decaying 3.93x
// partial and a tiny noise click for the mallet hit.
// opts: { gain, decay, pan, wet, dark, low }
SoundManager.prototype.mallet = function (freq, when, opts) {
  var dark  = !!opts.dark;
  var voice = this.voice({
    pan: opts.pan, wet: opts.wet, low: opts.low,
    filter: dark ? { type: "lowpass", frequency: 1400, Q: 0.5 } : null
  });
  if (!voice) return;

  var level  = (opts.gain || 0.3) * this.jitterGain();
  var decay  = opts.decay || 0.5;
  var detune = this.jitterCents();

  // Step 1: fundamental
  this.osc(voice, {
    freq: freq, detune: detune, when: when,
    attack: 0.003, duration: decay, gain: level
  });

  // Step 2: overtone, decaying about three times faster (skipped when it
  // would land in the harsh top octave)
  var partial = freq * SoundManager.PARTIAL_RATIO;
  if (partial < 12000) {
    this.osc(voice, {
      freq: partial, detune: detune, when: when,
      attack: 0.002, duration: decay / 3,
      gain: level * (dark ? 0.12 : 0.25)
    });
  }

  // Step 3: the hit transient
  this.noise(voice, {
    when: when, attack: 0.001, duration: 0.008, gain: level * 0.3,
    filter: { type: "highpass", from: 2000, to: 2000, Q: 0.7 }
  });

  this.seal(voice);
};

// ---------------------------------------------------------------------------
// Building blocks

// Opens a voice: input gain -> optional filter -> optional panner -> mix,
// with an optional reverb send. Returns null when the voice budget is
// exhausted and the sound is low priority.
// opts: { pan, wet, low, filter: { type, frequency, Q } }
SoundManager.prototype.voice = function (opts) {
  var ctx = this.ctx;

  if (opts.low && this.voices >= SoundManager.MAX_VOICES) return null;

  var voice = { nodes: [], last: null, end: 0, filter: null, panner: null };
  var input = ctx.createGain();
  var tail  = input;
  voice.input = input;
  voice.nodes.push(input);

  // Step 1: optional tone-shaping filter
  if (opts.filter) {
    var filter = ctx.createBiquadFilter();
    filter.type            = opts.filter.type;
    filter.frequency.value = opts.filter.frequency;
    filter.Q.value         = opts.filter.Q;
    tail.connect(filter);
    tail = voice.filter = filter;
    voice.nodes.push(filter);
  }

  // Step 2: stereo position (skipped where StereoPanner is unsupported)
  if (opts.pan !== undefined && ctx.createStereoPanner) {
    var panner = ctx.createStereoPanner();
    panner.pan.value = opts.pan;
    tail.connect(panner);
    tail = voice.panner = panner;
    voice.nodes.push(panner);
  }

  // Step 3: dry signal plus reverb send
  tail.connect(this.dry);
  if (opts.wet) {
    var send = ctx.createGain();
    send.gain.value = opts.wet;
    tail.connect(send);
    send.connect(this.reverb);
    voice.nodes.push(send);
  }

  this.voices++;
  return voice;
};

// Adds an enveloped oscillator to a voice.
// opts: { type, freq, endFreq, detune, when, attack, duration, gain }
SoundManager.prototype.osc = function (voice, opts) {
  var ctx  = this.ctx;
  var osc  = ctx.createOscillator();
  var amp  = ctx.createGain();
  var stop = opts.when + opts.attack + opts.duration;

  osc.type = opts.type || "sine";
  osc.frequency.setValueAtTime(opts.freq, opts.when);
  if (opts.endFreq) {
    osc.frequency.exponentialRampToValueAtTime(opts.endFreq, stop);
  }
  if (opts.detune) osc.detune.value = opts.detune;

  this.envelope(amp.gain, opts.when, opts.attack, opts.duration, opts.gain);

  osc.connect(amp);
  amp.connect(voice.input);
  this.schedule(voice, osc, opts.when, stop);
};

// Adds an enveloped, filtered noise burst to a voice; the filter frequency
// glides from filter.from to filter.to over the burst.
// opts: { when, attack, duration, gain, filter: { type, from, to, Q } }
SoundManager.prototype.noise = function (voice, opts) {
  var ctx    = this.ctx;
  var source = ctx.createBufferSource();
  var filter = ctx.createBiquadFilter();
  var amp    = ctx.createGain();
  var stop   = opts.when + opts.attack + opts.duration;

  source.buffer = this.noiseBuffer;
  source.loop   = true;

  filter.type    = opts.filter.type;
  filter.Q.value = opts.filter.Q;
  filter.frequency.setValueAtTime(opts.filter.from, opts.when);
  if (opts.filter.to !== opts.filter.from) {
    filter.frequency.exponentialRampToValueAtTime(opts.filter.to, stop);
  }

  this.envelope(amp.gain, opts.when, opts.attack, opts.duration, opts.gain);

  source.connect(filter);
  filter.connect(amp);
  amp.connect(voice.input);

  // Start at a random point of the buffer so bursts never repeat exactly
  this.schedule(voice, source, opts.when, stop, Math.random() * 0.5);
};

// Linear attack to peak, then exponential decay to silence
SoundManager.prototype.envelope = function (param, when, attack, duration,
                                            peak) {
  param.value = 0;
  param.setValueAtTime(0, when);
  param.linearRampToValueAtTime(peak, when + attack);
  param.exponentialRampToValueAtTime(SoundManager.SILENCE,
                                     when + attack + duration);
};

// Starts/stops a source and remembers the one that ends last, so the voice
// can be cleaned up when it finishes
SoundManager.prototype.schedule = function (voice, source, when, stop,
                                            offset) {
  source.start(when, offset || 0);
  source.stop(stop + 0.02);

  if (stop >= voice.end) {
    voice.end  = stop;
    voice.last = source;
  }
};

// Closes a voice: once its last source ends, disconnect all of its nodes
// and give the slot back to the voice budget
SoundManager.prototype.seal = function (voice) {
  var self = this;

  var release = function () {
    self.voices--;
    voice.nodes.forEach(function (node) {
      node.disconnect();
    });
  };

  if (voice.last) {
    voice.last.onended = release;
  } else {
    release();
  }
};

// ---------------------------------------------------------------------------
// Audio graph and helpers

// Whether sounds should play now (not muted, and Web Audio is available)
SoundManager.prototype.ready = function () {
  return !this.muted && this.ensureContext();
};

// Creates the AudioContext and the shared graph on first use:
// voices -> dry / reverb -> compressor -> master -> speakers.
// Returns false if the browser has no Web Audio support.
SoundManager.prototype.ensureContext = function () {
  if (this.ctx) {
    // Browsers may suspend the context until a user gesture
    if (this.ctx.state === "suspended") this.ctx.resume();
    return true;
  }
  if (this.unsupported) return false;

  var AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) {
    this.unsupported = true;
    return false;
  }

  var ctx = this.ctx = new AudioContext();

  // Step 1: master level and a gentle compressor against clipping
  this.master = ctx.createGain();
  this.master.gain.value = SoundManager.MASTER_GAIN;
  this.master.connect(ctx.destination);

  var compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = -14;
  compressor.knee.value      = 6;
  compressor.ratio.value     = 4;
  compressor.attack.value    = 0.003;
  compressor.release.value   = 0.12;
  compressor.connect(this.master);

  // Step 2: dry bus and a small, generated room reverb
  this.dry = ctx.createGain();
  this.dry.connect(compressor);

  this.reverb = ctx.createConvolver();
  this.reverb.buffer = this.createImpulse(1.1);
  this.reverb.connect(compressor);

  // Step 3: one second of white noise, shared by all noise bursts
  this.noiseBuffer = this.createNoise(1);

  if (ctx.state === "suspended") ctx.resume();
  return true;
};

// White noise buffer of the given length (seconds)
SoundManager.prototype.createNoise = function (seconds) {
  var length = Math.floor(this.ctx.sampleRate * seconds);
  var buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
  var data   = buffer.getChannelData(0);

  for (var i = 0; i < length; i++) {
    data[i] = Math.random() * 2 - 1;
  }

  return buffer;
};

// Stereo impulse response for the reverb: decaying noise, independent per
// channel so the tail feels wide
SoundManager.prototype.createImpulse = function (seconds) {
  var rate   = this.ctx.sampleRate;
  var length = Math.floor(rate * seconds);
  var buffer = this.ctx.createBuffer(2, length, rate);

  for (var channel = 0; channel < 2; channel++) {
    var data = buffer.getChannelData(channel);
    for (var i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 3);
    }
  }

  return buffer;
};

// Current audio time plus a small lookahead
SoundManager.prototype.now = function () {
  return this.ctx.currentTime + SoundManager.LOOKAHEAD;
};

// Scale step of a tile value: 2 -> 0, 4 -> 1, ..., 2048 -> 10
SoundManager.prototype.stepFor = function (value) {
  return Math.round(Math.log(value) / Math.LN2) - 1;
};

// Pitch of a tile value: one pentatonic step per doubling, from G4 (2)
// up to G6 (2048), capped at MAX_FREQ
SoundManager.prototype.noteFor = function (value) {
  var scale  = SoundManager.SCALE;
  var step   = this.stepFor(value);
  var octave = Math.floor(step / scale.length);
  var degree = scale[step - octave * scale.length];

  return Math.min(this.semitones(octave * 12 + degree),
                  SoundManager.MAX_FREQ);
};

// Frequency the given number of semitones above G4
SoundManager.prototype.semitones = function (semis) {
  return SoundManager.BASE_FREQ * Math.pow(2, semis / 12);
};

// Stereo position of a board column
SoundManager.prototype.panFor = function (x) {
  if (this.columns < 2) return 0;
  return (x / (this.columns - 1) * 2 - 1) * SoundManager.PAN_WIDTH;
};

// Random detune (cents) so repeated hits never sound identical
SoundManager.prototype.jitterCents = function () {
  return (Math.random() * 2 - 1) * SoundManager.DETUNE_CENTS;
};

// Random level factor of about +/-1dB
SoundManager.prototype.jitterGain = function () {
  var db = (Math.random() * 2 - 1) * SoundManager.GAIN_DB;
  return Math.pow(10, db / 20);
};

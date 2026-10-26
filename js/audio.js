/**
 * GARTIC BANDE — moteur audio (Tone.js).
 *
 * Principe : UNE SEULE séquence Tone.Sequence, créée une fois pour toutes, qui
 * « tique » à chaque colonne de la grille. À chaque tic, on relit l'état courant
 * des pistes et on joue les notes de la colonne. Conséquences :
 *   - toutes les pistes partagent la même horloge (aucune désynchronisation) ;
 *   - modifier une note pendant la lecture est pris en compte immédiatement ;
 *   - on ne recrée jamais de boucle : pas de doublons ni de timers qui s'accumulent.
 *
 * Chaque piste possède un « runtime » (instrument + canal de mixage) créé et
 * détruit par syncTracks(), ce qui évite toute fuite de ressources audio.
 *
 * Durée des notes : chaque note est jouée avec un note-on ET un note-off programmés ensemble
 * sur l'horloge audio (triggerAttackRelease sur une voix monophonique). Rien ne dépend d'un
 * timer du navigateur : après un arrêt, aucune note-off « périmée » ne peut couper une note
 * jouée plus tard, et aucune note ne reste bloquée.
 */
(function (GB) {
  'use strict';

  const { CONFIG } = GB;

  /** Délai pendant lequel le son reste coupé après Stop/Pause (couvre les notes déjà programmées). */
  const SILENCE_HOLD_MS = 250;
  const SUB = 4; // événements de la séquence par colonne (au quart de temps)
  let cursor = 0; // position de départ choisie (en colonnes, multiple de ¼) : la barre de lecture revient ici à l'arrêt

  let master = null;
  let sequence = null;
  let loopHook = null; // appelé au début de chaque boucle, avant de lire les notes (révélations)
  let status = 'stopped'; // 'stopped' | 'playing' | 'paused'
  // Démarrage asynchrone : play() attend Tone.start(). `playToken` change à chaque play/pause/stop : une reprise qui n'est plus
  // la dernière demande s'abandonne (jamais deux démarrages). `engaged` = le Transport tourne VRAIMENT (sinon sa position est périmée).
  let playToken = 0;
  let engaged = false;
  let silenced = false;
  let silenceTimer = null;
  let onStatusChange = () => {};
  const runtimes = new Map(); // trackId -> { instrumentId, instrument, channel }

  /* ------------------------------------------------------------------ */
  /*  Fabrique d'instruments                                             */
  /* ------------------------------------------------------------------ */

  /**
   * Chaque fabrique renvoie { play(row, time, durationSeconds), dispose() }
   * et se branche sur `output`.
   */

  /** Nombre maximal de notes simultanées par piste (assez pour un accord sur toutes les lignes). */
  const MAX_VOICES = 16;

  /**
   * Instrument mélodique = réserve de voix monophoniques (une voix par note qui sonne).
   * Une voix redevient disponible quand sa note, relâchement compris, est terminée.
   */
  function createVoiceInstrument(instrumentId, output, VoiceClass, voiceOptions, releaseSeconds, filterFrequency, noteOf) {
    const voices = []; // { synth, freeAt, lastStart }
    const nodes = [];
    let sink = output;
    if (filterFrequency) {
      const filter = new Tone.Filter(filterFrequency, 'lowpass');
      filter.connect(output);
      nodes.push(filter);
      sink = filter;
    }
    const noteName = noteOf || ((row) => GB.getToneNote(instrumentId, row));

    function acquireVoice(time) {
      let voice = voices.find((candidate) => candidate.freeAt <= time);
      if (!voice && voices.length < MAX_VOICES) {
        const synth = new VoiceClass(voiceOptions);
        synth.connect(sink);
        voice = { synth, freeAt: 0, lastStart: 0 };
        voices.push(voice);
      }
      // Toutes les voix sont occupées : on réutilise celle qui sera libre en premier.
      return voice || voices.reduce((a, b) => (a.freeAt <= b.freeAt ? a : b));
    }

    return {
      play(row, time, duration) {
        const voice = acquireVoice(time);
        // Tone refuse deux départs au même instant sur une même voix : on force l'ordre strict.
        const start = Math.max(time, voice.lastStart + 0.001);
        voice.synth.triggerAttackRelease(noteName(row), duration, start, 0.85);
        voice.lastStart = start;
        voice.freeAt = start + duration + releaseSeconds;
      },
      dispose() {
        voices.forEach((voice) => voice.synth.dispose());
        nodes.forEach((node) => node.dispose());
      },
    };
  }

  function createPiano(output) {
    return createVoiceInstrument(
      'piano',
      output,
      Tone.Synth,
      {
        oscillator: { type: 'triangle' },
        envelope: { attack: 0.005, decay: 0.45, sustain: 0.12, release: 1.1 },
      },
      1.1,
      4200
    );
  }

  function createSoftSynth(output) {
    return createVoiceInstrument(
      'synth',
      output,
      Tone.Synth,
      {
        oscillator: { type: 'fatsawtooth', count: 3, spread: 22 },
        envelope: { attack: 0.18, decay: 0.3, sustain: 0.65, release: 1.3 },
      },
      1.3,
      1500
    );
  }

  function createBass(output) {
    return createVoiceInstrument(
      'bass',
      output,
      Tone.MonoSynth,
      {
        oscillator: { type: 'sawtooth' },
        envelope: { attack: 0.01, decay: 0.25, sustain: 0.45, release: 0.3 },
        filter: { type: 'lowpass', Q: 2, rolloff: -24 },
        filterEnvelope: { attack: 0.01, decay: 0.2, sustain: 0.25, release: 0.3, baseFrequency: 140, octaves: 2.6 },
      },
      0.3
    );
  }

  function createLead(output) {
    return createVoiceInstrument(
      'lead',
      output,
      Tone.Synth,
      {
        oscillator: { type: 'square' },
        envelope: { attack: 0.005, decay: 0.12, sustain: 0.3, release: 0.2 },
      },
      0.2
    );
  }

  /**
   * Batterie : un petit synthé par « pad ». Les synthés monophoniques refusent deux
   * déclenchements au même instant : on force donc des dates strictement croissantes.
   */
  function createDrums(output) {
    const nodes = [];
    const lastTimes = {};

    function track(node) {
      nodes.push(node);
      return node;
    }
    function filtered(synth, type, frequency, Q) {
      const filter = track(new Tone.Filter({ type, frequency, Q: Q || 1 }));
      track(synth).connect(filter);
      filter.connect(output);
      return synth;
    }
    function strictlyAfter(padId, time) {
      const safeTime = Math.max(time, (lastTimes[padId] || 0) + 0.002);
      lastTimes[padId] = safeTime;
      return safeTime;
    }

    const kick = track(
      new Tone.MembraneSynth({
        pitchDecay: 0.04,
        octaves: 6,
        envelope: { attack: 0.001, decay: 0.32, sustain: 0, release: 0.1 },
      })
    );
    kick.connect(output);
    const tomLow = track(
      new Tone.MembraneSynth({
        pitchDecay: 0.06,
        octaves: 2.5,
        envelope: { attack: 0.001, decay: 0.3, sustain: 0, release: 0.1 },
      })
    );
    tomLow.connect(output);
    const tomHigh = track(
      new Tone.MembraneSynth({
        pitchDecay: 0.05,
        octaves: 2.5,
        envelope: { attack: 0.001, decay: 0.22, sustain: 0, release: 0.1 },
      })
    );
    tomHigh.connect(output);

    const snare = filtered(
      new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.17, sustain: 0 }, volume: -4 }),
      'highpass',
      1400
    );
    const hatClosed = filtered(
      new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.045, sustain: 0 }, volume: -12 }),
      'highpass',
      7500
    );
    const hatOpen = filtered(
      new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.28, sustain: 0 }, volume: -13 }),
      'highpass',
      7000
    );
    const clap = filtered(
      new Tone.NoiseSynth({ noise: { type: 'pink' }, envelope: { attack: 0.002, decay: 0.13, sustain: 0 }, volume: -3 }),
      'bandpass',
      1700,
      1.2
    );
    const crash = filtered(
      new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: 1.1, sustain: 0 }, volume: -16 }),
      'highpass',
      5200
    );

    const pads = {
      kick: (time) => kick.triggerAttackRelease('C1', 0.25, time, 0.95),
      snare: (time) => snare.triggerAttackRelease(0.2, time, 0.9),
      hatClosed: (time) => hatClosed.triggerAttackRelease(0.05, time, 0.8),
      hatOpen: (time) => hatOpen.triggerAttackRelease(0.3, time, 0.8),
      clap: (time) => clap.triggerAttackRelease(0.15, time, 0.9),
      tomLow: (time) => tomLow.triggerAttackRelease('G1', 0.3, time, 0.9),
      tomHigh: (time) => tomHigh.triggerAttackRelease('D2', 0.25, time, 0.9),
      crash: (time) => crash.triggerAttackRelease(1.2, time, 0.8),
    };

    return {
      play(row, time) {
        const pad = GB.DRUM_PADS[row];
        if (!pad) return; // ligne qui n'existe pas pour la batterie : ignorée
        pads[pad.id](strictlyAfter(pad.id, time));
      },
      dispose() {
        nodes.forEach((node) => node.dispose());
      },
    };
  }

  /* ------------------------------------------------------------------ */
  /*  Effets partagés (écho, réverbération)                              */
  /* ------------------------------------------------------------------ */

  const impulseCache = new Map();

  /** Réponse impulsionnelle synthétique (bruit qui décroît) : construite sur-le-champ, sans chargement. */
  function getImpulse(seconds) {
    const key = seconds.toFixed(2);
    if (!impulseCache.has(key)) {
      const context = Tone.getContext().rawContext;
      const length = Math.floor(context.sampleRate * seconds);
      const buffer = context.createBuffer(2, length, context.sampleRate);
      for (let channel = 0; channel < 2; channel += 1) {
        const data = buffer.getChannelData(channel);
        let seed = 12345 + channel * 977; // bruit déterministe : même réverbération à chaque lecture
        for (let index = 0; index < length; index += 1) {
          seed = (seed * 1664525 + 1013904223) >>> 0;
          const noise = seed / 2147483648 - 1;
          data[index] = noise * Math.pow(1 - index / length, 2.6);
        }
      }
      impulseCache.set(key, buffer);
    }
    return impulseCache.get(key);
  }

  /**
   * Chaîne d'effets : entrée -> écho -> réverbération -> sortie. Renvoie le nœud d'entrée et la liste
   * des nœuds à détruire. Sans effet demandé, l'entrée est la sortie elle-même.
   */
  function buildEffects(output, { echo, reverb }) {
    const nodes = [];
    let head = output;
    if (reverb > 0.001) {
      const input = new Tone.Gain(1);
      const mix = new Tone.Gain(1);
      const wet = new Tone.Gain(Math.min(1, reverb) * 0.9);
      const convolver = new Tone.Convolver({ url: getImpulse(0.6 + reverb * 1.6), normalize: true });
      input.connect(mix);
      input.connect(convolver);
      convolver.connect(wet);
      wet.connect(mix);
      mix.connect(head);
      nodes.push(input, mix, wet, convolver);
      head = input;
    }
    if (echo > 0.001) {
      const delay = new Tone.FeedbackDelay({ delayTime: Tone.Time('8n').toSeconds(), feedback: 0.25 + echo * 0.3, wet: Math.min(1, echo) * 0.6 });
      delay.connect(head);
      nodes.push(delay);
      head = delay;
    }
    return { input: head, nodes };
  }

  /* ------------------------------------------------------------------ */
  /*  Moteurs réglables : voix synthétique, instruments personnalisés    */
  /* ------------------------------------------------------------------ */

  /** Formants (fréquence, largeur Q, gain) de chaque voyelle : les « résonances » du conduit vocal. */
  const FORMANTS = {
    a: [[800, 7, 1], [1150, 9, 0.6], [2800, 12, 0.3]],
    e: [[400, 7, 1], [1600, 9, 0.6], [2700, 12, 0.3]],
    i: [[350, 7, 1], [1700, 9, 0.6], [2700, 12, 0.35]],
    o: [[450, 7, 1], [800, 9, 0.6], [2830, 12, 0.25]],
    u: [[280, 7, 1], [1850, 9, 0.55], [2450, 12, 0.3]], // « u » français [y] : bouche en « ou » mais langue en avant
    ou: [[325, 7, 1], [700, 9, 0.5], [2530, 12, 0.2]], // « ou » [u]
  };

  /**
   * Voix synthétique (moteur « formant ») : une source en dents de scie (le « larynx ») passe dans trois
   * filtres de voyelle, avec vibrato, effet robot (modulation en anneau) et brillance réglables.
   * Ce n'est PAS une voix qui chante des paroles : c'est un timbre vocal électronique.
   * Un moteur de voix chantée plus avancé pourra remplacer celui-ci via audio.registerEngine().
   */
  function createFormantVoice(output, settings, meta) {
    const nodes = [];
    const keep = (node) => {
      nodes.push(node);
      return node;
    };
    const tone = keep(new Tone.Filter({ type: 'lowpass', frequency: 1800 + settings.brightness * 6500, Q: 0.5 }));
    tone.connect(output);

    const crossFade = keep(new Tone.CrossFade(settings.robot));
    crossFade.connect(tone);

    const sum = keep(new Tone.Gain(3));
    sum.connect(crossFade.a);
    const ring = keep(new Tone.Gain(0)); // le gain suit l'oscillateur : modulation en anneau
    const carrier = keep(new Tone.Oscillator(58, 'sine'));
    carrier.connect(ring.gain);
    carrier.start(Tone.immediate()); // temps explicite : le moteur peut être créé depuis un callback planifié (révélation)
    sum.connect(ring);
    ring.connect(crossFade.b);

    // Chaque voyelle a SA banque de trois filtres (les résonances du conduit vocal), créée à la demande, et sa propre
    // réserve de voix : une note de la piste choisit donc sa voyelle, indépendamment des autres. Les banques se
    // rejoignent dans `sum`, puis le vibrato (ligne à retard dont le délai oscille : la hauteur « tremble »).
    // Construit à la main pour démarrer l'oscillateur à un temps explicite (révélation, lecture en cours).
    let bus;
    if (settings.vibrato > 0.01) {
      const depth = settings.vibrato * 0.0025;
      bus = keep(new Tone.Delay({ delayTime: 0.004, maxDelay: 0.02 }));
      const wobble = keep(new Tone.LFO({ frequency: 5.5, min: 0.004 - depth, max: 0.004 + depth }));
      wobble.connect(bus.delayTime);
      wobble.start(Tone.immediate());
    } else {
      bus = keep(new Tone.Gain(1));
    }
    sum.disconnect();
    sum.connect(bus);
    bus.connect(crossFade.a);
    bus.connect(ring);

    const noteName = (row) => GB.getToneNote('piano', row, settings);
    const pools = {};
    function poolFor(vowel) {
      const key = FORMANTS[vowel] ? vowel : FORMANTS[settings.vowel] ? settings.vowel : 'a';
      if (!pools[key]) {
        const input = keep(new Tone.Gain(1));
        FORMANTS[key].forEach(([frequency, Q, gain]) => {
          const filter = keep(new Tone.Filter({ type: 'bandpass', frequency, Q }));
          const level = keep(new Tone.Gain(gain));
          input.connect(filter);
          filter.connect(level);
          level.connect(sum);
        });
        pools[key] = createVoiceInstrument(
          meta.id,
          input,
          Tone.Synth,
          { oscillator: { type: 'sawtooth' }, envelope: { attack: 0.04, decay: 0.12, sustain: 0.85, release: 0.18 } },
          0.18,
          0,
          noteName
        );
      }
      return pools[key];
    }
    poolFor(settings.vowel); // la voyelle par défaut est prête avant la première note
    return {
      play(row, time, duration, note) {
        poolFor(note && note.vowel).play(row, time, duration);
      },
      dispose() {
        Object.values(pools).forEach((pool) => pool.dispose());
        nodes.forEach((node) => node.dispose());
      },
    };
  }

  /**
   * Trompette : dents de scie (riche en harmoniques) dont le FILTRE s'ouvre pendant l'attaque (le « coup de langue » des cuivres :
   * le son démarre mat puis éclate), attaque courte, tenue franche, puis une bosse d'égalisation vers 1,8 kHz (le « blat »).
   */
  function createTrumpet(output, settings) {
    const bell = new Tone.Filter({ type: 'peaking', frequency: 1800, Q: 0.9, gain: 5 });
    bell.connect(output);
    const inner = createVoiceInstrument(
      'trumpet',
      bell,
      Tone.MonoSynth,
      {
        oscillator: { type: 'sawtooth' },
        envelope: { attack: 0.035, decay: 0.12, sustain: 0.85, release: 0.14 },
        filter: { type: 'lowpass', Q: 1.6, rolloff: -12 },
        filterEnvelope: { attack: 0.07, decay: 0.2, sustain: 0.55, release: 0.2, baseFrequency: 450, octaves: 3.8 },
      },
      0.16,
      0,
      (row) => GB.getToneNote('trumpet', row, settings)
    );
    return {
      play: inner.play,
      dispose() {
        inner.dispose();
        bell.dispose();
      },
    };
  }

  /**
   * Voix de flûte : un son presque pur (fondamentale + un peu de 2e et 3e harmoniques), attaque douce, plus un souffle
   * (bruit rose filtré) qui se fond dans la note. Une instance par note qui sonne (voir createVoiceInstrument).
   */
  class FluteVoice {
    constructor() {
      this.tone = new Tone.Synth({
        oscillator: { type: 'custom', partials: [1, 0.22, 0.07] },
        envelope: { attack: 0.07, decay: 0.1, sustain: 0.92, release: 0.2 },
      });
      this.breath = new Tone.NoiseSynth({
        noise: { type: 'pink' },
        envelope: { attack: 0.05, decay: 0.12, sustain: 0.22, release: 0.15 },
      });
      this.breathFilter = new Tone.Filter({ type: 'bandpass', frequency: 3800, Q: 0.6 });
      this.breathGain = new Tone.Gain(0.35);
      this.breath.chain(this.breathFilter, this.breathGain);
    }

    connect(node) {
      this.tone.connect(node);
      this.breathGain.connect(node);
      return this;
    }

    triggerAttackRelease(note, duration, time, velocity) {
      this.tone.triggerAttackRelease(note, duration, time, velocity);
      this.breath.triggerAttackRelease(duration, time, 0.5);
    }

    dispose() {
      [this.tone, this.breath, this.breathFilter, this.breathGain].forEach((node) => node.dispose());
    }
  }

  function createFlute(output, settings) {
    const vibrato = new Tone.Vibrato({ frequency: 5.2, depth: 0.09, type: 'sine' });
    vibrato.connect(output);
    const inner = createVoiceInstrument('flute', vibrato, FluteVoice, {}, 0.25, 0, (row) => GB.getToneNote('flute', row, settings));
    return {
      play: inner.play,
      dispose() {
        inner.dispose();
        vibrato.dispose();
      },
    };
  }

  /**
   * Voix enregistrée : rejoue un clip à sa position dans la boucle, sur l'horloge audio.
   * Le clip est coupé à la fin de la boucle (il ne déborde jamais sur le tour suivant).
   */
  function createClipPlayer(output) {
    const player = new Tone.Player({ fadeIn: 0.004, fadeOut: 0.02 });
    player.connect(output);
    let loadedId = null;
    function load(clip) {
      if (loadedId !== clip.id) {
        player.buffer = GB.voice.getBuffer(clip);
        loadedId = clip.id;
      }
    }
    return {
      play() {}, // pas de notes sur une piste de voix
      playClip(clip, step, time) {
        const first = Math.floor(clip.start + 1e-9);
        if (step !== first) return;
        load(clip);
        const delay = (clip.start - first) * stepSeconds();
        const room = (CONFIG.STEP_COUNT - clip.start) * stepSeconds();
        player.start(time + delay, 0, Math.min(clip.duration, room));
      },
      /** Reprend une voix déjà commencée à la position `position` (colonnes) : joue la suite seulement. */
      playClipFrom(clip, position, when) {
        const inside = (position - clip.start) * stepSeconds();
        const room = (CONFIG.STEP_COUNT - position) * stepSeconds();
        if (inside <= 0.001 || inside >= clip.duration) return;
        load(clip);
        player.start(when, inside, Math.min(clip.duration - inside, room));
      },
      playNow(clip, maxSeconds) {
        load(clip);
        player.start(Tone.now() + 0.01, 0, Math.min(clip.duration, maxSeconds || clip.duration));
      },
      dispose() {
        player.dispose();
      },
    };
  }


  /**
   * Son importé joué comme instrument. Toutes les notes d'une piste partagent le MÊME tampon décodé
   * (GB.sounds) : une source de lecture légère par note, aucune copie du son.
   *   - hauteur : Do4 = son d'origine ; chaque demi-ton d'écart décale la HAUTEUR sans changer la VITESSE ni la durée
   *     (étirement WSOLA + rééchantillonnage, voir js/pitch.js ; résultat gardé en mémoire par son et par hauteur).
   *     Réglage « Hauteur : toujours l'original » : le son n'est jamais décalé (pratique pour les percussions).
   *   - « Joué en entier » : la note déclenche le son, qui va jusqu'au bout (jamais coupé, même si la note est courte).
   *   - « Coupé à la fin de la note » : le son s'arrête avec la note (fondu de 15 ms) ; trop court, il se joue une fois.
   * Tant que le fichier n'est pas décodé (chargement, ou fichier absent), les notes sont muettes.
   */
  const MAX_SAMPLE_VOICES = 24;

  // Sons déjà décalés (un par son importé et par hauteur) : au plus ~16 millions d'échantillons en mémoire (≈ 64 Mo), les plus anciens oubliés.
  const shiftedCache = GB.pitch.createCache(16000000);
  const shiftQueue = []; // calculs de fond : un à la fois, entre deux images
  let shiftBusy = false;

  /** Buffer d'un son importé décalé de `semitones` demi-tons (calculé à la demande si besoin, puis gardé). null si le fichier n'est pas décodé. */
  function shiftedBufferFor(hash, semitones) {
    const tone = GB.sounds.peekBuffer(hash);
    if (!tone) return null;
    const original = tone.get();
    if (!semitones) return original;
    const key = hash + '|' + semitones;
    const cached = shiftedCache.get(key);
    if (cached) return cached;
    const channels = [];
    for (let c = 0; c < original.numberOfChannels; c += 1) channels.push(original.getChannelData(c));
    const shifted = GB.pitch.shift(channels, original.sampleRate, semitones);
    const buffer = Tone.getContext().createBuffer(shifted.length, original.length, original.sampleRate);
    shifted.forEach((data, c) => buffer.copyToChannel(data, c));
    shiftedCache.set(key, buffer, original.length * shifted.length);
    return buffer;
  }

  function pumpShiftQueue() {
    if (shiftBusy) return;
    shiftBusy = true;
    const next = () => {
      const job = shiftQueue.shift();
      if (!job) {
        shiftBusy = false;
        return;
      }
      try {
        shiftedBufferFor(job.hash, job.semitones);
      } catch (error) {
        /* tant pis : la note le calculera à la demande */
      }
      setTimeout(next, 0);
    };
    setTimeout(next, 0);
  }

  /** Demande le calcul (en arrière-plan) des hauteurs dont ces notes auront besoin, pour que la lecture ne bute jamais dessus. */
  function warmShifts(hash, semitoneList) {
    semitoneList.forEach((semitones) => {
      if (!semitones || shiftedCache.has(hash + '|' + semitones) || shiftQueue.some((job) => job.hash === hash && job.semitones === semitones)) return;
      shiftQueue.push({ hash, semitones });
    });
    if (shiftQueue.length) pumpShiftQueue();
  }

  function createSamplePlayer(output, settings) {
    const ref = settings.sample || {};
    const context = Tone.getContext();
    const active = []; // { src, gain, endsAt }
    const rootFrequency = Tone.Frequency('C4').toFrequency();
    let disposed = false;
    if (ref.hash) {
      GB.sounds.markUsed(ref.hash);
      GB.sounds.ensure(ref.hash); // décode en arrière-plan si besoin
    }

    /** Demi-tons entre la note de cette ligne et Do4 (0 = son d'origine, ou « toujours l'original »). */
    function semitonesFor(row) {
      if (settings.pitched !== 'yes') return 0;
      const ratio = Tone.Frequency(GB.getToneNote('piano', row, settings)).toFrequency() / rootFrequency;
      return Math.max(GB.pitch.LIMITS.minSemitones, Math.min(GB.pitch.LIMITS.maxSemitones, Math.round(12 * Math.log2(ratio))));
    }

    function trim(now) { // `now` : instant de départ de la nouvelle note
      for (let i = active.length - 1; i >= 0; i -= 1) if (active[i].endsAt < now - 0.05) active.splice(i, 1);
      while (active.length >= MAX_SAMPLE_VOICES) {
        const oldest = active.shift();
        try {
          oldest.gain.gain.cancelScheduledValues(now);
          oldest.gain.gain.setValueAtTime(oldest.gain.gain.value, now);
          oldest.gain.gain.linearRampToValueAtTime(0, now + 0.015);
          oldest.src.stop(now + 0.02);
        } catch (error) {
          /* déjà arrêtée */
        }
      }
    }

    /**
     * Joue à partir de `offset` secondes DU FICHIER. `noteSeconds` : durée restante de la note (mode « coupé »).
     * `cap` : durée maximale d'écoute en secondes (aperçu).
     */
    function start(row, time, noteSeconds, offset, cap) {
      if (disposed || !ref.hash) return;
      const buffer = shiftedBufferFor(ref.hash, semitonesFor(row));
      if (!buffer) return;
      if (offset >= buffer.duration - 0.005) return;
      const natural = buffer.duration - offset; // durée d'écoute jusqu'à la fin du fichier : la même à toutes les hauteurs
      let seconds = natural;
      if (settings.mode === 'fit') seconds = Math.min(seconds, Math.max(0.03, noteSeconds));
      if (cap) seconds = Math.min(seconds, cap);
      const when = Math.max(time, context.currentTime); // jamais dans le passé, sans décaler les notes en avance
      trim(when);
      const src = context.createBufferSource();
      const gain = context.createGain();
      src.buffer = buffer;
      src.connect(gain);
      Tone.connect(gain, output);
      const end = when + seconds;
      gain.gain.setValueAtTime(0, when);
      gain.gain.linearRampToValueAtTime(1, when + 0.003);
      if (seconds < natural - 0.001) {
        gain.gain.setValueAtTime(1, Math.max(when + 0.003, end - 0.015));
        gain.gain.linearRampToValueAtTime(0, end);
      }
      const entry = { src, gain, endsAt: end };
      active.push(entry);
      src.onended = () => {
        const index = active.indexOf(entry);
        if (index >= 0) active.splice(index, 1);
        try {
          src.disconnect();
          gain.disconnect();
        } catch (error) {
          /* déjà déconnectés */
        }
      };
      src.start(when, offset);
      src.stop(end + 0.02);
    }

    return {
      play(row, time, duration, note, opts) {
        start(row, time, duration, 0, opts && opts.preview ? 1.6 : 0);
      },
      /** Prépare en arrière-plan les hauteurs des notes de la piste (appelé à chaque synchronisation). */
      prepare(notes) {
        if (!ref.hash || !notes || !notes.length) return;
        const tone = GB.sounds.peekBuffer(ref.hash);
        if (!tone) {
          GB.sounds.ensure(ref.hash).then((ready) => ready && !disposed && this.prepare(notes));
          return;
        }
        warmShifts(ref.hash, Array.from(new Set(notes.map((note) => semitonesFor(note.row)))));
      },
      /** Reprise au milieu d'une boucle : une note déjà commencée avant la position choisie joue la SUITE du son. */
      catchUp(note, position, when) {
        const tone = ref.hash ? GB.sounds.peekBuffer(ref.hash) : null;
        if (!tone) return;
        const elapsed = (position - note.step) * stepSeconds();
        if (elapsed <= 0.001) return;
        const remainingNote = note.length * stepSeconds() - elapsed;
        if (settings.mode === 'fit' && remainingNote <= 0.02) return;
        start(note.row, when, remainingNote, elapsed, 0);
      },
      dispose() {
        disposed = true;
        const now = Tone.now();
        active.splice(0).forEach((entry) => {
          try {
            entry.src.onended = null;
            entry.src.stop(now);
            entry.src.disconnect();
            entry.gain.disconnect();
          } catch (error) {
            /* déjà arrêtée */
          }
        });
      },
    };
  }

  /* ------------------------------------------------------------------ */
  /*  Instrument personnalisé : un petit synthétiseur réglable           */
  /* ------------------------------------------------------------------ */

  /** Une oscillation : forme standard, ou dessinée (harmoniques), avec plusieurs voix désaccordées si demandé. */
  function makeOscillator(wave, harmonics, unison, spread) {
    const base = wave === 'drawn' ? { type: 'custom', partials: harmonics } : { type: wave };
    if (unison > 1) return new Tone.FatOscillator(Object.assign({}, base, { count: unison, spread }));
    return new Tone.Oscillator(base);
  }

  /**
   * Une voix du synthé personnalisé (même mode d'emploi qu'une Tone.Synth : connect / triggerAttackRelease / dispose) :
   *   onde 1 (+ onde 2 en option) → mélange → filtre (+ balayage) → enveloppe de volume → sortie.
   * Le vibrato fait onduler le désaccord des ondes (un oscillateur lent, LFO).
   */
  class CustomVoice {
    constructor(o) {
      this.o = o;
      this.nodes = [];
      this.osc1 = makeOscillator(o.wave, o.harmonics, o.unison, o.spread);
      this.osc1.detune.value = o.detune;
      this.mix = new Tone.Gain(1);
      this.osc1.connect(this.mix);
      this.nodes.push(this.osc1, this.mix);
      this.osc2 = null;
      if (o.wave2 !== 'none' && o.mix2 > 0.001) {
        this.osc2 = new Tone.Oscillator({ type: o.wave2 });
        this.osc2.detune.value = o.detune + o.detune2;
        const level = new Tone.Gain(o.mix2);
        this.osc2.connect(level);
        level.connect(this.mix);
        this.mix.gain.value = 1 / (1 + o.mix2 * 0.6); // évite que le mélange soit plus fort que l'onde seule
        this.nodes.push(this.osc2, level);
      }
      this.lfo = null;
      if (o.vibrato > 0.001) {
        const depth = o.vibrato * 60; // jusqu'à ±60 cents
        this.lfo = new Tone.LFO({ frequency: o.vibratoRate, min: -depth, max: depth }).start();
        this.lfo.connect(this.osc1.detune);
        if (this.osc2) this.lfo.connect(this.osc2.detune);
        this.nodes.push(this.lfo);
      }
      this.envelope = new Tone.AmplitudeEnvelope({ attack: o.attack, decay: o.decay, sustain: o.sustain, release: o.release });
      this.nodes.push(this.envelope);
      this.filter = null;
      this.sweep = null;
      if (o.filterType !== 'none') {
        const cutoff = GB.synth.cutoffHz(o.cutoff);
        const sweeping = o.sweep > 0.001;
        this.filter = new Tone.Filter({ type: o.filterType, frequency: sweeping ? 0 : cutoff, Q: 0.5 + o.resonance * 11, rolloff: -12 });
        this.mix.connect(this.filter);
        this.filter.connect(this.envelope);
        this.nodes.push(this.filter);
        if (sweeping) {
          // le filtre démarre « fermé » puis s'ouvre vers la coupure : c'est l'enveloppe de fréquence qui le pilote
          this.sweep = new Tone.FrequencyEnvelope({ attack: Math.max(0.005, o.attack), decay: o.decay + 0.1, sustain: o.sustain, release: o.release, baseFrequency: cutoff / Math.pow(2, o.sweep), octaves: o.sweep });
          this.sweep.connect(this.filter.frequency);
          this.nodes.push(this.sweep);
        }
      } else {
        this.mix.connect(this.envelope);
      }
    }

    connect(destination) {
      this.envelope.connect(destination);
      return this;
    }

    triggerAttackRelease(note, duration, time, velocity) {
      const frequency = Tone.Frequency(note).toFrequency();
      const stopAt = time + duration + this.o.release + 0.05; // la voix est réutilisée seulement 0,1 s après la fin du relâchement
      this.osc1.frequency.setValueAtTime(frequency, time);
      this.osc1.start(time).stop(stopAt);
      if (this.osc2) {
        this.osc2.frequency.setValueAtTime(frequency * Math.pow(2, this.o.octave2), time);
        this.osc2.start(time).stop(stopAt);
      }
      if (this.sweep) this.sweep.triggerAttackRelease(duration, time, velocity);
      this.envelope.triggerAttackRelease(duration, time, velocity);
    }

    dispose() {
      this.nodes.forEach((node) => node.dispose());
    }
  }

  function createCustomSynth(output, settings, meta) {
    const o = GB.synth.normalize(settings);
    const nodes = [];
    // La chaîne d'effets se construit de la sortie vers l'entrée : écho / réverbération, trémolo, chorus, distorsion.
    const effects = buildEffects(output, o);
    let head = effects.input;
    if (o.tremolo > 0.001) {
      const tremolo = new Tone.Tremolo({ frequency: o.tremoloRate, depth: o.tremolo }).start();
      tremolo.connect(head);
      nodes.push(tremolo);
      head = tremolo;
    }
    if (o.chorus > 0.001) {
      const chorus = new Tone.Chorus({ frequency: 1.6, delayTime: 3.5, depth: 0.55, wet: Math.min(1, o.chorus) }).start();
      chorus.connect(head);
      nodes.push(chorus);
      head = chorus;
    }
    if (o.distortion > 0.001) {
      const distortion = new Tone.Distortion({ distortion: o.distortion * 0.9, wet: 1 });
      const trim = new Tone.Gain(1 - o.distortion * 0.45); // la distorsion fait gonfler le niveau : on le ramène
      distortion.connect(trim);
      trim.connect(head);
      nodes.push(distortion, trim);
      head = distortion;
    }
    const tail = o.release + (o.reverb > 0.001 ? 0.6 + o.reverb * 1.6 : 0) + (o.echo > 0.001 ? 0.8 : 0);
    const inner = createVoiceInstrument(meta.id, head, CustomVoice, o, o.release + 0.1, 0, (row) => GB.getToneNote(meta.id === 'preview' ? 'piano' : meta.id, row, o));
    return {
      play: inner.play,
      dispose() {
        inner.dispose();
        nodes.concat(effects.nodes).forEach((node) => node.dispose());
      },
      tail,
    };
  }

  /**
   * Moteurs : chaque moteur transforme des réglages en instrument { play(row, time, durée), dispose() }.
   * Pour brancher plus tard une voix chantée (échantillons, synthèse neuronale, service externe…),
   * il suffit d'enregistrer un nouveau moteur et de déclarer un instrument qui l'utilise.
   */
  const ENGINES = {
    formant: (output, settings, meta) => createFormantVoice(output, settings, meta),
    trumpet: (output, settings) => createTrumpet(output, settings),
    flute: (output, settings) => createFlute(output, settings),
    custom: (output, settings, meta) => createCustomSynth(output, settings, meta),
    clip: (output) => createClipPlayer(output),
    sample: (output, settings) => createSamplePlayer(output, settings),
  };

  const INSTRUMENT_FACTORIES = {
    piano: createPiano,
    synth: createSoftSynth,
    bass: createBass,
    lead: createLead,
    drums: createDrums,
  };

  /* ------------------------------------------------------------------ */
  /*  Runtimes (un par piste)                                            */
  /* ------------------------------------------------------------------ */

  /** Ce qui, s'il change, oblige à reconstruire l'instrument (le volume se règle en direct, sans reconstruction). */
  function signatureOf(track) {
    const settings = track.settings ? Object.assign({}, track.settings) : null;
    if (settings) delete settings.volume;
    return JSON.stringify([track.instrumentId, settings]);
  }

  /** Volume de la piste en dB : équilibrage de l'instrument + réglage du joueur (voix, instruments perso, clip). */
  function volumeOf(track) {
    const meta = GB.INSTRUMENTS[track.instrumentId];
    let extra = track.settings && Number.isFinite(track.settings.volume) ? track.settings.volume : 0;
    if (meta.kind === 'audio') extra = track.clip && Number.isFinite(track.clip.gainDb) ? track.clip.gainDb : 0;
    return meta.volumeDb + extra;
  }

  function buildInstrument(instrumentId, settings, output) {
    const meta = GB.INSTRUMENTS[instrumentId];
    if (INSTRUMENT_FACTORIES[instrumentId]) return INSTRUMENT_FACTORIES[instrumentId](output);
    const engine = ENGINES[meta.engine];
    if (!engine) throw new Error('Moteur audio inconnu : ' + meta.engine);
    return engine(output, settings || GB.instruments.defaultSettings(instrumentId) || {}, meta);
  }

  function createRuntime(track) {
    const channel = new Tone.Channel({ volume: volumeOf(track), mute: silenced || track.muted });
    channel.connect(master);
    const instrument = buildInstrument(track.instrumentId, track.settings, channel);
    return { instrumentId: track.instrumentId, signature: signatureOf(track), instrument, channel };
  }

  function disposeRuntime(runtime) {
    runtime.instrument.dispose();
    runtime.channel.dispose();
  }

  function applyMutes(tracks) {
    tracks.forEach((track) => {
      const runtime = runtimes.get(track.id);
      if (runtime) runtime.channel.mute = silenced || track.muted;
    });
  }

  /**
   * Aligne les runtimes sur l'état : crée ceux qui manquent, détruit ceux dont la
   * piste a disparu, reconstruit ceux dont l'instrument a changé. Idempotent.
   */
  function syncTracks() {
    const tracks = GB.store.getTracks();
    const liveIds = new Set(tracks.map((track) => track.id));

    runtimes.forEach((runtime, trackId) => {
      if (!liveIds.has(trackId)) {
        disposeRuntime(runtime);
        runtimes.delete(trackId);
      }
    });

    tracks.forEach((track) => {
      const existing = runtimes.get(track.id);
      if (existing && existing.signature !== signatureOf(track)) {
        disposeRuntime(existing);
        runtimes.delete(track.id);
      }
      if (!runtimes.has(track.id)) runtimes.set(track.id, createRuntime(track));
      const runtime = runtimes.get(track.id);
      runtime.channel.volume.value = volumeOf(track);
      if (runtime.instrument.prepare) runtime.instrument.prepare(track.notes);
    });

    applyMutes(tracks);
  }

  /* ------------------------------------------------------------------ */
  /*  Lecture                                                            */
  /* ------------------------------------------------------------------ */

  function ticksPerStep() {
    return Tone.Time(CONFIG.STEP_SUBDIVISION).toTicks();
  }

  function stepSeconds() {
    return Tone.Time(CONFIG.STEP_SUBDIVISION).toSeconds();
  }

  /**
   * Joue une note : `length` est exprimée en colonnes. La batterie ignore la durée
   * (ses sons ne se tiennent pas : ils s'éteignent d'eux-mêmes).
   */
  function playNote(runtime, row, length, time, durationCap, note) {
    let duration = stepSeconds() * length;
    if (durationCap) duration = Math.min(duration, durationCap);
    runtime.instrument.play(row, time, duration, note, { preview: Boolean(durationCap) });
  }

  /**
   * Appelé par la séquence tous les QUARTS de temps (SUB événements par colonne).
   * Une note démarre à son instant exact : l'événement du quart dans lequel elle tombe donne l'heure de base,
   * on y ajoute l'écart fractionnaire × durée d'une colonne. Position et durée jouées = position et durée affichées.
   */
  function onStep(time, index) {
    const sub = index % SUB;
    const step = (index - sub) / SUB;
    if (index === 0 && loopHook) loopHook();
    const slotStart = index / SUB;
    GB.store.getTracks().forEach((track) => {
      if (track.muted) return;
      const runtime = runtimes.get(track.id);
      if (!runtime) return;
      if (GB.INSTRUMENTS[track.instrumentId].kind === 'audio') {
        if (sub === 0 && track.clip) runtime.instrument.playClip(track.clip, step, time);
        return;
      }
      track.notes.forEach((note) => {
        if (Math.floor(note.step * SUB + 1e-6) !== index) return;
        const offset = Math.max(0, note.step - slotStart) * stepSeconds();
        playNote(runtime, note.row, note.length, time + offset, 0, note);
      });
    });
  }

  /** Notes et voix qui ont commencé AVANT la position choisie mais durent encore : on joue ce qu'il en reste. */
  function catchUp(position) {
    if (position <= 0) return;
    const start = Tone.now() + 0.08;
    GB.store.getTracks().forEach((track) => {
      if (track.muted) return;
      const runtime = runtimes.get(track.id);
      if (!runtime) return;
      const meta = GB.INSTRUMENTS[track.instrumentId];
      if (meta.kind === 'audio') {
        if (track.clip && runtime.instrument.playClipFrom) runtime.instrument.playClipFrom(track.clip, position, start);
        return;
      }
      if (meta.kind === 'drums') return;
      if (runtime.instrument.catchUp) {
        // Sons importés : une note « jouée en entier » peut sonner encore bien après la fin de sa durée.
        track.notes.forEach((note) => {
          if (note.step < position - 1e-6) runtime.instrument.catchUp(note, position, start);
        });
        return;
      }
      track.notes.forEach((note) => {
        const end = note.step + note.length;
        if (note.step < position - 1e-6 && end > position + 1e-6) playNote(runtime, note.row, end - position, start, 0, note);
      });
    });
  }

  function setStatus(next) {
    status = next;
    onStatusChange(status);
  }

  /**
   * Remplace les instruments par des exemplaires neufs. C'est le moyen le plus sûr de couper
   * net toutes les notes en cours, y compris leur « queue » de relâchement, sans qu'aucun
   * événement déjà programmé ne puisse les faire repartir.
   */
  function rebuildRuntimes() {
    runtimes.forEach(disposeRuntime);
    runtimes.clear();
    GB.store.getTracks().forEach((track) => runtimes.set(track.id, createRuntime(track)));
  }

  /** Coupe le son immédiatement (Stop / Pause), puis le rétablit un instant plus tard sur des instruments neufs. */
  function holdSilence() {
    silenced = true;
    applyMutes(GB.store.getTracks()); // 1) mute immédiat
    rebuildRuntimes(); // 2) instruments neufs, silencieux
    clearTimeout(silenceTimer);
    silenceTimer = setTimeout(releaseSilence, SILENCE_HOLD_MS);
  }

  function releaseSilence() {
    clearTimeout(silenceTimer);
    silenceTimer = null;
    silenced = false;
    applyMutes(GB.store.getTracks());
  }

  function buildSequence() {
    if (sequence) sequence.dispose();
    const steps = Array.from({ length: CONFIG.STEP_COUNT * SUB }, (_, index) => index);
    sequence = new Tone.Sequence(onStep, steps, Math.round(Tone.Time(CONFIG.STEP_SUBDIVISION).toTicks() / SUB) + 'i');
    cursor = Math.min(cursor, CONFIG.STEP_COUNT - 1 / SUB);
    sequence.loop = true; // la composition entière se répète sans fin, jusqu'à Pause / Arrêt
    sequence.start(0);
  }

  const audio = {
    /** À appeler une fois au chargement de la page. */
    init(options) {
      onStatusChange = (options && options.onStatusChange) || onStatusChange;
      master = new Tone.Limiter(-2).toDestination();
      Tone.Transport.bpm.value = GB.store.state.bpm;

      buildSequence();
      syncTracks();
    },

    /**
     * Applique la longueur de boucle courante (CONFIG.STEP_COUNT). La lecture est arrêtée,
     * puis l'unique séquence est remplacée par une nouvelle (jamais deux en même temps).
     */
    setLoopSteps() {
      audio.stop();
      buildSequence();
    },

    syncTracks,

    /** Fonction appelée au 1er temps de chaque boucle (ou null pour l'enlever). */
    setLoopHook(fn) {
      loopHook = fn || null;
    },

    /**
     * Les navigateurs bloquent le son tant que l'utilisateur n'a rien fait.
     * À appeler dans un gestionnaire de clic : réveille le contexte audio.
     */
    unlock() {
      return Tone.start();
    },

    getStatus() {
      return status;
    },

    async play() {
      if (status === 'playing') return;
      setStatus('playing');
      const token = (playToken += 1);
      try {
        await Tone.start();
      } catch (error) {
        if (token === playToken) setStatus('stopped');
        throw error;
      }
      // Pause / arrêt / nouvelle demande pendant l'attente : cette reprise est périmée, on n'agit pas (pas de double démarrage).
      if (status !== 'playing' || token !== playToken) return;
      releaseSilence();
      syncTracks();
      Tone.Transport.ticks = Math.round(cursor * ticksPerStep());
      Tone.Transport.start();
      engaged = true;
      catchUp(cursor);
    },

    pause() {
      if (status !== 'playing') return;
      playToken += 1; // annule un démarrage encore en attente
      // On reprendra au début du quart de temps où l'on s'est arrêté (la reprise rejoue au plus ¼ de temps).
      // Si le Transport n'avait pas encore démarré, sa position est périmée : on garde le curseur tel quel.
      if (engaged) cursor = Math.min(CONFIG.STEP_COUNT - 1 / SUB, Math.max(0, Math.floor(audio.getPlayheadPosition() * SUB + 1e-6) / SUB));
      engaged = false;
      setStatus('paused');
      Tone.Transport.pause();
      holdSilence();
    },

    stop() {
      cursor = 0; // un arrêt ramène la barre au début ; on peut ensuite la replacer où l'on veut
      playToken += 1;
      engaged = false;
      if (status === 'stopped') return;
      setStatus('stopped');
      Tone.Transport.stop();
      holdSilence();
    },

    setBpm(bpm) {
      Tone.Transport.bpm.value = bpm;
    },

    /**
     * Place la barre de lecture (position en colonnes, arrondie au quart de temps).
     * À l'arrêt : la prochaine lecture partira de là. En pause : la lecture reprendra de là.
     * En lecture : saut immédiat (les sons en cours sont coupés, les notes tenues sont reprises).
     * Ne touche jamais aux notes.
     */
    seek(position) {
      const max = CONFIG.STEP_COUNT - 1 / SUB;
      const target = Math.min(max, Math.max(0, Math.floor(Number(position) * SUB + 1e-6) / SUB));
      if (!Number.isFinite(target)) return cursor;
      cursor = target;
      if (status === 'stopped') return cursor;
      if (status === 'paused') {
        Tone.Transport.ticks = Math.round(target * ticksPerStep());
        return cursor;
      }
      if (!engaged) return cursor; // démarrage en cours : play() partira de ce curseur
      Tone.Transport.pause();
      rebuildRuntimes();
      Tone.Transport.ticks = Math.round(target * ticksPerStep());
      Tone.Transport.start();
      catchUp(target);
      return cursor;
    },

    /** Volume général de CET appareil (0 à 1) : règle le son sans jamais toucher à la lecture. */
    setMasterVolume(level) {
      const value = Math.min(1, Math.max(0, Number(level)));
      if (!Number.isFinite(value)) return;
      Tone.getDestination().volume.value = value <= 0.001 ? -Infinity : 20 * Math.log10(value);
    },

    getCursor() {
      return cursor;
    },

    /** Joue une note isolée (retour sonore immédiat quand on pose une note ou change d'instrument). */
    preview(trackId, row, length, note) {
      const track = GB.store.getTrack(trackId);
      if (!track || track.muted) return;
      if (GB.INSTRUMENTS[track.instrumentId].kind === 'audio') return audio.previewClip(trackId);
      const noteLength = length || GB.INSTRUMENTS[track.instrumentId].defaultLength;
      audio.unlock().then(() => {
        const runtime = runtimes.get(trackId);
        if (!runtime) return;
        releaseSilence();
        playNote(runtime, row, noteLength, Tone.now() + 0.01, 0.55, note);
      });
    },

    /** Réécoute le clip vocal d'une piste, seul, tout de suite. */
    previewClip(trackId) {
      const track = GB.store.getTrack(trackId);
      if (!track || !track.clip) return Promise.resolve(false);
      return audio.unlock().then(() => {
        const runtime = runtimes.get(trackId);
        if (!runtime || !runtime.instrument.playNow) return false;
        releaseSilence();
        runtime.instrument.playNow(track.clip);
        return true;
      });
    },

    /**
     * Joue quelques notes d'un instrument qui n'est pas (encore) sur une piste : page de préparation, sélecteurs compacts.
     * Les sons importés sont décodés d'abord. L'instrument temporaire est détruit ensuite. Renvoie false si rien n'est jouable.
     */
    previewInstrument(instrumentId, settings, rows, noteLength) {
      const meta = GB.INSTRUMENTS[instrumentId];
      if (!meta || meta.kind === 'audio') return Promise.resolve(false);
      return audio.unlock().then(async () => {
        const values = settings || GB.instruments.defaultSettings(instrumentId) || {};
        if (values.sample && values.sample.hash && GB.sounds) {
          const ready = await GB.sounds.ensure(values.sample.hash);
          if (!ready) return false;
        }
        releaseSilence();
        const channel = new Tone.Channel({ volume: meta.volumeDb + (values.volume || 0) });
        channel.connect(master);
        const instrument = buildInstrument(instrumentId, values, channel);
        const list = rows && rows.length ? rows : [meta.kind === 'drums' ? 0 : GB.PREVIEW_ROW];
        const seconds = noteLength || 0.5; // durée d'une note d'essai, en secondes
        const start = Tone.now() + 0.03;
        list.forEach((row, index) => instrument.play(row, start + index * (seconds + 0.08), seconds, null, { preview: true }));
        setTimeout(() => {
          instrument.dispose();
          channel.dispose();
        }, (list.length * (seconds + 0.08) + 4) * 1000);
        return true;
      });
    },

    /**
     * Joue quelques notes avec des réglages d'instrument personnalisé qui ne sont pas (encore) enregistrés : éditeur d'instrument.
     * `rows` : lignes de la grille jouées l'une après l'autre. L'instrument temporaire est détruit ensuite.
     */
    previewCustom(settings, rows, noteLength) {
      return audio.unlock().then(() => {
        releaseSilence();
        const normalized = GB.synth.normalize(settings);
        const channel = new Tone.Channel({ volume: -13 + normalized.volume });
        channel.connect(master);
        const instrument = createCustomSynth(channel, normalized, { id: 'preview' });
        const list = rows && rows.length ? rows : [GB.PREVIEW_ROW];
        const length = noteLength || 0.5;
        const start = Tone.now() + 0.03;
        list.forEach((row, index) => instrument.play(row, start + index * (length + 0.06), length));
        setTimeout(() => {
          instrument.dispose();
          channel.dispose();
        }, (list.length * (length + 0.06) + 6) * 1000);
        return true;
      });
    },

    /**
     * Rend quelques notes d'un instrument HORS LIGNE (sans haut-parleurs) et renvoie les échantillons audio (Float32Array, mono).
     * Sert à vérifier objectivement un timbre (niveau, brillance, absence de silence ou de son cassé) ; ne touche pas à la lecture.
     */
    async renderOffline(instrumentId, rows, noteLength, settings) {
      const meta = GB.INSTRUMENTS[instrumentId];
      if (!meta || meta.kind !== 'melodic') return new Float32Array(0);
      const values = settings || GB.instruments.defaultSettings(instrumentId);
      const gap = noteLength + 0.35;
      const buffer = await Tone.Offline(() => {
        const channel = new Tone.Channel({ volume: meta.volumeDb + ((values && values.volume) || 0) }).toDestination();
        const instrument = buildInstrument(instrumentId, values, channel);
        rows.forEach((row, index) => instrument.play(row, 0.05 + index * gap, noteLength));
      }, rows.length * gap + 0.6, 1, 44100);
      return buffer.getChannelData(0);
    },

    /** Ajoute un moteur audio (voir ENGINES) : point d'entrée prévu pour une future voix chantée. */
    registerEngine(name, factory) {
      ENGINES[name] = factory;
    },

    /**
     * Position de la tête de lecture en colonnes (0 à STEP_COUNT, fractionnaire),
     * ou null quand la musique est à l'arrêt.
     */
    getPlayheadPosition() {
      if (status === 'stopped' || (status === 'playing' && !engaged)) return cursor;
      const ticksPerStep = Tone.Time(CONFIG.STEP_SUBDIVISION).toTicks();
      const lookAheadInSteps = Tone.getContext().lookAhead / stepSeconds();
      const position = Tone.Transport.ticks / ticksPerStep - lookAheadInSteps;
      const length = CONFIG.STEP_COUNT;
      return (((position % length) + length) % length);
    },
  };

  GB.audio = audio;
})((window.GB = window.GB || {}));

/**
 * GARTIC BANDE — configuration et données statiques.
 *
 * Tout ce qui est « constante du jeu » vit ici : taille de la grille, tempo,
 * palette des pistes, description des instruments et composition de démo.
 * Ce fichier ne dépend ni du DOM ni de Tone.js.
 */
(function (GB) {
  'use strict';

  GB.CONFIG = {
    /** Nombre de colonnes de la grille (16 temps = 4 mesures à 4/4). Modifié par GB.setLoopBars(). */
    STEP_COUNT: 16,
    /** Nombre de mesures de la boucle (voir GB.setLoopBars). */
    LOOP_BARS: 4,
    /** Nombre de colonnes par mesure (pour les repères visuels). */
    STEPS_PER_BAR: 4,
    /** Les durées de note sont alignées sur ce pas, exprimé en colonnes (0,25 = un quart de temps). */
    DURATION_UNIT: 0.25,
    /** Durée minimale d'une note, en colonnes. */
    MIN_NOTE_LENGTH: 0.25,
    /** Durée d'une colonne, en notation Tone.js (« 4n » = une noire = un temps). */
    STEP_SUBDIVISION: '4n',
    BPM_MIN: 60,
    BPM_MAX: 180,
    BPM_DEFAULT: 110,
    MAX_TRACKS: 8,
    TRACK_COLORS: [
      '#FF5C8A', // rose
      '#FFB020', // orange
      '#2EC4B6', // turquoise
      '#7C5CFF', // violet
      '#4DA3FF', // bleu
      '#7ED957', // vert
      '#FF7A45', // corail
      '#C45CFF', // lilas
    ],
  };

  /**
   * Limites de la bibliothèque « Mes sons » (sons importés par le joueur). Modifiables ici ;
   * la taille maximale d'un fichier peut aussi être réglée par le joueur dans la fenêtre « Mes sons ».
   */
  GB.CONFIG.SOUNDS = {
    MAX_FILE_BYTES: 5 * 1024 * 1024, // taille maximale d'un fichier (valeur par défaut, réglable)
    FILE_BYTES_CHOICES: [1, 2, 5, 10], // choix proposés au joueur (en Mo)
    HARD_MAX_FILE_BYTES: 10 * 1024 * 1024, // plafond absolu : jamais de fichier plus gros, quoi que choisisse le joueur
    MAX_SECONDS: 30, // durée maximale d'un son (une fois décodé)
    MAX_COUNT: 40, // nombre de sons dans la bibliothèque
    MAX_TOTAL_BYTES: 60 * 1024 * 1024, // espace total pris par la bibliothèque
    NAME_MAX: 40,
  };

  /** Change la longueur de la boucle (en mesures). Le moteur audio doit être prévenu (audio.setLoopSteps). */
  GB.setLoopBars = function (bars) {
    GB.CONFIG.LOOP_BARS = bars;
    GB.CONFIG.STEP_COUNT = bars * GB.CONFIG.STEPS_PER_BAR;
  };

  /** « 1 temps », « ½ temps », « 2¼ temps »… pour afficher une durée exprimée en colonnes (= temps). */
  /** Écrit une quantité de temps : 1, 1½, ¼, ou en décimales si elle est « libre » (ex. 1,37). */
  GB.formatBeats = function (value) {
    const rounded = Math.round(value * 1000) / 1000;
    const whole = Math.floor(rounded + 1e-9);
    const rest = rounded - whole;
    const known = { 0: '', 0.25: '¼', 0.5: '½', 0.75: '¾' };
    if (Math.abs(rest) < 1e-9) return String(whole);
    const key = [0.25, 0.5, 0.75].find((fraction) => Math.abs(rest - fraction) < 1e-6);
    if (key !== undefined) return (whole > 0 ? String(whole) : '') + known[key];
    return String(Math.round(rounded * 100) / 100).replace('.', ',');
  };

  GB.formatLength = function (length) {
    return GB.formatBeats(length) + (length > 1.0001 ? ' temps' : ' temps');
  };


  /* ------------------------------------------------------------------ */
  /*  Notes : gamme chromatique (touches blanches et noires d'un piano)   */
  /* ------------------------------------------------------------------ */

  /**
   * Une ligne = un demi-ton. La ligne 0 est le Do le plus grave ; les 12 lignes d'une octave sont
   * Do, Do♯, Ré, Ré♯, Mi, Fa, Fa♯, Sol, Sol♯, La, La♯, Si. Les touches noires sont donc exactement
   * à un demi-ton de leurs voisines blanches : la position d'une note à l'écran EST sa hauteur.
   */
  const SEMITONES = [
    { tone: 'C', label: 'Do', black: false },
    { tone: 'C#', label: 'Do♯', black: true },
    { tone: 'D', label: 'Ré', black: false },
    { tone: 'D#', label: 'Ré♯', black: true },
    { tone: 'E', label: 'Mi', black: false },
    { tone: 'F', label: 'Fa', black: false },
    { tone: 'F#', label: 'Fa♯', black: true },
    { tone: 'G', label: 'Sol', black: false },
    { tone: 'G#', label: 'Sol♯', black: true },
    { tone: 'A', label: 'La', black: false },
    { tone: 'A#', label: 'La♯', black: true },
    { tone: 'B', label: 'Si', black: false },
  ];
  const BASE_OCTAVE = 3;

  /** Anciennes lignes « gamme pentatonique » (Do Ré Mi Sol La) → demi-tons depuis le Do. */
  const PENTATONIC_SEMITONES = [0, 2, 4, 7, 9];

  /** Nombre de lignes de la grille pour un instrument mélodique : 3 octaves complètes (Do3 à Si5). */
  GB.MELODIC_ROW_COUNT = 36;

  /**
   * Convertit une ancienne ligne pentatonique (0 à 14) en ligne chromatique, pour que la démo, les personnages et les
   * aperçus gardent EXACTEMENT les mêmes hauteurs qu'avant (ex. ancienne ligne 5 = Do4 = nouvelle ligne 12).
   */
  GB.legacyRow = function (oldRow) {
    return Math.floor(oldRow / 5) * 12 + PENTATONIC_SEMITONES[oldRow % 5];
  };

  /** Lignes jouables en « gamme douce » (pentatonique de Do) : l'ancien mode où l'on ne peut pas jouer faux. */
  GB.isScaleRow = function (row) {
    return PENTATONIC_SEMITONES.includes(((row % 12) + 12) % 12);
  };

  /**
   * Modes de difficulté du piano-roll. Les DONNÉES restent chromatiques (une ligne = un demi-ton depuis Do3) :
   * le mode ne change que les lignes proposées et la finesse de la grille. Aucune note n'est jamais modifiée ni supprimée.
   */
  GB.SCALES = {
    major: { id: 'major', label: 'Majeure', long: 'Pentatonique majeure : Do Ré Mi Sol La', semitones: [0, 2, 4, 7, 9] },
    minor: { id: 'minor', label: 'Mineure', long: 'Pentatonique mineure : Do Mi♭ Fa Sol Si♭', semitones: [0, 3, 5, 7, 10] },
  };
  GB.MODES = {
    baby: { id: 'baby', icon: '👶', label: 'Baby', units: [1, 0.5], forceMagnet: true, maxDetail: 2, help: 'Seulement les notes de la gamme choisie, pas de rythme compliqué : impossible de sonner trop faux.' },
    beginner: { id: 'beginner', icon: '🎹', label: 'Débutant', units: [1, 0.5, 0.25], forceMagnet: false, maxDetail: 4, help: 'Les 7 notes naturelles (Do Ré Mi Fa Sol La Si), toutes libres, sans dièses ni bémols.' },
    expert: { id: 'expert', icon: '🎼', label: 'Expert', units: [1, 0.5, 0.25, 0.125, 1 / 3], forceMagnet: false, maxDetail: 8, help: 'Toutes les notes (touches blanches et noires) et des subdivisions très fines.' },
  };
  GB.MODE_ORDER = ['baby', 'beginner', 'expert'];

  /** La ligne `row` (demi-tons depuis Do) est-elle proposée dans ce mode ? */
  GB.modeAllowsRow = function (modeId, scaleId, row) {
    const pc = ((row % 12) + 12) % 12;
    if (modeId === 'baby') return (GB.SCALES[scaleId] || GB.SCALES.major).semitones.includes(pc);
    if (modeId === 'beginner') return !SEMITONES[pc].black;
    return true;
  };

  /** Ligne de Do4 : hauteur « d'origine » des sons importés et note d'aperçu par défaut. */
  GB.PREVIEW_ROW = 12;

  function noteParts(row, octaveShift) {
    const degree = SEMITONES[((row % 12) + 12) % 12];
    const octave = BASE_OCTAVE + Math.floor(row / 12) + octaveShift;
    return { degree, octave };
  }

  /* ------------------------------------------------------------------ */
  /*  Instruments                                                        */
  /* ------------------------------------------------------------------ */

  GB.DRUM_PADS = [
    { id: 'kick', label: 'Grosse caisse' },
    { id: 'snare', label: 'Caisse claire' },
    { id: 'hatClosed', label: 'Charley' },
    { id: 'hatOpen', label: 'Charley ouvert' },
    { id: 'clap', label: 'Clap' },
    { id: 'tomLow', label: 'Tom grave' },
    { id: 'tomHigh', label: 'Tom aigu' },
    { id: 'crash', label: 'Cymbale' },
  ];

  /**
   * `defaultLength` : durée d'une nouvelle note, en colonnes (modifiable ensuite avec la poignée).
   * `resizable` : false pour la batterie, dont les sons ne se « tiennent » pas.
   * `volumeDb` : équilibrage du volume entre les instruments.
   */
  GB.INSTRUMENTS = {
    piano: { id: 'piano', label: 'Piano', icon: '🎹', kind: 'melodic', octaveShift: 0, defaultLength: 1, resizable: true, volumeDb: -8 },
    synth: { id: 'synth', label: 'Synthé doux', icon: '🌙', kind: 'melodic', octaveShift: 0, defaultLength: 2, resizable: true, volumeDb: -15 },
    bass: { id: 'bass', label: 'Basse', icon: '🎸', kind: 'melodic', octaveShift: -1, defaultLength: 1, resizable: true, volumeDb: -7 },
    lead: { id: 'lead', label: 'Lead 8-bit', icon: '👾', kind: 'melodic', octaveShift: 0, defaultLength: 1, resizable: true, volumeDb: -17 },
    drums: { id: 'drums', label: 'Batterie', icon: '🥁', kind: 'drums', octaveShift: 0, defaultLength: 1, resizable: false, volumeDb: -5 },
    // Cuivre et bois : moteurs 'trumpet' et 'flute' (voir audio.js), avec réglages d'octave et de volume.
    trumpet: { id: 'trumpet', label: 'Trompette', icon: '🎺', kind: 'melodic', engine: 'trumpet', octaveShift: 0, defaultLength: 1, resizable: true, volumeDb: -14 },
    flute: { id: 'flute', label: 'Flûte', icon: '🪈', kind: 'melodic', engine: 'flute', octaveShift: 1, defaultLength: 1, resizable: true, volumeDb: -15 },
    // Voix synthétique : une source électronique passée dans des filtres de « voyelles » (moteur 'formant', voir audio.js).
    vox: { id: 'vox', label: 'Voix robot', icon: '🤖', kind: 'melodic', engine: 'formant', octaveShift: 0, defaultLength: 1, resizable: true, volumeDb: -4 },
    // Voix enregistrée au micro : pas de notes, un extrait audio placé dans la boucle (moteur 'clip').
    mic: { id: 'mic', label: 'Voix (micro)', icon: '🎤', kind: 'audio', engine: 'clip', octaveShift: 0, defaultLength: 1, resizable: false, volumeDb: -2 },
  };
  /** Instruments de base, dans l'ordre d'origine (utilisé par les personnages). La liste complète : GB.instruments.pickable(). */
  GB.INSTRUMENT_ORDER = ['piano', 'synth', 'bass', 'lead', 'drums'];

  /** Nombre de lignes affichées dans la grille pour cet instrument. */
  GB.getRowCount = function (instrumentId) {
    const kind = GB.INSTRUMENTS[instrumentId].kind;
    if (kind === 'audio') return 0; // une piste « voix micro » n'a pas de notes
    return kind === 'drums' ? GB.DRUM_PADS.length : GB.MELODIC_ROW_COUNT;
  };

  /** Décalage d'octave total : celui de l'instrument + celui des réglages de la piste (voix, instruments perso). */
  function totalOctaveShift(instrument, settings) {
    const extra = settings && Number.isFinite(settings.octave) ? Math.round(settings.octave) : 0;
    return instrument.octaveShift + extra;
  }

  /** Étiquette lisible d'une ligne (« Sol4 », « Caisse claire »…). */
  GB.getRowLabel = function (instrumentId, row, settings) {
    const instrument = GB.INSTRUMENTS[instrumentId];
    if (instrument.kind === 'drums') return GB.DRUM_PADS[row].label;
    const { degree, octave } = noteParts(row, totalOctaveShift(instrument, settings));
    return degree.label + octave;
  };

  /** Nom de note au format Tone.js (« G4 ») pour un instrument mélodique. */
  GB.getToneNote = function (instrumentId, row, settings) {
    const { degree, octave } = noteParts(row, totalOctaveShift(GB.INSTRUMENTS[instrumentId], settings));
    return degree.tone + octave;
  };

  /** Les lignes de « Do » sont mises en valeur dans la grille pour se repérer. */
  GB.isRootRow = function (instrumentId, row) {
    return GB.INSTRUMENTS[instrumentId].kind === 'melodic' && row % 12 === 0;
  };

  /** Ligne d'une touche noire (Do♯, Ré♯, Fa♯, Sol♯, La♯) ? */
  GB.isBlackRow = function (instrumentId, row) {
    return GB.INSTRUMENTS[instrumentId].kind === 'melodic' && SEMITONES[((row % 12) + 12) % 12].black;
  };

  /* ------------------------------------------------------------------ */
  /*  Composition de démonstration                                       */
  /* ------------------------------------------------------------------ */

  /** Les notes sont [colonne, ligne] ou [colonne, ligne, durée en temps]. */
  GB.DEMO = {
    bpm: 120,
    tracks: [
      {
        name: 'Batterie',
        instrumentId: 'drums',
        color: GB.CONFIG.TRACK_COLORS[0],
        notes: [
          // grosse caisse sur les temps pairs
          [0, 0], [2, 0], [4, 0], [6, 0], [8, 0], [10, 0], [12, 0],
          // caisse claire sur les temps impairs
          [1, 1], [3, 1], [5, 1], [7, 1], [9, 1], [11, 1], [13, 1],
          // petite roulade de toms à la fin
          [14, 5], [15, 6],
          // cymbale au début et à la moitié
          [0, 7], [8, 7],
        ],
      },
      {
        name: 'Basse',
        instrumentId: 'bass',
        color: GB.CONFIG.TRACK_COLORS[1],
        notes: [
          [0, 0, 2], [2, 0], [3, 3],
          [4, 4, 2], [6, 4], [7, 2],
          [8, 3, 2], [10, 3], [11, 1],
          [12, 2, 2], [14, 2], [15, 4],
        ],
      },
      {
        name: 'Arpège piano',
        instrumentId: 'piano',
        color: GB.CONFIG.TRACK_COLORS[2],
        notes: [
          [0, 5], [1, 7], [2, 8], [3, 7],
          [4, 4], [5, 5], [6, 7], [7, 5],
          [8, 3], [9, 6], [10, 8], [11, 6],
          [12, 2], [13, 4], [14, 7], [15, 4],
        ],
      },
      {
        name: 'Nappe douce',
        instrumentId: 'synth',
        color: GB.CONFIG.TRACK_COLORS[3],
        notes: [
          [0, 5, 4], [0, 8, 4],
          [4, 4, 4], [4, 7, 4],
          [8, 3, 4], [8, 6, 4],
          [12, 2, 4], [12, 4, 4],
        ],
      },
      {
        name: 'Mélodie',
        instrumentId: 'lead',
        color: GB.CONFIG.TRACK_COLORS[4],
        notes: [
          [0, 12, 2], [2, 13], [3, 12],
          [4, 11, 2], [6, 10], [7, 9],
          [8, 10, 2], [10, 11], [11, 12],
          [12, 13, 2], [14, 14], [15, 13],
        ],
      },
    ],
  };

  // La démo a été écrite en lignes pentatoniques : on la convertit en lignes chromatiques (mêmes hauteurs).
  GB.DEMO.tracks.forEach((track) => {
    if (GB.INSTRUMENTS[track.instrumentId].kind !== 'melodic') return;
    track.notes = track.notes.map((entry) => {
      const copy = entry.slice();
      copy[1] = GB.legacyRow(copy[1]);
      return copy;
    });
  });
})((window.GB = window.GB || {}));

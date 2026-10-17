/**
 * GARTIC BANDE — état de l'application.
 *
 * Source de vérité unique : la liste des pistes, le tempo et la piste sélectionnée.
 * Ce module ne touche ni au DOM ni à l'audio : l'interface relit simplement
 * l'état après chaque modification, ce qui évite de perdre des notes lors d'un
 * simple rafraîchissement d'affichage.
 *
 * Forme d'une piste :
 *   { id, name, instrumentId, color, muted, locked, author, turn,
 *     settings,   réglages de l'instrument (voix synthétique, instruments perso) : copie propre à la piste, ou null
 *     clip,       enregistrement vocal { id, wav, duration, peaks, start, gainDb } (instrument « mic »), ou null
 *     notes: [{ id, step, row, length }, ...] }
 *
 * Forme d'une note :
 *   step   = colonne de départ (entier)        → QUAND la note commence
 *   row    = ligne, 0 = note la plus grave     → QUELLE hauteur
 *   length = durée en colonnes (multiple de 0,25) → COMBIEN de temps elle dure
 *
 * Règles du piano-roll (appliquées ici, pas dans l'interface) :
 *   - une note reste dans les limites de la boucle ;
 *   - deux notes d'une même piste ne se chevauchent jamais sur la même ligne
 *     (en revanche, plusieurs lignes peuvent sonner en même temps : accords) ;
 *   - une piste verrouillée (`locked`, utilisée en mode partie) est en lecture seule.
 */
(function (GB) {
  'use strict';

  const { CONFIG } = GB;

  const state = {
    bpm: CONFIG.BPM_DEFAULT,
    tracks: [],
    selectedTrackId: null,
    nextTrackNumber: 1,
  };

  // Compteurs d'identifiants : jamais remis à zéro, donc jamais deux fois le même id.
  let trackCounter = 0;
  let noteCounter = 0;

  const EPSILON = 1e-9;

  /* ------------------------------------------------------------------ */
  /*  Utilitaires internes                                               */
  /* ------------------------------------------------------------------ */

  function pickFreeColor() {
    const used = state.tracks.map((track) => track.color);
    return CONFIG.TRACK_COLORS.find((color) => !used.includes(color)) || CONFIG.TRACK_COLORS[0];
  }

  function pickNextInstrumentId() {
    const used = state.tracks.map((track) => track.instrumentId);
    return GB.INSTRUMENT_ORDER.find((id) => !used.includes(id)) || GB.INSTRUMENT_ORDER[0];
  }

  // Précision de stockage : le millième de temps. Une valeur « libre » est arrondie à cette précision,
  // et l'audio utilise exactement la même valeur que l'affichage (voir audio.js, onStep).
  const PRECISION = 1000;
  const FREE_MIN_LENGTH = 0.05;

  function norm(value) {
    return Math.round(value * PRECISION) / PRECISION;
  }

  function snapStart(start) {
    return Math.round(start / CONFIG.DURATION_UNIT) * CONFIG.DURATION_UNIT;
  }

  /** Une durée lue dans une note existante ou demandée : jamais re-alignée de force, seulement ramenée à la précision. */
  function snapLength(length) {
    return norm(length);
  }

  /** Grille choisie : pas (1 = temps, 0,5 = demi-temps, 0,25 = quart, 0,125 = huitième, 1/3 = triolet) + aimant (alignement automatique). */
  const grid = { unit: 1, magnet: true };
  const GRID_UNITS = [1, 0.5, 0.25, 0.125, 1 / 3];

  /** Applique la grille à une position (en colonnes) : alignée sur le pas, ou libre (précision du millième). */
  function gridStep(raw, bypass) {
    if (grid.magnet && !bypass) return norm(Math.floor(raw / grid.unit + 1e-9) * grid.unit);
    return norm(raw);
  }

  /** Applique la grille à une durée : multiple du pas (au moins un pas), ou libre. */
  function gridLength(raw, bypass) {
    if (grid.magnet && !bypass) return Math.max(grid.unit, norm(Math.round(raw / grid.unit) * grid.unit));
    return Math.max(FREE_MIN_LENGTH, norm(raw));
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  /** Durée « effective » : la batterie ne tient pas ses sons, ses notes occupent toujours une colonne. */
  function lengthOf(track, note) {
    return GB.INSTRUMENTS[track.instrumentId].resizable ? note.length : 1;
  }

  /** Place réellement prise sur la ligne (pour les collisions) : un coup de batterie ne bloque qu'un quart de temps. */
  const DRUM_SLOT = 0.25;
  function occupiedOf(track, note) {
    return GB.INSTRUMENTS[track.instrumentId].resizable ? note.length : DRUM_SLOT;
  }

  /** Voyelles proposées pour la voix robot (chaque note de cette piste porte la sienne). */
  const VOWEL_IDS = ['a', 'e', 'i', 'o', 'u', 'ou'];
  GB.VOWEL_IDS = VOWEL_IDS;

  function isVowelTrack(track) {
    return GB.instruments.settingsEngine(track.instrumentId) === 'formant';
  }

  /** Voyelle par défaut d'une nouvelle note : celle qui est choisie dans les réglages de la piste. */
  function defaultVowel(track) {
    const chosen = track.settings && track.settings.vowel;
    return VOWEL_IDS.includes(chosen) ? chosen : 'a';
  }

  /** Copie « données » d'une note (sans identifiant), voyelle comprise : utilisée pour les contributions. */
  GB.noteData = function noteData(note) {
    const data = { step: note.step, row: note.row, length: note.length };
    if (VOWEL_IDS.includes(note.vowel)) data.vowel = note.vowel;
    return data;
  };

  function makeNote(track, step, row, length, vowel) {
    noteCounter += 1;
    const wanted = length === undefined ? GB.INSTRUMENTS[track.instrumentId].defaultLength : length;
    const note = { id: 'note-' + noteCounter, step: norm(step), row, length: Math.max(FREE_MIN_LENGTH, snapLength(wanted)) };
    if (isVowelTrack(track)) note.vowel = VOWEL_IDS.includes(vowel) ? vowel : defaultVowel(track);
    return note;
  }

  /** Une note [start, start+length[ sur `row` chevauche-t-elle une autre note de la piste ? */
  function collides(track, row, start, length, ignoredNoteId) {
    return track.notes.some(
      (other) =>
        other.id !== ignoredNoteId &&
        other.row === row &&
        start < other.step + occupiedOf(track, other) - EPSILON &&
        other.step < start + length - EPSILON
    );
  }

  /** Place disponible (en colonnes) à partir de `step` sur `row`, jusqu'à la prochaine note ou la fin de la boucle. */
  function roomFrom(track, step, row, ignoredNoteId) {
    if (collides(track, row, step, GB.INSTRUMENTS[track.instrumentId].resizable ? FREE_MIN_LENGTH : DRUM_SLOT, ignoredNoteId)) return 0;
    let limit = CONFIG.STEP_COUNT;
    track.notes.forEach((other) => {
      if (other.id !== ignoredNoteId && other.row === row && other.step > step) limit = Math.min(limit, other.step);
    });
    return norm(limit - step);
  }

  function cloneClip(clip) {
    return clip ? Object.assign({}, clip, { peaks: clip.peaks ? clip.peaks.slice() : [] }) : null;
  }

  function createTrack({ name, instrumentId, color, notes, muted, locked, author, turn, settings, clip }) {
    trackCounter += 1;
    const finalInstrumentId = instrumentId || pickNextInstrumentId();
    const track = {
      id: 'track-' + trackCounter,
      name: name || 'Piste ' + state.nextTrackNumber++,
      instrumentId: finalInstrumentId,
      settings: settings !== undefined ? (settings ? JSON.parse(JSON.stringify(settings)) : null) : GB.instruments.defaultSettings(finalInstrumentId),
      clip: cloneClip(clip),
      color: color || pickFreeColor(),
      muted: Boolean(muted),
      locked: Boolean(locked),
      author: author || null,
      turn: turn || null,
      notes: [],
    };
    // Les notes d'entrée peuvent être [colonne, ligne, durée?] ou { step, row, length? }.
    (notes || []).forEach((entry) => {
      const [step, row, length, vowel] = Array.isArray(entry) ? entry : [entry.step, entry.row, entry.length, entry.vowel];
      if (!Number.isFinite(step) || step < 0 || step >= CONFIG.STEP_COUNT || row < 0 || row >= GB.getRowCount(track.instrumentId)) return;
      const room = roomFrom(track, norm(step), row);
      if (room < FREE_MIN_LENGTH - EPSILON) return;
      const note = makeNote(track, step, row, length, vowel);
      note.length = Math.min(note.length, Math.floor(room * PRECISION) / PRECISION);
      track.notes.push(note);
    });
    return track;
  }

  function findTrack(trackId) {
    return state.tracks.find((track) => track.id === trackId) || null;
  }

  function findEditableTrack(trackId) {
    const track = findTrack(trackId);
    return track && !track.locked ? track : null;
  }

  /* ------------------------------------------------------------------ */
  /*  API publique                                                       */
  /* ------------------------------------------------------------------ */

  const store = {
    state,

    /* ----------------------------- lecture ----------------------------- */

    getTracks() {
      return state.tracks;
    },

    getTrack: findTrack,

    getSelectedTrack() {
      return findTrack(state.selectedTrackId);
    },

    getNote(trackId, noteId) {
      const track = findTrack(trackId);
      return track ? track.notes.find((note) => note.id === noteId) || null : null;
    },

    /** Y a-t-il une note qui DÉMARRE exactement sur cette cellule ? */
    hasNote(trackId, step, row) {
      const track = findTrack(trackId);
      return Boolean(track && track.notes.some((note) => Math.floor(note.step + 1e-6) === step && note.row === row));
    },

    /** Note qui occupe cette cellule (elle peut avoir démarré plus tôt, si elle est longue). */
    findNoteAt(trackId, step, row) {
      const track = findTrack(trackId);
      if (!track) return null;
      return (
        track.notes.find(
          (note) => note.row === row && step >= note.step && step < note.step + lengthOf(track, note) - EPSILON
        ) || null
      );
    },

    lengthOf,
    occupiedOf,

    /* ----------------------------- grille ------------------------------ */

    grid,
    GRID_UNITS,
    gridStep,
    gridLength,

    setGrid(patch) {
      if (patch && GRID_UNITS.includes(Number(patch.unit))) grid.unit = Number(patch.unit);
      if (patch && typeof patch.magnet === 'boolean') grid.magnet = patch.magnet;
      return grid;
    },

    /** Durée maximale que peut atteindre une note (jusqu'à la note suivante ou la fin de la boucle). */
    getMaxLength(trackId, noteId) {
      const track = findTrack(trackId);
      const note = track && track.notes.find((candidate) => candidate.id === noteId);
      if (!note) return 0;
      return roomFrom(track, note.step, note.row, note.id);
    },

    /* --------------------------- composition --------------------------- */

    /** Nouvelle page blanche : une seule piste de piano vide. */
    reset() {
      state.bpm = CONFIG.BPM_DEFAULT;
      state.nextTrackNumber = 1;
      state.tracks = [createTrack({ instrumentId: 'piano' })];
      state.selectedTrackId = state.tracks[0].id;
    },

    loadDemo() {
      state.bpm = GB.DEMO.bpm;
      state.nextTrackNumber = GB.DEMO.tracks.length + 1;
      state.tracks = GB.DEMO.tracks.map(createTrack);
      state.selectedTrackId = state.tracks[0].id;
    },

    /** Copie complète de l'éditeur (pour mettre la composition libre de côté pendant une partie). */
    snapshot() {
      return JSON.parse(JSON.stringify(state));
    },

    restore(snapshot) {
      state.bpm = snapshot.bpm;
      state.nextTrackNumber = snapshot.nextTrackNumber;
      state.tracks = snapshot.tracks;
      state.selectedTrackId = snapshot.selectedTrackId;
    },

    /** Mode partie : aucune piste au départ, elles arrivent tour après tour. */
    startGame(bpm) {
      state.bpm = bpm;
      state.nextTrackNumber = 1;
      state.tracks = [];
      state.selectedTrackId = null;
    },

    setBpm(value) {
      const bpm = Math.round(Number(value));
      if (!Number.isFinite(bpm)) return state.bpm;
      state.bpm = Math.min(CONFIG.BPM_MAX, Math.max(CONFIG.BPM_MIN, bpm));
      return state.bpm;
    },

    /* ------------------------------ pistes ----------------------------- */

    canAddTrack() {
      return state.tracks.length < CONFIG.MAX_TRACKS;
    },

    /** Ajoute une piste vide et la sélectionne. Renvoie la piste, ou null si la limite est atteinte. */
    addTrack() {
      if (!store.canAddTrack()) return null;
      const track = createTrack({});
      state.tracks.push(track);
      state.selectedTrackId = track.id;
      return track;
    },

    /** Ajoute une couche de partie (sans la limite des 8 pistes du mode libre) et la sélectionne. */
    addLayer(spec) {
      const track = createTrack(spec);
      state.tracks.push(track);
      state.selectedTrackId = track.id;
      return track;
    },

    lockTrack(trackId) {
      const track = findTrack(trackId);
      if (track) track.locked = true;
    },

    canRemoveTrack() {
      return state.tracks.length > 1;
    },

    /** Supprime une piste (il en reste toujours au moins une). */
    removeTrack(trackId) {
      if (!store.canRemoveTrack() || !findEditableTrack(trackId)) return false;
      const index = state.tracks.findIndex((track) => track.id === trackId);
      state.tracks.splice(index, 1);
      if (state.selectedTrackId === trackId) {
        const neighbour = state.tracks[Math.min(index, state.tracks.length - 1)];
        state.selectedTrackId = neighbour.id;
      }
      return true;
    },

    selectTrack(trackId) {
      if (!findTrack(trackId)) return false;
      state.selectedTrackId = trackId;
      return true;
    },

    setInstrument(trackId, instrumentId) {
      const track = findEditableTrack(trackId);
      if (!track || !GB.INSTRUMENTS[instrumentId] || track.instrumentId === instrumentId) return false;
      track.instrumentId = instrumentId;
      track.settings = GB.instruments.defaultSettings(instrumentId); // les notes et le clip de la piste sont conservés
      return true;
    },

    /** Modifie les réglages de l'instrument de la piste (valeurs ramenées dans les limites autorisées). */
    setSettings(trackId, patch) {
      const track = findEditableTrack(trackId);
      if (!track || !GB.instruments.settingsEngine(track.instrumentId)) return false;
      track.settings = GB.instruments.normalizeSettings(track.instrumentId, Object.assign({}, track.settings, patch));
      return true;
    },

    /** Remplace les réglages par ceux d'un instrument personnalisé modifié (fenêtre de création). */
    resetSettings(trackId) {
      const track = findEditableTrack(trackId);
      if (!track) return false;
      track.settings = GB.instruments.defaultSettings(track.instrumentId);
      return true;
    },

    /* ----------------------- enregistrement vocal ----------------------- */

    /** Place un enregistrement (clip) sur une piste « voix micro ». Remplace l'ancien : on recommence avant de valider. */
    setClip(trackId, clip) {
      const track = findEditableTrack(trackId);
      if (!track || GB.INSTRUMENTS[track.instrumentId].kind !== 'audio') return false;
      track.clip = cloneClip(clip);
      if (track.clip) track.clip.start = clamp(snapStart(track.clip.start), 0, CONFIG.STEP_COUNT - CONFIG.MIN_NOTE_LENGTH);
      return true;
    },

    clearClip(trackId) {
      const track = findEditableTrack(trackId);
      if (!track || !track.clip) return false;
      track.clip = null;
      return true;
    },

    /** Déplace le clip dans la boucle (pas d'un quart de temps, jamais hors de la boucle). */
    moveClip(trackId, start) {
      const track = findEditableTrack(trackId);
      if (!track || !track.clip) return false;
      const next = clamp(snapStart(start), 0, CONFIG.STEP_COUNT - CONFIG.MIN_NOTE_LENGTH);
      if (Math.abs(next - track.clip.start) < EPSILON) return false;
      track.clip.start = next;
      return true;
    },

    setClipGain(trackId, gainDb) {
      const track = findEditableTrack(trackId);
      if (!track || !track.clip) return false;
      track.clip.gainDb = clamp(Math.round(Number(gainDb) || 0), -24, 6);
      return true;
    },

    /** Y a-t-il du contenu à valider (des notes, ou un enregistrement pour une piste de voix) ? */
    hasContent(trackId) {
      const track = findTrack(trackId);
      if (!track) return false;
      return GB.INSTRUMENTS[track.instrumentId].kind === 'audio' ? Boolean(track.clip) : track.notes.length > 0;
    },

    toggleMute(trackId) {
      const track = findTrack(trackId);
      if (!track) return false;
      track.muted = !track.muted;
      return track.muted;
    },

    /* ------------------------------ notes ------------------------------ */

    /**
     * Pose une note de durée par défaut (raccourcie si une note suit sur la même ligne).
     * Renvoie la note, ou null si la cellule est déjà occupée / hors limites / piste verrouillée.
     */
    addNote(trackId, step, row) {
      const track = findEditableTrack(trackId);
      if (!track) return null;
      if (!Number.isFinite(step) || step < 0 || step >= CONFIG.STEP_COUNT) return null;
      if (!Number.isInteger(row) || row < 0 || row >= GB.getRowCount(track.instrumentId)) return null;
      step = norm(step);
      const room = roomFrom(track, step, row);
      if (room < FREE_MIN_LENGTH - EPSILON) return null;
      const note = makeNote(track, step, row);
      note.length = Math.min(note.length, Math.floor(room * PRECISION) / PRECISION);
      track.notes.push(note);
      return note;
    },

    /** Change la voyelle d'UNE note (voix robot) sans toucher aux autres. */
    setNoteVowel(trackId, noteId, vowel) {
      const track = findEditableTrack(trackId);
      if (!track || !isVowelTrack(track) || !VOWEL_IDS.includes(vowel)) return false;
      const note = track.notes.find((candidate) => candidate.id === noteId);
      if (!note || note.vowel === vowel) return false;
      note.vowel = vowel;
      return true;
    },

    removeNote(trackId, noteId) {
      const track = findEditableTrack(trackId);
      if (!track) return false;
      const index = track.notes.findIndex((note) => note.id === noteId);
      if (index === -1) return false;
      track.notes.splice(index, 1);
      return true;
    },

    /**
     * Déplace une note (départ + hauteur), sans changer sa durée.
     * La destination est ramenée dans les limites de la grille ; si elle tombe sur une autre
     * note de la même ligne, rien ne bouge. Renvoie true si la note a bougé.
     */
    moveNote(trackId, noteId, step, row) {
      const track = findEditableTrack(trackId);
      const note = track && track.notes.find((candidate) => candidate.id === noteId);
      if (!note) return false;
      const length = occupiedOf(track, note);
      const targetStep = clamp(norm(step), 0, Math.max(0, norm(CONFIG.STEP_COUNT - length)));
      const targetRow = clamp(Math.round(row), 0, GB.getRowCount(track.instrumentId) - 1);
      if (Math.abs(targetStep - note.step) < EPSILON && targetRow === note.row) return false;
      if (collides(track, targetRow, targetStep, length, note.id)) return false;
      note.step = targetStep;
      note.row = targetRow;
      return true;
    },

    /**
     * Change la durée d'une note : alignée sur la grille (pas de 0,25), jamais plus courte que
     * le minimum, jamais au-delà de la boucle ni sur la note suivante. Renvoie true si elle a changé.
     */
    resizeNote(trackId, noteId, length) {
      const track = findEditableTrack(trackId);
      const note = track && track.notes.find((candidate) => candidate.id === noteId);
      if (!note || !GB.INSTRUMENTS[track.instrumentId].resizable) return false;
      const maxLength = roomFrom(track, note.step, note.row, note.id);
      const next = clamp(snapLength(length), FREE_MIN_LENGTH, Math.max(FREE_MIN_LENGTH, maxLength));
      if (Math.abs(next - note.length) < EPSILON) return false;
      note.length = next;
      return true;
    },

    /** Efface les notes de la piste (et l'enregistrement, pour une piste de voix micro). */
    clearNotes(trackId) {
      const track = findEditableTrack(trackId);
      if (!track) return false;
      const isAudio = GB.INSTRUMENTS[track.instrumentId].kind === 'audio';
      if (isAudio) {
        if (!track.clip) return false;
        track.clip = null;
        return true;
      }
      if (track.notes.length === 0) return false;
      track.notes = [];
      return true;
    },
  };

  GB.store = store;
})((window.GB = window.GB || {}));

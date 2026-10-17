/**
 * GARTIC BANDE — registre des instruments : réglages, instruments personnalisés, instantanés.
 *
 * Trois familles d'instruments :
 *   - de base      piano, synthé, basse, lead, batterie (aucun réglage)
 *   - voix         « vox » (voix synthétique, moteur 'formant') et « mic » (voix enregistrée, moteur 'clip')
 *   - personnalisés  créés par le joueur : un nom + des réglages (moteur 'custom')
 *
 * Chaque piste garde une COPIE des réglages utilisés (`track.settings`) : modifier ou supprimer un
 * instrument personnalisé plus tard ne change donc jamais le son d'une couche déjà posée.
 * Les contributions embarquent aussi un « instantané » (nom, icône, moteur, réglages) :
 * c'est ce qui permettra de rejouer une contribution reçue d'un autre joueur (multijoueur).
 *
 * Ce module ne dépend ni du DOM ni de Tone.js. La liste des champs réglables (SCHEMAS) sert
 * à construire automatiquement les curseurs de l'interface.
 */
(function (GB) {
  'use strict';

  const STORAGE_KEY = 'gartic-bande.instruments.v1';
  const MAX_CUSTOM = 24;
  const NAME_MAX = 20;

  const WAVES = [
    { value: 'sine', label: 'Sinus' },
    { value: 'square', label: 'Carrée' },
    { value: 'triangle', label: 'Triangle' },
    { value: 'sawtooth', label: 'Dents de scie' },
  ];
  const VOWELS = ['a', 'e', 'i', 'o', 'u', 'ou'].map((value) => ({ value, label: value.toUpperCase() }));

  /**
   * Description des réglages de chaque moteur. `type` : 'range' (curseur) ou 'choice' (boutons).
   * Le moteur 'formant' est la voix synthétique ; 'custom' sert aux instruments créés par le joueur.
   */
  const SCHEMAS = {
    formant: [
      { key: 'vowel', label: 'Voyelle des nouvelles notes', type: 'choice', options: VOWELS, def: 'a' },
      { key: 'robot', label: 'Effet robot', type: 'range', min: 0, max: 1, step: 0.05, def: 0.55, format: 'percent' },
      { key: 'vibrato', label: 'Vibrato', type: 'range', min: 0, max: 1, step: 0.05, def: 0.2, format: 'percent' },
      { key: 'brightness', label: 'Brillance', type: 'range', min: 0, max: 1, step: 0.05, def: 0.6, format: 'percent' },
      { key: 'octave', label: 'Octave', type: 'range', min: -2, max: 2, step: 1, def: 0, format: 'signed' },
      { key: 'volume', label: 'Volume', type: 'range', min: -24, max: 6, step: 1, def: 0, format: 'db' },
    ],
    custom: [
      { key: 'wave', label: 'Forme d\'onde', type: 'choice', options: WAVES, def: 'sawtooth' },
      { key: 'octave', label: 'Octave', type: 'range', min: -2, max: 2, step: 1, def: 0, format: 'signed' },
      { key: 'detune', label: 'Accordage fin', type: 'range', min: -100, max: 100, step: 5, def: 0, format: 'cents' },
      { key: 'volume', label: 'Volume', type: 'range', min: -24, max: 6, step: 1, def: 0, format: 'db' },
      { key: 'attack', label: 'Attaque', type: 'range', min: 0.002, max: 1.5, step: 0.002, def: 0.02, format: 'seconds' },
      { key: 'release', label: 'Relâchement', type: 'range', min: 0.02, max: 3, step: 0.02, def: 0.3, format: 'seconds' },
      { key: 'reverb', label: 'Réverbération', type: 'range', min: 0, max: 1, step: 0.05, def: 0, format: 'percent' },
      { key: 'echo', label: 'Écho', type: 'range', min: 0, max: 1, step: 0.05, def: 0, format: 'percent' },
    ],
  };

  /**
   * Son importé (« Mes sons ») joué comme instrument. La hauteur de la note change la VITESSE de lecture
   * (comme un échantillonneur d'autrefois) : plus aigu = plus rapide donc plus court, plus grave = plus lent donc plus long.
   * Do4 est la hauteur d'origine du fichier. Le mode règle ce que devient la durée de la note.
   */
  SCHEMAS.sample = [
    {
      key: 'mode',
      label: 'Durée du son',
      type: 'choice',
      options: [
        { value: 'whole', label: 'Joué en entier' },
        { value: 'fit', label: 'Coupé à la fin de la note' },
      ],
      def: 'whole',
    },
    {
      key: 'pitched',
      label: 'Hauteur',
      type: 'choice',
      options: [
        { value: 'yes', label: 'Suit la note' },
        { value: 'no', label: 'Toujours l\'original' },
      ],
      def: 'yes',
    },
    { key: 'octave', label: 'Octave', type: 'range', min: -2, max: 2, step: 1, def: 0, format: 'signed' },
    { key: 'volume', label: 'Volume', type: 'range', min: -24, max: 12, step: 1, def: 0, format: 'db' },
  ];

  /** Trompette et flûte : instruments de base avec un moteur à eux (timbre fixe), mais octave et volume réglables. */
  SCHEMAS.trumpet = [
    { key: 'octave', label: 'Octave', type: 'range', min: -2, max: 2, step: 1, def: 0, format: 'signed' },
    { key: 'volume', label: 'Volume', type: 'range', min: -24, max: 6, step: 1, def: 0, format: 'db' },
  ];
  SCHEMAS.flute = SCHEMAS.trumpet.map((field) => Object.assign({}, field));

  const ICONS = ['🎛', '🔔', '🎷', '🎺', '🎻', '🪕', '🪗', '🛸', '🌊', '🔥', '❄️', '🍭'];

  function formatValue(field, value) {
    switch (field.format) {
      case 'percent':
        return Math.round(value * 100) + ' %';
      case 'db':
        return (value > 0 ? '+' : '') + value + ' dB';
      case 'signed':
        return (value > 0 ? '+' : '') + value;
      case 'cents':
        return (value > 0 ? '+' : '') + value + ' ¢';
      case 'seconds':
        return value < 1 ? Math.round(value * 1000) + ' ms' : value.toFixed(2) + ' s';
      default:
        return String(value);
    }
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  /** Remet des réglages (venant de n'importe où : curseurs, stockage, réseau) dans les limites autorisées. */
  function normalize(engine, raw) {
    const schema = SCHEMAS[engine];
    if (!schema) return null;
    const source = raw && typeof raw === 'object' ? raw : {};
    const out = {};
    schema.forEach((field) => {
      const value = source[field.key];
      if (field.type === 'choice') {
        out[field.key] = field.options.some((option) => option.value === value) ? value : field.def;
      } else {
        const number = Number(value);
        const base = Number.isFinite(number) ? number : field.def;
        const snapped = Math.round(base / field.step) * field.step;
        out[field.key] = Number(clamp(snapped, field.min, field.max).toFixed(4));
      }
    });
    if (engine === 'sample') out.sample = cleanSampleRef(source.sample);
    return out;
  }

  /**
   * Référence stable d'un son importé : son empreinte SHA-256 (64 caractères hexadécimaux) + un nom et une durée
   * pour l'affichage. Venant du réseau ou du stockage, tout est revérifié ici.
   */
  function cleanSampleRef(raw) {
    const ref = raw && typeof raw === 'object' ? raw : {};
    const hash = typeof ref.hash === 'string' && /^[0-9a-f]{64}$/.test(ref.hash) ? ref.hash : null;
    const duration = Number(ref.duration);
    return {
      hash,
      name: String(ref.name === undefined || ref.name === null ? 'Son' : ref.name).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 40) || 'Son',
      duration: Number.isFinite(duration) ? Math.min(600, Math.max(0, Math.round(duration * 1000) / 1000)) : 0,
    };
  }

  /* ------------------------------------------------------------------ */
  /*  Instruments personnalisés                                          */
  /* ------------------------------------------------------------------ */

  let customCounter = 0;
  const hidden = new Set(); // supprimés de la liste, mais gardés en mémoire pour les pistes qui les utilisent

  function readStorage() {
    try {
      const text = window.localStorage.getItem(STORAGE_KEY);
      const data = text ? JSON.parse(text) : [];
      return Array.isArray(data) ? data : [];
    } catch (error) {
      return [];
    }
  }

  function writeStorage() {
    try {
      const list = instruments.customList().map((meta) => ({ id: meta.id, label: meta.label, icon: meta.icon, settings: meta.settings }));
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
      return true;
    } catch (error) {
      return false; // stockage indisponible (navigation privée…) : l'instrument reste utilisable pendant la session
    }
  }

  function cleanName(name) {
    return String(name === undefined || name === null ? '' : name).replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
  }

  function registerCustom(def) {
    const settings = normalize('custom', def.settings);
    const meta = {
      id: def.id,
      label: cleanName(def.label) || 'Instrument',
      icon: def.icon || '🎛',
      kind: 'melodic',
      engine: 'custom',
      custom: true,
      octaveShift: 0,
      defaultLength: 1,
      resizable: true,
      volumeDb: -13,
      settings,
    };
    GB.INSTRUMENTS[meta.id] = meta;
    const number = Number(String(meta.id).replace(/\D+/g, ''));
    if (Number.isFinite(number)) customCounter = Math.max(customCounter, number);
    hidden.delete(meta.id);
    return meta;
  }

  /** Identifiant d'un instrument « son importé » : déduit de l'empreinte (deux joueurs qui ont le même fichier ont le même id). */
  function sampleIdOf(hash) {
    return 'sample-' + String(hash).slice(0, 12);
  }

  function registerSample({ hash, name, duration, settings }) {
    const ref = cleanSampleRef({ hash, name, duration });
    if (!ref.hash) return null;
    const id = sampleIdOf(ref.hash);
    const base = normalize('sample', Object.assign({}, settings || {}, { sample: ref }));
    const existing = GB.INSTRUMENTS[id];
    const meta = {
      id,
      label: cleanName(ref.name) || 'Son',
      icon: '🎧',
      kind: 'melodic',
      engine: 'sample',
      sample: true,
      custom: false,
      octaveShift: 0,
      defaultLength: 1,
      resizable: true,
      volumeDb: -8,
      settings: existing && existing.settings ? existing.settings : base,
    };
    if (existing && existing.sample) {
      existing.label = meta.label; // le nom de la bibliothèque peut changer ; les réglages et l'empreinte jamais
      sampleHidden.delete(id);
      return existing;
    }
    GB.INSTRUMENTS[id] = meta;
    sampleHidden.delete(id);
    return meta;
  }

  const sampleHidden = new Set(); // sons importés connus (couches, contributions) mais pas dans la liste de ce joueur

  const instruments = {
    SCHEMAS,
    sampleIdOf,
    registerSample,
    cleanSampleRef,

    /** Les instruments « son importé » proposés dans les listes. */
    sampleList() {
      return Object.values(GB.INSTRUMENTS).filter((meta) => meta.sample && !sampleHidden.has(meta.id));
    },

    /** Retire un son importé de la liste des instruments (les couches qui l'utilisent gardent leur son). */
    hideSample(instrumentId) {
      if (GB.INSTRUMENTS[instrumentId] && GB.INSTRUMENTS[instrumentId].sample) sampleHidden.add(instrumentId);
    },
    WAVES,
    ICONS,
    NAME_MAX,
    MAX_CUSTOM,
    formatValue,

    /** Charge les instruments sauvegardés dans ce navigateur (appelé au démarrage). */
    load() {
      readStorage().forEach((entry) => {
        if (entry && typeof entry.id === 'string' && /^custom-\d+$/.test(entry.id)) registerCustom(entry);
      });
    },

    /** Les instruments personnalisés visibles dans les listes. */
    customList() {
      return Object.values(GB.INSTRUMENTS).filter((meta) => meta.custom && !hidden.has(meta.id));
    },

    /** Tous les instruments proposés au joueur, dans l'ordre : base, voix, personnalisés. */
    pickable() {
      return GB.INSTRUMENT_ORDER.concat(['trumpet', 'flute', 'vox', 'mic'], instruments.customList().map((meta) => meta.id), instruments.sampleList().map((meta) => meta.id));
    },

    get(instrumentId) {
      return GB.INSTRUMENTS[instrumentId] || null;
    },

    /** Moteur de réglages d'un instrument (null si l'instrument n'a aucun réglage). */
    settingsEngine(instrumentId) {
      const meta = GB.INSTRUMENTS[instrumentId];
      return meta && SCHEMAS[meta.engine] ? meta.engine : null;
    },

    /** Réglages de départ d'un instrument (copie) : null pour les instruments sans réglages. */
    defaultSettings(instrumentId) {
      const meta = GB.INSTRUMENTS[instrumentId];
      const engine = instruments.settingsEngine(instrumentId);
      if (!meta || !engine) return null;
      return normalize(engine, meta.custom || meta.sample ? meta.settings : {});
    },

    /** Réglages par défaut / normalisés d'un moteur (sans passer par un instrument). */
    engineDefaults(engine) {
      return normalize(engine, {});
    },

    normalizeEngineSettings(engine, raw) {
      return normalize(engine, raw);
    },

    normalizeSettings(instrumentId, raw) {
      const engine = instruments.settingsEngine(instrumentId);
      return engine ? normalize(engine, raw) : null;
    },

    /** Crée ou modifie un instrument personnalisé. Renvoie { ok, meta } ou { ok: false, error }. */
    saveCustom({ id, label, icon, settings }) {
      const name = cleanName(label);
      if (!name) return { ok: false, error: 'Donne un nom à ton instrument.' };
      const clash = instruments.customList().some((meta) => meta.id !== id && meta.label.toLowerCase() === name.toLowerCase());
      if (clash) return { ok: false, error: 'Un instrument porte déjà ce nom : choisis-en un autre.' };
      const isNew = !id || !GB.INSTRUMENTS[id];
      if (isNew && instruments.customList().length >= MAX_CUSTOM) {
        return { ok: false, error: 'Tu as atteint le maximum de ' + MAX_CUSTOM + ' instruments personnalisés.' };
      }
      const finalId = isNew ? 'custom-' + (customCounter + 1) : id;
      const meta = registerCustom({ id: finalId, label: name, icon, settings });
      const saved = writeStorage();
      return { ok: true, meta, saved };
    },

    /** « Supprime » un instrument personnalisé : il disparaît des listes, les pistes qui l'utilisent gardent leur son. */
    deleteCustom(instrumentId) {
      const meta = GB.INSTRUMENTS[instrumentId];
      if (!meta || !meta.custom) return false;
      hidden.add(instrumentId);
      writeStorage();
      return true;
    },

    /**
     * Instantané sérialisable d'un instrument + de ses réglages : de quoi le rejouer ailleurs
     * (mémoire de contribution, futur envoi réseau).
     */
    snapshot(instrumentId, settings) {
      const meta = GB.INSTRUMENTS[instrumentId];
      return {
        id: meta.id,
        label: meta.label,
        icon: meta.icon,
        kind: meta.kind,
        engine: meta.engine || 'builtin',
        settings: settings ? JSON.parse(JSON.stringify(settings)) : null,
      };
    },

    /** Réenregistre un instrument personnalisé inconnu à partir d'un instantané (contribution reçue). */
    ensure(snapshot) {
      if (!snapshot || GB.INSTRUMENTS[snapshot.id]) return Boolean(snapshot && GB.INSTRUMENTS[snapshot.id]);
      if (snapshot.engine === 'sample') {
        const ref = cleanSampleRef(snapshot.settings && snapshot.settings.sample);
        if (!ref.hash || snapshot.id !== sampleIdOf(ref.hash)) return false;
        registerSample({ hash: ref.hash, name: ref.name, duration: ref.duration, settings: snapshot.settings });
        sampleHidden.add(snapshot.id); // utilisable, mais pas ajouté à la liste de ce joueur
        return true;
      }
      if (snapshot.engine !== 'custom' || !/^custom-\d+$/.test(snapshot.id)) return false;
      registerCustom({ id: snapshot.id, label: snapshot.label, icon: snapshot.icon, settings: snapshot.settings });
      hidden.add(snapshot.id); // utilisable, mais pas ajouté à la liste de ce joueur
      return true;
    },
  };

  GB.instruments = instruments;
})((window.GB = window.GB || {}));

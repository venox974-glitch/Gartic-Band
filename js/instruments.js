/**
 * GARTIC BANDE — registre des instruments : réglages, sons importés, instantanés.
 *
 * Quatre familles d'instruments :
 *   - de base      piano, synthé, basse, lead, batterie, trompette, flûte
 *   - voix         « vox » (voix synthétique, moteur 'formant') et « mic » (voix enregistrée, moteur 'clip')
 *   - sons importés  « Mes sons » : un fichier du joueur joué comme un instrument (moteur 'sample')
 *   - personnalisés  « Mes instruments » : un synthétiseur réglé par le joueur (moteur 'custom', voir js/synth.js)
 *
 * Chaque piste garde une COPIE des réglages utilisés (`track.settings`).
 * Les contributions embarquent aussi un « instantané » (nom, icône, moteur, réglages) :
 * c'est ce qui permet de rejouer une contribution reçue d'un autre joueur (multijoueur).
 *
 * Ce module ne dépend ni du DOM ni de Tone.js. La liste des champs réglables (SCHEMAS) sert
 * à construire automatiquement les curseurs de l'interface.
 */
(function (GB) {
  'use strict';

  const NAME_MAX = 20;

  const VOWELS = ['a', 'e', 'i', 'o', 'u', 'ou'].map((value) => ({ value, label: value.toUpperCase() }));

  /**
   * Description des réglages de chaque moteur. `type` : 'range' (curseur) ou 'choice' (boutons).
   * Le moteur 'formant' est la voix synthétique.
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
  };
  // Instrument personnalisé : la liste des réglages vient de js/synth.js (partagée avec le serveur).
  SCHEMAS.custom = GB.synth.FIELDS;

  /**
   * Son importé (« Mes sons ») joué comme instrument. La hauteur de la note décale la HAUTEUR du son SANS changer sa vitesse
   * ni sa durée (voir js/pitch.js). Do4 est la hauteur d'origine du fichier. Le mode règle ce que devient la durée de la note.
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
      case 'cutoff':
        return Math.round(GB.synth.cutoffHz(value) / 10) * 10 + ' Hz';
      case 'octaves':
        return value === 0 ? 'aucun' : '+' + value.toFixed(1) + ' oct.';
      case 'hz':
        return value + ' Hz';
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
    if (engine === 'custom') return GB.synth.normalize(raw);
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

  function cleanName(name) {
    return String(name === undefined || name === null ? '' : name).replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
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
      icon: 'ins-sample',
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

  /* ------------------------------------------------------------------ */
  /*  Instruments personnalisés (synthé réglable)                        */
  /* ------------------------------------------------------------------ */

  const STORAGE_KEY = 'gartic-bande.synths.v1';
  const customHidden = new Set(); // supprimés / remplacés / reçus d'un autre joueur : connus mais pas dans MA liste

  function readStorage() {
    try {
      const data = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '[]');
      return Array.isArray(data) ? data : [];
    } catch (error) {
      return [];
    }
  }

  function writeStorage() {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(instruments.customList().map((meta) => meta.settings)));
      return true;
    } catch (error) {
      return false; // stockage indisponible (navigation privée…) : l'instrument reste utilisable pendant la session
    }
  }

  /** Déclare un instrument personnalisé (ou le retrouve) à partir de ses réglages. L'identifiant est calculé, jamais choisi. */
  function registerCustom(rawSettings) {
    const settings = GB.synth.normalize(rawSettings);
    const id = GB.synth.idOf(settings);
    if (GB.INSTRUMENTS[id]) return GB.INSTRUMENTS[id];
    const meta = {
      id,
      label: settings.label,
      icon: settings.icon,
      kind: 'melodic',
      engine: 'custom',
      custom: true,
      octaveShift: 0,
      defaultLength: 1,
      resizable: true,
      volumeDb: -13,
      settings,
    };
    GB.INSTRUMENTS[id] = meta;
    return meta;
  }

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
    NAME_MAX,
    formatValue,

    /** Charge les instruments personnalisés sauvegardés dans ce navigateur (appelé au démarrage). */
    load() {
      readStorage().forEach((entry) => {
        const meta = registerCustom(entry);
        customHidden.delete(meta.id);
      });
    },

    /** Mes instruments personnalisés (ceux qui apparaissent dans les listes). */
    customList() {
      return Object.values(GB.INSTRUMENTS).filter((meta) => meta.custom && !customHidden.has(meta.id));
    },

    /**
     * Enregistre un instrument personnalisé. `previousId` : l'instrument modifié (il est retiré de la liste, les couches qui
     * l'utilisent gardent leur son). Renvoie { ok, meta, saved } ou { ok: false, error }.
     */
    saveCustom(rawSettings, previousId) {
      const settings = GB.synth.normalize(rawSettings);
      if (!cleanName(rawSettings && rawSettings.label)) return { ok: false, error: 'Donne un nom à ton instrument.' };
      const id = GB.synth.idOf(settings);
      const clash = instruments.customList().some((meta) => meta.id !== id && meta.id !== previousId && meta.label.toLowerCase() === settings.label.toLowerCase());
      if (clash) return { ok: false, error: 'Un de tes instruments porte déjà ce nom : choisis-en un autre.' };
      const isNew = !previousId || !GB.INSTRUMENTS[previousId];
      if (isNew && !GB.INSTRUMENTS[id] && instruments.customList().length >= GB.synth.MAX_CUSTOM) {
        return { ok: false, error: 'Tu as atteint le maximum de ' + GB.synth.MAX_CUSTOM + ' instruments personnalisés : supprime-en un.' };
      }
      if (previousId && previousId !== id && GB.INSTRUMENTS[previousId] && GB.INSTRUMENTS[previousId].custom) customHidden.add(previousId);
      const meta = registerCustom(settings);
      customHidden.delete(meta.id);
      return { ok: true, meta, saved: writeStorage() };
    },

    /** « Supprime » un instrument personnalisé : il disparaît des listes, les couches qui l'utilisent gardent leur son. */
    deleteCustom(instrumentId) {
      const meta = GB.INSTRUMENTS[instrumentId];
      if (!meta || !meta.custom) return false;
      customHidden.add(instrumentId);
      writeStorage();
      return true;
    },

    /**
     * Retrouve (ou déclare) l'instrument personnalisé d'un autre joueur à partir de son identifiant et de ses réglages.
     * Refuse tout ce qui n'est pas cohérent (identifiant ≠ empreinte des réglages). Il n'est pas ajouté à MA liste.
     */
    ensureCustom(instrumentId, settings) {
      if (GB.INSTRUMENTS[instrumentId]) return Boolean(GB.INSTRUMENTS[instrumentId].custom);
      const checked = GB.synth.verify(instrumentId, settings);
      if (!checked.ok) return false;
      const meta = registerCustom(checked.settings);
      customHidden.add(meta.id);
      return true;
    },

    /** Les instruments proposés au joueur (ceux qu'il a équipés dans le Casier), dans l'ordre : base, trompette et flûte, voix, mes instruments, sons importés. */
    pickable() {
      if (GB.locker) return GB.locker.equipped(); // seuls les sons ÉQUIPÉS dans le Casier sont proposés
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
      return normalize(engine, meta.sample || meta.custom ? meta.settings : {});
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

    /** Réenregistre un son importé inconnu à partir d'un instantané (contribution reçue). */
    ensure(snapshot) {
      if (!snapshot || GB.INSTRUMENTS[snapshot.id]) return Boolean(snapshot && GB.INSTRUMENTS[snapshot.id]);
      if (snapshot.engine === 'sample') {
        const ref = cleanSampleRef(snapshot.settings && snapshot.settings.sample);
        if (!ref.hash || snapshot.id !== sampleIdOf(ref.hash)) return false;
        registerSample({ hash: ref.hash, name: ref.name, duration: ref.duration, settings: snapshot.settings });
        sampleHidden.add(snapshot.id); // utilisable, mais pas ajouté à la liste de ce joueur
        return true;
      }
      if (snapshot.engine === 'custom') return instruments.ensureCustom(snapshot.id, snapshot.settings);
      return false;
    },
  };

  GB.instruments = instruments;
  instruments.load();
})((window.GB = window.GB || {}));

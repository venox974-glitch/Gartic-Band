/**
 * GARTIC BANDE — l'instrument personnalisé : description des réglages, nettoyage, identifiant.
 *
 * Module SANS dépendance (ni DOM, ni Tone.js) : utilisé par le navigateur ET par le serveur.
 *   - le navigateur s'en sert pour fabriquer l'éditeur d'instrument et le son (js/audio.js) ;
 *   - le serveur s'en sert pour vérifier qu'un instrument reçu d'un joueur est bien un instrument valide
 *     (toutes les valeurs ramenées dans les limites) et que son identifiant correspond à ses réglages.
 *
 * Un instrument personnalisé est entièrement décrit par son objet de réglages (nom et icône compris).
 * Son identifiant est calculé à partir de ces réglages : « custom- » + 12 caractères (empreinte).
 * Deux joueurs qui ont exactement le même instrument ont donc le même identifiant, et modifier un instrument
 * crée un nouvel identifiant (les couches qui utilisaient l'ancien gardent leur son).
 *
 * Pour ajouter un réglage : l'ajouter dans FIELDS (clé, groupe, bornes, valeur par défaut) puis l'utiliser dans
 * createCustomVoice() de js/audio.js. L'éditeur se met à jour tout seul.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else {
    root.GB = root.GB || {};
    root.GB.synth = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const LABEL_MAX = 20;
  const MAX_CUSTOM = 24; // nombre d'instruments personnalisés gardés par joueur
  const HARMONICS = 16; // nombre de barres de la forme d'onde dessinée

  // Icônes proposées (noms de js/icons.js). LEGACY_ICONS : l'ancien émoji de chaque icône, gardé UNIQUEMENT pour que l'identifiant
  // d'un instrument déjà créé ne change pas (il est calculé sur les réglages) et pour relire les anciennes sauvegardes.
  const ICONS = ['knob', 'piano', 'guitar', 'trumpet', 'sax', 'violin', 'accordion', 'drum', 'bell', 'alien', 'rocket', 'wave', 'flame', 'snow', 'moon', 'star', 'mushroom', 'frog', 'duck', 'ghost', 'robot', 'pumpkin', 'candy', 'rainbow'];
  const LEGACY_ICONS = {
    knob: '\u{1f39b}',
    piano: '\u{1f3b9}',
    guitar: '\u{1f3b8}',
    trumpet: '\u{1f3ba}',
    sax: '\u{1f3b7}',
    violin: '\u{1f3bb}',
    accordion: '\u{1fa97}',
    drum: '\u{1f941}',
    bell: '\u{1f514}',
    alien: '\u{1f47e}',
    rocket: '\u{1f680}',
    wave: '\u{1f30a}',
    flame: '\u{1f525}',
    snow: '\u{2744}\u{fe0f}',
    moon: '\u{1f319}',
    star: '\u{2b50}',
    mushroom: '\u{1f344}',
    frog: '\u{1f438}',
    duck: '\u{1f986}',
    ghost: '\u{1f47b}',
    robot: '\u{1f916}',
    pumpkin: '\u{1f383}',
    candy: '\u{1f36d}',
    rainbow: '\u{1f308}',
  };

  const WAVES = [
    { value: 'sine', label: 'Sinus' },
    { value: 'triangle', label: 'Triangle' },
    { value: 'square', label: 'Carré' },
    { value: 'sawtooth', label: 'Scie' },
    { value: 'drawn', label: 'Dessinée' },
  ];
  const WAVES2 = [{ value: 'none', label: 'Aucune' }].concat(WAVES.filter((wave) => wave.value !== 'drawn'));
  const FILTERS = [
    { value: 'none', label: 'Aucun' },
    { value: 'lowpass', label: 'Grave (adoucit)' },
    { value: 'highpass', label: 'Aigu (affine)' },
    { value: 'bandpass', label: 'Bande (nasal)' },
  ];

  /** Groupes de l'éditeur (dans l'ordre). */
  const GROUPS = [
    { id: 'source', label: 'Son de base', help: 'La forme de l\'onde : ce qui donne le « timbre ». Choisis une forme ou dessine la tienne.' },
    { id: 'second', label: 'Deuxième onde', help: 'Mélange une deuxième forme d\'onde, décalée, pour un son plus riche.' },
    { id: 'thick', label: 'Voix épaisses', help: 'Plusieurs ondes légèrement désaccordées jouent ensemble (effet « supersaw »).' },
    { id: 'pitch', label: 'Hauteur', help: '' },
    { id: 'envelope', label: 'Enveloppe (la vie d\'une note)', help: 'Attaque : la montée · Déclin : la descente · Tenue : le niveau pendant la note · Relâchement : la fin.' },
    { id: 'filter', label: 'Filtre', help: 'Coupe une partie des fréquences. Le « balayage » ouvre le filtre au début de chaque note (effet wah).' },
    { id: 'motion', label: 'Mouvement', help: 'Vibrato : la hauteur ondule · Trémolo : le volume ondule.' },
    { id: 'fx', label: 'Effets', help: '' },
    { id: 'level', label: 'Volume', help: '' },
  ];

  function r(min, max, step, def, format) {
    return { type: 'range', min, max, step, def, format };
  }

  /** Les réglages. `group` : section de l'éditeur. Les champs `hidden` ne sont pas des curseurs. */
  const FIELDS = [
    Object.assign({ key: 'label', type: 'text', def: 'Instrument', hidden: true }),
    Object.assign({ key: 'icon', type: 'icon', def: 'knob', hidden: true }),
    { key: 'wave', label: 'Forme d\'onde', group: 'source', type: 'choice', options: WAVES, def: 'sawtooth' },
    { key: 'harmonics', label: 'Harmoniques', group: 'source', type: 'harmonics', hidden: true, def: [1, 0.5, 0.33, 0.25, 0.2, 0.17, 0.14, 0.12, 0.11, 0.1, 0.09, 0.08, 0.08, 0.07, 0.07, 0.06] },
    Object.assign({ key: 'wave2', label: 'Forme d\'onde 2', group: 'second', type: 'choice', options: WAVES2, def: 'none' }),
    Object.assign({ key: 'mix2', label: 'Quantité de l\'onde 2', group: 'second' }, r(0, 1, 0.05, 0.5, 'percent')),
    Object.assign({ key: 'octave2', label: 'Octave de l\'onde 2', group: 'second' }, r(-2, 2, 1, 0, 'signed')),
    Object.assign({ key: 'detune2', label: 'Désaccord de l\'onde 2', group: 'second' }, r(-100, 100, 1, 7, 'cents')),
    Object.assign({ key: 'unison', label: 'Nombre de voix', group: 'thick' }, r(1, 5, 1, 1, 'plain')),
    Object.assign({ key: 'spread', label: 'Écart entre les voix', group: 'thick' }, r(0, 80, 1, 20, 'cents')),
    Object.assign({ key: 'octave', label: 'Octave', group: 'pitch' }, r(-2, 2, 1, 0, 'signed')),
    Object.assign({ key: 'detune', label: 'Accordage fin', group: 'pitch' }, r(-100, 100, 5, 0, 'cents')),
    Object.assign({ key: 'attack', label: 'Attaque', group: 'envelope' }, r(0.002, 1.5, 0.002, 0.02, 'seconds')),
    Object.assign({ key: 'decay', label: 'Déclin', group: 'envelope' }, r(0.02, 2, 0.02, 0.2, 'seconds')),
    Object.assign({ key: 'sustain', label: 'Tenue', group: 'envelope' }, r(0, 1, 0.05, 0.7, 'percent')),
    Object.assign({ key: 'release', label: 'Relâchement', group: 'envelope' }, r(0.02, 3, 0.02, 0.3, 'seconds')),
    { key: 'filterType', label: 'Type de filtre', group: 'filter', type: 'choice', options: FILTERS, def: 'none' },
    Object.assign({ key: 'cutoff', label: 'Coupure', group: 'filter' }, r(0, 100, 1, 70, 'cutoff')),
    Object.assign({ key: 'resonance', label: 'Résonance', group: 'filter' }, r(0, 1, 0.05, 0.2, 'percent')),
    Object.assign({ key: 'sweep', label: 'Balayage (wah)', group: 'filter' }, r(0, 4, 0.1, 0, 'octaves')),
    Object.assign({ key: 'vibrato', label: 'Vibrato', group: 'motion' }, r(0, 1, 0.05, 0, 'percent')),
    Object.assign({ key: 'vibratoRate', label: 'Vitesse du vibrato', group: 'motion' }, r(0.5, 12, 0.5, 5, 'hz')),
    Object.assign({ key: 'tremolo', label: 'Trémolo', group: 'motion' }, r(0, 1, 0.05, 0, 'percent')),
    Object.assign({ key: 'tremoloRate', label: 'Vitesse du trémolo', group: 'motion' }, r(0.5, 12, 0.5, 5, 'hz')),
    Object.assign({ key: 'chorus', label: 'Chorus', group: 'fx' }, r(0, 1, 0.05, 0, 'percent')),
    Object.assign({ key: 'distortion', label: 'Distorsion', group: 'fx' }, r(0, 1, 0.05, 0, 'percent')),
    Object.assign({ key: 'echo', label: 'Écho', group: 'fx' }, r(0, 1, 0.05, 0, 'percent')),
    Object.assign({ key: 'reverb', label: 'Réverbération', group: 'fx' }, r(0, 1, 0.05, 0, 'percent')),
    Object.assign({ key: 'volume', label: 'Volume', group: 'level' }, r(-24, 6, 1, 0, 'db')),
  ];

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function cleanLabel(value) {
    return String(value === undefined || value === null ? '' : value)
      .replace(/[\u0000-\u001f\u007f<>]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, LABEL_MAX);
  }

  function cleanHarmonics(raw, fallback) {
    const list = Array.isArray(raw) ? raw : [];
    const out = [];
    for (let index = 0; index < HARMONICS; index += 1) {
      const number = Number(list[index]);
      const base = Number.isFinite(number) ? number : fallback[index];
      out.push(Number(clamp(Math.round(base * 100) / 100, 0, 1).toFixed(2)));
    }
    if (out.every((value) => value === 0)) out[0] = 1; // une onde sans aucune harmonique serait muette
    return out;
  }

  function iconFromLegacy(value) {
    return ICONS.find((key) => LEGACY_ICONS[key] === value) || null;
  }

  /** Remet des réglages (venant de n'importe où : curseurs, stockage, réseau) dans les limites autorisées. Renvoie toujours un objet complet. */
  function normalize(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const out = {};
    FIELDS.forEach((field) => {
      const value = source[field.key];
      if (field.type === 'choice') {
        out[field.key] = field.options.some((option) => option.value === value) ? value : field.def;
      } else if (field.type === 'harmonics') {
        out[field.key] = cleanHarmonics(value, field.def);
      } else if (field.type === 'text') {
        out[field.key] = cleanLabel(value) || field.def;
      } else if (field.type === 'icon') {
        out[field.key] = ICONS.includes(value) ? value : iconFromLegacy(value) || field.def;
      } else {
        const number = Number(value);
        const base = Number.isFinite(number) ? number : field.def;
        const snapped = Math.round(base / field.step) * field.step;
        out[field.key] = Number(clamp(snapped, field.min, field.max).toFixed(4));
      }
    });
    return out;
  }

  /** Empreinte 53 bits d'un texte (cyrb53) : suffit pour distinguer des instruments, pas faite pour la sécurité. */
  function hash53(text) {
    let h1 = 0xdeadbeef;
    let h2 = 0x41c6ce57;
    for (let index = 0; index < text.length; index += 1) {
      const code = text.charCodeAt(index);
      h1 = Math.imul(h1 ^ code, 2654435761);
      h2 = Math.imul(h2 ^ code, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
  }

  /** Identifiant d'un instrument : calculé sur ses réglages NORMALISÉS (même instrument = même identifiant, partout). */
  function idOf(settings) {
    const clean = normalize(settings);
    return 'custom-' + hash53(JSON.stringify(FIELDS.map((field) => (field.type === 'icon' ? LEGACY_ICONS[clean[field.key]] : clean[field.key])))).slice(0, 12);
  }

  const ID_PATTERN = /^custom-[0-9a-f]{12}$/;

  function isCustomId(id) {
    return typeof id === 'string' && ID_PATTERN.test(id);
  }

  /** Fréquence de coupure (Hz) pour la position 0-100 du curseur : échelle logarithmique de 60 Hz à environ 11 kHz. */
  function cutoffHz(position) {
    return 60 * Math.pow(2, (clamp(Number(position) || 0, 0, 100) / 100) * 7.5);
  }

  /**
   * Vérifie un instrument reçu d'ailleurs (serveur, contribution) : `settings` doit se normaliser en un instrument dont l'identifiant
   * est `instrumentId`. Renvoie { ok: true, settings } (réglages nettoyés) ou { ok: false }.
   */
  function verify(instrumentId, settings) {
    if (!isCustomId(instrumentId) || !settings || typeof settings !== 'object') return { ok: false };
    const clean = normalize(settings);
    if (idOf(clean) !== instrumentId) return { ok: false };
    return { ok: true, settings: clean };
  }

  return { FIELDS, GROUPS, WAVES, WAVES2, FILTERS, ICONS, LABEL_MAX, MAX_CUSTOM, HARMONICS, normalize, idOf, isCustomId, cutoffHz, verify };
});

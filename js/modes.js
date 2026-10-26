/**
 * GARTIC BANDE — registre des modes de jeu (règles pures, sans DOM ni réseau).
 *
 * Utilisé par le navigateur (liste du salon) ET par le serveur (validation du mode choisi) : une seule définition.
 * Un mode décrit ce qui le distingue ; le moteur de rounds (js/rounds.js : la rotation des chansons) reste commun.
 *
 * Champs d'un mode :
 *   id            identifiant stocké dans les réglages du salon (`gameMode`)
 *   label, icon, blurb   affichage dans le salon
 *   available     false = visible mais « En préparation » (refusé par le serveur)
 *   online/offline    où le mode peut se jouer (le mode hors ligne = partie de test locale avec des robots)
 *   players       [min, max] de joueurs pour ce mode
 *   roundSeconds  { default, recommended } durée d'un round de composition (secondes)
 *
 * Ajouter un mode = ajouter une entrée ici, puis les règles de ses rounds. BUILD UP reste le mode par défaut.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else {
    root.GB = root.GB || {};
    root.GB.modes = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DEFAULT = 'buildup';

  const MODES = [
    {
      id: 'buildup',
      icon: 'blocks',
      label: 'BUILD UP',
      blurb: 'Chaque joueur crée la base de sa chanson, puis tout le monde ajoute sa couche à la chanson d\'un autre. Révélation couche après couche.',
      available: true,
      online: true,
      offline: true,
      players: [2, 8],
      roundSeconds: { default: 90, recommended: 90 },
    },
    {
      id: 'phone',
      icon: 'phone',
      label: 'Phone',
      blurb: 'Téléphone arabe musical : un thème devient une composition, puis une voix, puis une copie au piano-roll… et le dernier joueur devine la chanson.',
      available: true,
      online: true,
      offline: false,
      players: [3, 8],
      roundSeconds: { default: 300, recommended: 300 },
    },
    { id: 'duel', icon: 'swords', label: 'Duel de mélodies', blurb: 'Deux équipes, un thème.', available: false, online: true, offline: false, players: [4, 8], roundSeconds: { default: 90, recommended: 90 } },
    { id: 'blind', icon: 'eyeoff', label: 'Écoute à l\'aveugle', blurb: 'Compose sans voir les autres couches.', available: false, online: true, offline: false, players: [2, 8], roundSeconds: { default: 90, recommended: 90 } },
    { id: 'remix', icon: 'shuffle', label: 'Remix', blurb: 'Transforme la chanson d\'un autre.', available: false, online: true, offline: false, players: [2, 8], roundSeconds: { default: 90, recommended: 90 } },
  ];

  function list() {
    return MODES.map((mode) => Object.assign({}, mode, { players: mode.players.slice(), roundSeconds: Object.assign({}, mode.roundSeconds) }));
  }

  function ids() {
    return MODES.map((mode) => mode.id);
  }

  /** Les modes réellement jouables (les seuls que le serveur accepte). */
  function availableIds() {
    return MODES.filter((mode) => mode.available).map((mode) => mode.id);
  }

  function find(id) {
    return MODES.find((mode) => mode.id === id) || null;
  }

  function isAvailable(id) {
    const mode = find(id);
    return Boolean(mode && mode.available);
  }

  /** Mode sûr : l'identifiant demandé s'il est jouable, sinon le mode par défaut (jamais une erreur). */
  function resolve(id) {
    return isAvailable(id) ? id : DEFAULT;
  }

  function get(id) {
    return list().find((mode) => mode.id === resolve(id));
  }

  /** Le mode peut-il se jouer ici ? `where` : 'online' | 'offline'. */
  function supports(id, where) {
    const mode = find(id);
    return Boolean(mode && mode.available && mode[where === 'offline' ? 'offline' : 'online']);
  }

  /** Nombre de joueurs accepté par le mode. */
  function playersOk(id, count) {
    const mode = find(id);
    return Boolean(mode && Number.isInteger(count) && count >= mode.players[0] && count <= mode.players[1]);
  }

  return { DEFAULT, list, ids, availableIds, isAvailable, resolve, get, supports, playersOk };
});

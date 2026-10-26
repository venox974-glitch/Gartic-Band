/**
 * GARTIC BANDE — règles du mode PHONE (téléphone arabe musical), sans DOM ni réseau.
 * Partagé par le navigateur et le serveur (le serveur reste l'autorité).
 *
 * Une CHAÎNE par joueur. Au round r, le joueur i travaille sur la chaîne (i − r) mod n : personne ne retrouve jamais
 * une chaîne qu'il a déjà touchée tant que r < n. Chaque joueur ne voit QUE le maillon précédent de sa chaîne.
 *
 *   round 0               origin      écrire une chanson connue, une idée ou un thème (texte, vu par le joueur suivant)
 *   rounds 1, 3, 5…       sing        chanter a cappella (1er) ou DE MÉMOIRE la mélodie qu'on vient d'écouter (pas de revoir pendant l'enregistrement)
 *   rounds 2, 4, 6…       transcribe  recopier au piano-roll la voix entendue (Speech to Note permis)
 *                         (aucune musique pendant l'enregistrement : pas d'écho, pas de problème de micro)
 *   dernier round         guess       deviner la chanson (texte)
 *
 * Arrêter à k rounds donne des chaînes de k maillons (dernier = devinette). 3 rounds minimum, n au maximum.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else {
    root.GB = root.GB || {};
    root.GB.phone = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const ROUNDS_LIMITS = [3, 8];
  const TEXT_MAX = 80;
  const TRACKS_MAX = { notes: 6, voice: 4 };
  const BPM_LIMITS = [60, 180];
  /** Durées (s) : écrire / deviner = court ; composer, recopier = `roundSeconds` du salon (5 min conseillées) ; chanter = `singSeconds`. */
  const DEFAULT_SECONDS = { guess: 60, sing: 120 };
  const SING_LIMITS = [20, 300];
  const COMPOSE_DEFAULT = 300;

  /** Nombre de rounds réellement joués : demandé par l'hôte (0 = tous les joueurs), borné entre 3 et le nombre de joueurs. */
  function roundCount(players, wanted) {
    const max = Math.min(ROUNDS_LIMITS[1], Math.max(0, players));
    const asked = Number(wanted) > 0 ? Math.round(Number(wanted)) : max;
    return Math.max(Math.min(ROUNDS_LIMITS[0], max), Math.min(max, asked));
  }

  function kindAt(round, total) {
    if (round <= 0) return 'origin';
    if (round >= total - 1) return 'guess';
    return round % 2 === 1 ? 'sing' : 'transcribe';
  }

  function kinds(total) {
    return Array.from({ length: total }, (_, round) => kindAt(round, total));
  }

  /** La chaîne sur laquelle le joueur d'indice `playerIndex` travaille au round `round`. */
  function chainOf(playerIndex, round, players) {
    return (((playerIndex - round) % players) + players) % players;
  }

  /** Le joueur qui fait le maillon `round` de la chaîne `chain`. */
  function playerOf(chain, round, players) {
    return (chain + round) % players;
  }

  /** Quel type de contenu produit-on ? 'text' | 'notes' | 'voice'. */
  function contentOf(kind) {
    if (kind === 'guess' || kind === 'origin') return 'text';
    if (kind === 'sing') return 'voice';
    return 'notes';
  }

  function seconds(kind, settings) {
    const s = settings || {};
    if (kind === 'guess' || kind === 'origin') return DEFAULT_SECONDS.guess;
    if (kind === 'sing') {
      const n = Math.round(Number(s.singSeconds));
      return Number.isFinite(n) ? Math.min(SING_LIMITS[1], Math.max(SING_LIMITS[0], n)) : DEFAULT_SECONDS.sing;
    }
    const n = Math.round(Number(s.roundSeconds));
    return Number.isFinite(n) && n > 0 ? n : COMPOSE_DEFAULT;
  }

  const LABELS = {
    origin: { title: 'Choisis une chanson ou un thème', help: 'Écris une chanson connue, une idée ou un thème (ex. : « Joyeux anniversaire », « un chat qui danse »). Le joueur suivant devra la chanter a cappella.' },
    transcribe: { title: 'Recopie la voix', help: 'Écoute la voix et recopie-la au piano-roll (le Speech to Note est permis). Tu peux ajouter plusieurs pistes.' },
    sing: { title: 'Chante a cappella', help: 'Chante l\'idée reçue, ou la mélodie que tu viens d\'écouter si on t\'en a montré une : une fois que tu chantes, tu ne peux plus la revoir ni la réécouter.' },
    guess: { title: 'Devine la chanson', help: 'Écoute et écris le titre de la chanson à ton avis.' },
  };

  return { ROUNDS_LIMITS, TEXT_MAX, TRACKS_MAX, BPM_LIMITS, DEFAULT_SECONDS, SING_LIMITS, COMPOSE_DEFAULT, LABELS, roundCount, kindAt, kinds, chainOf, playerOf, contentOf, seconds };
});

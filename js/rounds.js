/**
 * GARTIC BANDE — plan des rounds (fonctions pures, sans DOM ni réseau).
 *
 * Utilisé par le navigateur (mode test local) ET par le serveur (parties en ligne) : une seule règle pour tous.
 *
 * Principe, pour n joueurs numérotés 0 … n−1 et n chansons (la chanson k est créée par le joueur k) :
 *   - n rounds, tous les joueurs jouent EN MÊME TEMPS pendant un round ;
 *   - round 0 : le joueur i crée la chanson i (sa base) ;
 *   - round r : le joueur i reçoit la chanson (i + r) mod n.
 *
 * Pourquoi ça marche pour tous les n ≥ 2 :
 *   - au round r, i ↦ (i + r) mod n est une permutation : chaque chanson est confiée à UN seul joueur par round ;
 *   - pour un joueur i, les n rounds donnent n chansons toutes différentes : il contribue une fois à chacune ;
 *   - la base du créateur compte comme sa contribution : il ne reçoit donc jamais sa chanson aux rounds 1 … n−1
 *     (i + r ≡ i seulement pour r = 0 modulo n).
 * Exemple à 4 joueurs : round 1 = A→A B→B C→C D→D ; round 2 = A→B B→C C→D D→A ; round 3 = A→C … ; round 4 = A→D …
 * À 2 joueurs : round 1 = chacun sa chanson, round 2 = chacun la chanson de l'autre.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else {
    root.GB = root.GB || {};
    root.GB.rounds = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const LIMITS = { players: [2, 8] };

  /** Durées proposées à l'hôte (secondes) et valeurs par défaut. */
  const DURATIONS = [30, 60, 90, 120, 180, 300];
  const DEFAULT_SECONDS = 90;
  const MIN_SECONDS = 5; // plancher technique (les tests utilisent des rounds très courts)
  const MAX_SECONDS = 600;
  const INTRO_SECONDS = 4; // annonce du round avant le départ du chrono
  const GRACE_SECONDS = 3; // en ligne : le temps laissé aux clients pour envoyer leur brouillon quand le chrono tombe à zéro

  function songIndexFor(playerIndex, round, count) {
    return (playerIndex + round) % count;
  }

  /** Tâches d'un round : une par joueur, { playerIndex, songIndex, kind }. */
  function tasksOfRound(count, round) {
    const tasks = [];
    for (let playerIndex = 0; playerIndex < count; playerIndex += 1) {
      tasks.push({ playerIndex, songIndex: songIndexFor(playerIndex, round, count), kind: round === 0 ? 'create' : 'add' });
    }
    return tasks;
  }

  /** Tout le plan : un tableau de rounds, chacun un tableau de tâches. */
  function plan(count) {
    const n = Math.round(Number(count));
    if (!Number.isInteger(n) || n < LIMITS.players[0] || n > LIMITS.players[1]) {
      throw new RangeError('Nombre de joueurs non géré : ' + count);
    }
    return Array.from({ length: n }, (_, round) => tasksOfRound(n, round));
  }

  /** Vérifie les propriétés du plan pour un n donné (utilisé par les tests). Renvoie la liste des problèmes. */
  function check(count) {
    const problems = [];
    const rounds = plan(count);
    if (rounds.length !== count) problems.push('le nombre de rounds doit être égal au nombre de joueurs');
    const seen = new Set();
    rounds.forEach((tasks, round) => {
      const songsThisRound = new Set(tasks.map((task) => task.songIndex));
      if (songsThisRound.size !== count) problems.push('round ' + (round + 1) + ' : une chanson est confiée à deux joueurs ou oubliée');
      tasks.forEach((task) => {
        const key = task.playerIndex + ':' + task.songIndex;
        if (seen.has(key)) problems.push('le joueur ' + task.playerIndex + ' contribue deux fois à la chanson ' + task.songIndex);
        seen.add(key);
        if (round === 0 && task.songIndex !== task.playerIndex) problems.push('round 1 : chacun doit créer sa propre chanson');
        if (round > 0 && task.songIndex === task.playerIndex) problems.push('round ' + (round + 1) + ' : un créateur reçoit sa propre chanson');
      });
    });
    if (seen.size !== count * count) problems.push('il manque des contributions (' + seen.size + '/' + count * count + ')');
    return problems;
  }

  function clampSeconds(value) {
    const number = Math.round(Number(value));
    if (!Number.isFinite(number)) return DEFAULT_SECONDS;
    return Math.min(MAX_SECONDS, Math.max(MIN_SECONDS, number));
  }

  /**
   * Titre d'une chanson d'après le pseudo de son CRÉATEUR : « La chanson d'Alex », « La chanson de Mia ».
   * Élision devant une voyelle (ou y). Le pseudo ne sert qu'à l'affichage : une chanson est identifiée par
   * son id (song-N) et par l'id de son créateur, jamais par ce texte.
   */
  function songTitle(creatorName) {
    const name = String(creatorName || '').replace(/\s+/g, ' ').trim() || 'Anonyme';
    const first = name.charAt(0).normalize('NFD').charAt(0).toLowerCase();
    return 'La chanson ' + ('aeiouy'.indexOf(first) !== -1 ? "d'" : 'de ') + name;
  }

  /**
   * Titres de toutes les chansons, calculés UNE FOIS au lancement de la partie (les pseudos sont alors figés).
   * `songs` : [{ id, creatorId }] ; `nameOf(creatorId)` → pseudo. Deux titres identiques (deux joueurs de même pseudo,
   * sans tenir compte de la casse) reçoivent un numéro : « La chanson d'Alex (1) », « La chanson d'Alex (2) ».
   * Renvoie { [songId]: titre }.
   */
  function songTitles(songs, nameOf) {
    const base = songs.map((song) => songTitle(nameOf(song.creatorId)));
    const counts = new Map();
    base.forEach((title) => counts.set(title.toLowerCase(), (counts.get(title.toLowerCase()) || 0) + 1));
    const seen = new Map();
    const titles = {};
    songs.forEach((song, index) => {
      const key = base[index].toLowerCase();
      const rank = (seen.get(key) || 0) + 1;
      seen.set(key, rank);
      titles[song.id] = counts.get(key) > 1 ? base[index] + ' (' + rank + ')' : base[index];
    });
    return titles;
  }

  return { songTitle, songTitles, LIMITS, DURATIONS, DEFAULT_SECONDS, MIN_SECONDS, MAX_SECONDS, INTRO_SECONDS, GRACE_SECONDS, songIndexFor, tasksOfRound, plan, check, clampSeconds };
});

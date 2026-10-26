/**
 * GARTIC BANDE — idées de thème : proposition, vote, résultat (règles pures, sans DOM, sans réseau, sans horloge).
 *
 * Utilisé par le navigateur (partie solo avec personnages) ET par le serveur (salons en ligne) : une seule règle pour tous.
 * Le « livre » (book) est un simple objet JSON. Les phases (chrono, passage à la page suivante) sont dans js/phases.js ;
 * ce fichier ne connaît que les règles de contenu.
 *
 * Règles :
 *   - UNE SEULE idée par joueur et par partie, non modifiable, non vide ;
 *   - au vote, un joueur ne voit pas sa propre idée et ne peut pas voter pour elle ;
 *   - UN SEUL vote par joueur, non modifiable ;
 *   - résultat calculé UNE fois (par l'autorité : le serveur en ligne) :
 *       · un thème a plus de voix que les autres     → il gagne (source « vote ») ;
 *       · égalité                                    → tirage au sort uniforme parmi les thèmes à égalité (source « tie ») ;
 *       · à deux joueurs (chacun ne voit que l'idée de l'autre) → tirage au sort entre les idées (source « draw ») ;
 *       · aucune voix valide                         → tirage au sort parmi toutes les idées (source « random ») ;
 *       · aucune idée du tout                        → thème par défaut (source « default »).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else {
    root.GB = root.GB || {};
    root.GB.themes = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const LIMITS = {
    textMax: 100, // caractères par idée
    perPlayer: 1, // une seule idée par joueur et par partie
    total: 30,
  };

  const DEFAULT_TEXT = 'Thème libre : compose ce que tu veux';

  function fail(code, error) {
    return { ok: false, code, error };
  }

  function create() {
    return {
      themes: [], // [{ id, text, authorId, authorName }]
      nextId: 1,
      votes: {}, // { playerId: themeId }
      result: null, // { reason, tied: [themeId], counts: {themeId: n} }
      theme: null, // thème retenu : { themeId, text, authorId, authorName, source }
    };
  }

  /** Texte propre : espaces réduits, caractères de contrôle retirés. (L'affichage utilise textContent : jamais de HTML interprété.) */
  function cleanText(text) {
    return String(text === undefined || text === null ? '' : text)
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** Clé de comparaison des doublons : sans accents, sans casse, sans ponctuation ni espaces (« Fin du monde ! » = « fin du monde »). */
  function dupKey(text) {
    return cleanText(text)
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '');
  }

  function themeById(book, themeId) {
    return book.themes.find((theme) => theme.id === themeId) || null;
  }

  function hasProposed(book, playerId) {
    return book.themes.some((theme) => theme.authorId === playerId);
  }

  /** Propose UNE idée de thème. `player` : { id, name }. Après l'envoi : ni modification, ni deuxième idée. */
  function propose(book, player, text) {
    if (!player || !player.id) return fail('no-player', 'Joueur inconnu.');
    if (book.theme || book.result) return fail('bad-state', 'Les propositions sont closes.');
    if (hasProposed(book, player.id)) return fail('already', 'Tu as déjà proposé ton idée : on ne peut en envoyer qu\'une seule.');
    const clean = cleanText(text);
    if (!clean) return fail('empty', 'Écris une idée de thème avant de l\'envoyer.');
    if (clean.length > LIMITS.textMax) return fail('too-long', 'Une idée fait ' + LIMITS.textMax + ' caractères au maximum (la tienne : ' + clean.length + ').');
    if (book.themes.length >= LIMITS.total) return fail('limit-total', 'Il y a déjà ' + LIMITS.total + ' idées : c\'est le maximum.');
    const key = dupKey(clean);
    if (key && book.themes.some((theme) => dupKey(theme.text) === key)) return fail('duplicate', 'Cette idée a déjà été proposée : reformule-la.');
    const theme = { id: 'theme-' + book.nextId, text: clean, authorId: player.id, authorName: String(player.name || '?') };
    book.nextId += 1;
    book.themes.push(theme);
    return { ok: true, theme };
  }

  /** Les idées qu'un joueur peut voir et choisir : toutes SAUF la sienne. */
  function optionsFor(book, playerId) {
    return book.themes.filter((theme) => theme.authorId !== playerId);
  }

  function hasVoted(book, playerId) {
    return Object.prototype.hasOwnProperty.call(book.votes, playerId);
  }

  /** Un vote, définitif. `eligibleIds` (facultatif) : les joueurs qui ont le droit de voter. */
  function cast(book, playerId, themeId, eligibleIds) {
    if (book.theme || book.result) return fail('closed', 'Le vote est terminé : les votes ne peuvent plus changer.');
    if (eligibleIds && !eligibleIds.includes(playerId)) return fail('not-allowed', 'Tu ne participes pas à cette partie.');
    if (hasVoted(book, playerId)) return fail('already', 'Tu as déjà voté : ton vote ne peut plus changer.');
    const theme = themeById(book, themeId);
    if (!theme) return fail('no-theme', 'Cette idée n\'existe pas.');
    if (theme.authorId === playerId) return fail('own', 'Tu ne peux pas voter pour ta propre idée.');
    book.votes[playerId] = themeId;
    return { ok: true };
  }

  /** Voix par thème (votes valides seulement : un vote pour sa propre idée ou pour une idée inconnue ne compte jamais). */
  function tally(book) {
    const counts = {};
    book.themes.forEach((theme) => {
      counts[theme.id] = 0;
    });
    Object.keys(book.votes).forEach((playerId) => {
      const theme = themeById(book, book.votes[playerId]);
      if (!theme || theme.authorId === playerId) return;
      counts[theme.id] += 1;
    });
    return counts;
  }

  function chosen(theme, source) {
    return { themeId: theme.id, text: theme.text, authorId: theme.authorId, authorName: theme.authorName, source };
  }

  function pickRandom(list, rand) {
    const value = Number(rand());
    const index = Math.min(list.length - 1, Math.max(0, Math.floor((Number.isFinite(value) ? value : 0) * list.length)));
    return list[index];
  }

  function defaultTheme() {
    return { themeId: null, text: DEFAULT_TEXT, authorId: null, authorName: null, source: 'default' };
  }

  /**
   * Calcule le résultat UNE SEULE FOIS (un second appel ne change rien). `rand` : () => nombre dans [0, 1[ (fourni par l'autorité).
   * `draw` : vrai à deux joueurs → tirage au sort entre les idées, sans tenir compte des votes.
   */
  function resolve(book, rand, draw) {
    if (book.theme) return book.theme;
    const counts = tally(book);
    if (book.themes.length === 0) {
      book.result = { reason: 'no-themes', tied: [], counts };
      book.theme = defaultTheme();
      return book.theme;
    }
    const top = Math.max(0, ...Object.values(counts));
    let tied = Object.keys(counts).filter((id) => counts[id] === top);
    let reason;
    if (draw) {
      tied = book.themes.map((theme) => theme.id);
      reason = 'draw';
    } else if (top === 0) {
      tied = book.themes.map((theme) => theme.id);
      reason = 'no-votes';
    } else {
      reason = tied.length > 1 ? 'tie' : 'winner';
    }
    const winnerId = tied.length === 1 ? tied[0] : pickRandom(tied, rand);
    const source = reason === 'winner' ? 'vote' : reason === 'tie' ? 'tie' : reason === 'draw' ? 'draw' : 'random';
    book.result = { reason, tied, counts };
    book.theme = chosen(themeById(book, winnerId), source);
    return book.theme;
  }

  /**
   * Vue envoyée aux clients (la même pour tous). Pendant le vote : pas de décompte (on ne montre pas qui mène) et JAMAIS qui a voté pour quoi.
   * `voted` : ceux qui ont déjà voté (pour afficher « 3/4 ont voté »), sans leur choix. Après le résultat : les voix de chaque thème.
   */
  function view(book) {
    const closed = Boolean(book.result);
    const counts = closed ? book.result.counts : null;
    return {
      themes: book.themes.map((theme) => ({ id: theme.id, text: theme.text, authorId: theme.authorId, authorName: theme.authorName, votes: closed ? counts[theme.id] || 0 : null })),
      proposedBy: book.themes.map((theme) => theme.authorId),
      voted: Object.keys(book.votes),
      result: book.result ? { reason: book.result.reason, tied: book.result.tied.slice() } : null,
      theme: book.theme ? Object.assign({}, book.theme) : null,
      limits: { textMax: LIMITS.textMax },
    };
  }

  /** Libellé court de l'origine du thème, pour l'affichage. */
  function sourceLabel(theme) {
    if (!theme) return '';
    if (theme.source === 'default') return 'thème par défaut (aucune idée proposée)';
    if (theme.source === 'vote') return 'élu par les joueurs';
    if (theme.source === 'tie') return 'tiré au sort après égalité';
    if (theme.source === 'draw') return 'tiré au sort entre les idées';
    if (theme.source === 'random') return 'tiré au sort (aucun vote)';
    return '';
  }

  return { LIMITS, DEFAULT_TEXT, create, cleanText, dupKey, hasProposed, optionsFor, hasVoted, propose, cast, tally, resolve, defaultTheme, view, sourceLabel };
});

/**
 * GARTIC BANDE — thèmes proposés et vote (règles pures, sans DOM ni réseau).
 *
 * Utilisé par le navigateur (mode test local) ET par le serveur (salons en ligne) : une seule règle pour tous.
 * Le « livre » (book) est un simple objet JSON : propositions, vote, thème retenu. Chaque fonction reçoit
 * l'auteur de l'action et renvoie { ok: true, ... } ou { ok: false, code, error }. Le serveur est l'autorité en ligne :
 * il appelle ces fonctions avec l'identité du joueur connecté, jamais celle d'un message.
 *
 * Étapes : propositions (vote 'idle') → vote ouvert ('open') → clos ('closed').
 *   - Thème gagnant = le plus voté. Égalité → l'hôte choisit parmi les thèmes à égalité.
 *   - Aucun vote → l'hôte choisit une proposition ou utilise le thème par défaut (indiqué clairement).
 *   - L'hôte peut aussi retenir un thème sans vote, ou le thème par défaut, depuis l'étape des propositions.
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
    textMax: 100, // caractères par proposition
    perPlayer: 3, // propositions par joueur
    total: 30, // propositions dans un salon
    voteSeconds: [15, 30, 60, 90, 120], // durées proposées à l'hôte
    voteDefault: 30,
    voteMin: 5, // plancher technique (les tests utilisent des votes très courts)
    voteMax: 300,
  };

  const DEFAULT_TEXT = 'Thème libre : compose ce que tu veux';

  function fail(code, error) {
    return { ok: false, code, error };
  }

  function create() {
    return {
      themes: [], // [{ id, text, authorId, authorName }]
      nextId: 1,
      vote: { status: 'idle', durationMs: 0, endsAt: 0, votes: {} }, // votes : { playerId: themeId }
      result: null, // après clôture : { reason: 'winner' | 'tie' | 'no-votes', tied: [themeId], counts: {themeId: n} }
      theme: null, // thème retenu : { themeId, text, authorId, authorName, source: 'vote' | 'host' | 'default' }
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

  function locked(book) {
    return book.theme !== null || book.vote.status !== 'idle';
  }

  /** Propose un thème. `player` : { id, name }. */
  function propose(book, player, text) {
    if (!player || !player.id) return fail('no-player', 'Joueur inconnu.');
    if (locked(book)) return fail('bad-state', 'Les propositions sont closes.');
    const clean = cleanText(text);
    if (!clean) return fail('empty', 'Écris un thème avant de proposer.');
    if (clean.length > LIMITS.textMax) return fail('too-long', 'Un thème fait ' + LIMITS.textMax + ' caractères au maximum (le tien : ' + clean.length + ').');
    if (book.themes.length >= LIMITS.total) return fail('limit-total', 'Il y a déjà ' + LIMITS.total + ' propositions : c\'est le maximum.');
    if (book.themes.filter((theme) => theme.authorId === player.id).length >= LIMITS.perPlayer) {
      return fail('limit-player', 'Tu as déjà fait ' + LIMITS.perPlayer + ' propositions : c\'est le maximum par joueur.');
    }
    const key = dupKey(clean);
    if (key && book.themes.some((theme) => dupKey(theme.text) === key)) return fail('duplicate', 'Ce thème a déjà été proposé.');
    const theme = { id: 'theme-' + book.nextId, text: clean, authorId: player.id, authorName: String(player.name || '?') };
    book.nextId += 1;
    book.themes.push(theme);
    return { ok: true, theme };
  }

  /** Retire une proposition : l'hôte (n'importe laquelle) ou son auteur (la sienne), tant que le vote n'a pas commencé. */
  function remove(book, byId, hostId, themeId) {
    if (locked(book)) return fail('bad-state', 'Les propositions sont closes.');
    const theme = themeById(book, themeId);
    if (!theme) return fail('no-theme', 'Cette proposition n\'existe plus.');
    if (byId !== hostId && byId !== theme.authorId) return fail('not-host', 'Seul l\'hôte peut supprimer la proposition d\'un autre joueur.');
    book.themes = book.themes.filter((entry) => entry.id !== themeId);
    return { ok: true };
  }

  function clampSeconds(value) {
    const number = Math.round(Number(value));
    if (!Number.isFinite(number)) return LIMITS.voteDefault;
    return Math.min(LIMITS.voteMax, Math.max(LIMITS.voteMin, number));
  }

  /** L'hôte ouvre le vote (durée en secondes). */
  function openVote(book, byId, hostId, seconds, now) {
    if (byId !== hostId) return fail('not-host', 'Seul l\'hôte peut lancer le vote.');
    if (book.theme) return fail('bad-state', 'Le thème est déjà choisi.');
    if (book.vote.status !== 'idle') return fail('bad-state', 'Le vote a déjà eu lieu.');
    if (book.themes.length === 0) return fail('no-themes', 'Il faut au moins une proposition pour voter.');
    const duration = clampSeconds(seconds) * 1000;
    book.vote = { status: 'open', durationMs: duration, endsAt: now + duration, votes: {} };
    return { ok: true };
  }

  /** Un vote (ou un changement de vote) : un seul par joueur, tant que le vote est ouvert. */
  function cast(book, playerId, themeId, now, eligibleIds) {
    if (book.vote.status !== 'open') return fail('closed', book.vote.status === 'idle' ? 'Le vote n\'est pas ouvert.' : 'Le vote est terminé : les votes ne peuvent plus changer.');
    if (now >= book.vote.endsAt) return fail('closed', 'Le temps du vote est écoulé.');
    if (eligibleIds && !eligibleIds.includes(playerId)) return fail('not-allowed', 'Tu ne participes pas à ce salon.');
    if (!themeById(book, themeId)) return fail('no-theme', 'Ce thème n\'existe pas.');
    book.vote.votes[playerId] = themeId; // écrase l'ancien vote : jamais de doublon
    return { ok: true };
  }

  /** Voix par thème (seuls comptent les joueurs présents). */
  function tally(book, eligibleIds) {
    const counts = {};
    book.themes.forEach((theme) => {
      counts[theme.id] = 0;
    });
    Object.keys(book.vote.votes).forEach((playerId) => {
      const themeId = book.vote.votes[playerId];
      if (counts[themeId] === undefined) return;
      if (eligibleIds && !eligibleIds.includes(playerId)) return;
      counts[themeId] += 1;
    });
    return counts;
  }

  function finalize(book, eligibleIds) {
    const counts = tally(book, eligibleIds);
    const top = Math.max(0, ...Object.values(counts));
    const tied = Object.keys(counts).filter((id) => counts[id] === top);
    book.vote.status = 'closed';
    if (top === 0) {
      book.result = { reason: 'no-votes', tied: book.themes.map((theme) => theme.id), counts };
    } else if (tied.length > 1) {
      book.result = { reason: 'tie', tied, counts };
    } else {
      book.result = { reason: 'winner', tied, counts };
      book.theme = chosen(book, tied[0], 'vote');
    }
  }

  function chosen(book, themeId, source) {
    const theme = themeById(book, themeId);
    return { themeId: theme.id, text: theme.text, authorId: theme.authorId, authorName: theme.authorName, source };
  }

  /** Clôture manuelle du vote par l'hôte. */
  function close(book, byId, hostId, eligibleIds) {
    if (byId !== hostId) return fail('not-host', 'Seul l\'hôte peut clôturer le vote.');
    if (book.vote.status !== 'open') return fail('bad-state', 'Aucun vote en cours.');
    finalize(book, eligibleIds);
    return { ok: true };
  }

  /** Horloge : clôt le vote quand le temps est écoulé. Renvoie true si l'état a changé. */
  function tick(book, now, eligibleIds) {
    if (book.vote.status === 'open' && now >= book.vote.endsAt) {
      finalize(book, eligibleIds);
      return true;
    }
    return false;
  }

  /** L'hôte tranche : après une égalité (parmi les thèmes à égalité), sans vote (parmi toutes les propositions), ou directement sans vote. */
  function pick(book, byId, hostId, themeId) {
    if (byId !== hostId) return fail('not-host', 'Seul l\'hôte peut choisir le thème.');
    if (book.theme) return fail('bad-state', 'Le thème est déjà choisi.');
    if (book.vote.status === 'open') return fail('bad-state', 'Le vote est en cours : clôture-le d\'abord.');
    if (!themeById(book, themeId)) return fail('no-theme', 'Cette proposition n\'existe pas.');
    if (book.result && !book.result.tied.includes(themeId)) return fail('not-tied', 'Choisis parmi les thèmes à égalité.');
    book.theme = chosen(book, themeId, book.result && book.result.reason === 'tie' ? 'tie' : 'host');
    return { ok: true };
  }

  /** Thème par défaut, clairement indiqué comme tel. */
  function useDefault(book, byId, hostId) {
    if (byId !== hostId) return fail('not-host', 'Seul l\'hôte peut choisir le thème par défaut.');
    if (book.theme) return fail('bad-state', 'Le thème est déjà choisi.');
    if (book.vote.status === 'open') return fail('bad-state', 'Le vote est en cours : clôture-le d\'abord.');
    book.theme = { themeId: null, text: DEFAULT_TEXT, authorId: null, authorName: null, source: 'default' };
    return { ok: true };
  }

  /** Avant le lancement : si rien n'a été choisi, le thème par défaut s'applique (et s'affiche comme tel). Fige le livre. */
  function settle(book) {
    if (book.vote.status === 'open') finalize(book, null);
    if (!book.theme) book.theme = { themeId: null, text: DEFAULT_TEXT, authorId: null, authorName: null, source: 'default' };
    return book.theme;
  }

  /** Vue envoyée aux clients (même pour tous : mêmes propositions, mêmes voix, même résultat). */
  function view(book, now, eligibleIds) {
    const counts = tally(book, eligibleIds);
    return {
      themes: book.themes.map((theme) => ({ id: theme.id, text: theme.text, authorId: theme.authorId, authorName: theme.authorName, votes: counts[theme.id] || 0 })),
      vote: {
        status: book.vote.status,
        durationMs: book.vote.durationMs,
        remainingMs: book.vote.status === 'open' ? Math.max(0, book.vote.endsAt - now) : 0,
        votes: Object.assign({}, book.vote.votes),
      },
      result: book.result ? { reason: book.result.reason, tied: book.result.tied.slice() } : null,
      theme: book.theme ? Object.assign({}, book.theme) : null,
      limits: { textMax: LIMITS.textMax, perPlayer: LIMITS.perPlayer },
    };
  }

  /** Libellé court de l'origine du thème, pour l'affichage. */
  function sourceLabel(theme) {
    if (!theme) return '';
    if (theme.source === 'default') return 'thème par défaut (aucun thème choisi)';
    if (theme.source === 'vote') return 'élu par les joueurs';
    if (theme.source === 'tie') return 'choisi par l\'hôte après égalité';
    return 'choisi par l\'hôte';
  }

  return { LIMITS, DEFAULT_TEXT, create, cleanText, dupKey, propose, remove, openVote, cast, tally, close, tick, pick, useDefault, settle, view, sourceLabel };
});

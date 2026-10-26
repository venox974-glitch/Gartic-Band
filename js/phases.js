/**
 * GARTIC BANDE — phases d'avant-composition : PROPOSITION → VOTE → PRÉPARATION (règles pures, sans DOM ni réseau).
 *
 * Utilisé par le navigateur (partie solo avec personnages) ET par le serveur (salons en ligne) : une seule règle pour tous.
 * Le serveur est l'autorité en ligne : c'est lui qui appelle `tick`, avec SON horloge et SON tirage au sort.
 *
 * Chaque phase est un round à part entière avec sa page, son chrono et ses conditions de fin :
 *   propose  chaque joueur envoie UNE idée de thème      → vote dès que tous les joueurs présents ont proposé, ou chrono à zéro
 *   vote     chacun vote pour l'idée d'un autre         → préparation dès que tous ont voté, ou chrono à zéro
 *   prep     chacun choisit tempo, instrument, difficulté → composition dès que tous ont validé, ou chrono à zéro
 *
 * Le chrono est une DURÉE MAXIMALE : dès que tout le monde a terminé, on passe à la suite sans attendre.
 * Une seule transition possible par phase : `pre.stage` n'avance que vers l'avant, `tick` est idempotent.
 * Les joueurs absents (déconnectés) ne bloquent jamais : ils sont ignorés pour « tout le monde a terminé »,
 * et reçoivent les paramètres par défaut à la fin de la préparation.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./themes.js'), require('./synth.js'));
  else {
    root.GB = root.GB || {};
    root.GB.phases = factory(root.GB.themes, root.GB.synth);
  }
})(typeof self !== 'undefined' ? self : this, function (Themes, Synth) {
  'use strict';

  const STAGES = ['propose', 'vote', 'prep'];
  const STAGE_LABELS = { propose: 'Proposition des thèmes', vote: 'Vote pour le thème', prep: 'Préparation musicale', compose: 'Composition' };

  /** Durées maximales (secondes) de chaque phase, réglables par l'hôte. `compose` : un round de composition. */
  const DEFAULT_SECONDS = { propose: 45, vote: 30, prep: 60, compose: 90 };
  const SECONDS_LIMITS = { propose: [10, 300], vote: [10, 300], prep: [10, 300], compose: [5, 600] };
  const PRESETS = [
    { id: 'fast', label: 'Rapide', seconds: { propose: 25, vote: 20, prep: 40, compose: 60 } },
    { id: 'normal', label: 'Normal', seconds: { propose: 45, vote: 30, prep: 60, compose: 90 } },
    { id: 'slow', label: 'Tranquille', seconds: { propose: 75, vote: 45, prep: 90, compose: 150 } },
  ];

  const MODES = ['baby', 'beginner', 'expert'];
  const DEFAULT_MODE = 'beginner';
  const BPM = { min: 60, max: 180, default: 110, presets: [70, 90, 110, 130, 150] };
  const INSTRUMENT_ID = /^[a-z0-9_-]{1,40}$/i;
  const SOUND_HASH = /^[0-9a-f]{64}$/;
  const DRAW_REVEAL_MS = 5000; // à deux joueurs : le tirage au sort est montré quelques secondes avant la préparation

  function fail(code, error) {
    return { ok: false, code, error };
  }

  function clampSeconds(stage, value) {
    const limits = SECONDS_LIMITS[stage];
    const number = Math.round(Number(value));
    if (!limits) return DEFAULT_SECONDS.compose;
    if (!Number.isFinite(number)) return DEFAULT_SECONDS[stage];
    return Math.min(limits[1], Math.max(limits[0], number));
  }

  function clampBpm(value, fallback) {
    const number = Math.round(Number(value));
    if (!Number.isFinite(number)) return fallback === undefined ? BPM.default : fallback;
    return Math.min(BPM.max, Math.max(BPM.min, number));
  }

  /** `durations` : { propose, vote, prep } en secondes (valeurs absentes = défauts). */
  function create(playerIds, now, durations, options) {
    const seconds = {};
    STAGES.forEach((stage) => {
      seconds[stage] = clampSeconds(stage, durations && durations[stage] !== undefined ? durations[stage] : DEFAULT_SECONDS[stage]);
    });
    return {
      stage: 'propose', // 'propose' | 'vote' | 'prep' | 'done'
      seq: 1, // augmente à chaque changement de phase
      startedAt: now,
      endsAt: now + seconds.propose * 1000,
      seconds,
      playerIds: playerIds.slice(),
      book: Themes.create(),
      drawMs: options && options.drawMs !== undefined ? options.drawMs : DRAW_REVEAL_MS,
      voteDraw: playerIds.length <= 2, // à deux joueurs, chacun ne verrait que l'idée de l'autre : tirage au sort entre les deux idées
      prep: {}, // { playerId: { bpm, instrumentId, mode, settings, source: 'player' | 'default' } }
      doneAt: 0,
    };
  }

  function isParticipant(pre, playerId) {
    return pre.playerIds.includes(playerId);
  }

  function presentIds(pre, ctx) {
    const present = Array.isArray(ctx.present) ? ctx.present : pre.playerIds;
    return pre.playerIds.filter((id) => present.includes(id));
  }

  /* ---------------------------- actions des joueurs ---------------------------- */

  function propose(pre, ctx, player, text) {
    if (pre.stage !== 'propose') return fail('bad-state', 'Les propositions sont closes.');
    if (!player || !isParticipant(pre, player.id)) return fail('not-allowed', 'Tu ne participes pas à cette partie.');
    if (ctx.now >= pre.endsAt) return fail('bad-state', 'Le temps des propositions est écoulé.');
    return Themes.propose(pre.book, player, text);
  }

  function vote(pre, ctx, playerId, themeId) {
    if (pre.stage !== 'vote') return fail('bad-state', 'Le vote n\'est pas ouvert.');
    if (pre.voteDraw) return fail('draw', 'À deux joueurs, le thème est tiré au sort : pas de vote.');
    if (ctx.now >= pre.endsAt) return fail('bad-state', 'Le temps du vote est écoulé.');
    return Themes.cast(pre.book, playerId, String(themeId), pre.playerIds);
  }

  /** Vérifie et nettoie le choix de préparation d'un joueur. Renvoie { ok, value } ou { ok: false, code, error }. */
  function normalizePrep(choice, ctx) {
    if (!choice || typeof choice !== 'object') return fail('invalid', 'Choix de préparation invalide.');
    const instrumentId = typeof choice.instrumentId === 'string' ? choice.instrumentId : '';
    if (!INSTRUMENT_ID.test(instrumentId)) return fail('invalid', 'Instrument invalide.');
    if (!MODES.includes(choice.mode)) return fail('invalid', 'Difficulté invalide.');
    const bpm = Number(choice.bpm);
    if (!Number.isFinite(bpm)) return fail('invalid', 'Tempo invalide.');
    let settings = choice.settings && typeof choice.settings === 'object' ? choice.settings : null;
    if (JSON.stringify(settings || null).length > 4000) return fail('invalid', 'Réglages trop volumineux.');
    const hash = settings && settings.sample && typeof settings.sample.hash === 'string' ? settings.sample.hash : null;
    if (instrumentId.startsWith('sample-') || hash) {
      if (!hash || !SOUND_HASH.test(hash) || instrumentId !== 'sample-' + hash.slice(0, 12)) return fail('invalid', 'Son importé invalide.');
      if (typeof ctx.hasSound === 'function' && !ctx.hasSound(hash)) return fail('missing-sound', 'Le son importé n\'est pas arrivé sur le serveur : réessaie dans un instant.');
    }
    if (instrumentId.startsWith('custom-')) {
      // Instrument personnalisé : ses réglages doivent correspondre exactement à son identifiant ; on garde la version nettoyée.
      const checked = Synth.verify(instrumentId, settings);
      if (!checked.ok) return fail('invalid', 'Instrument personnalisé invalide.');
      settings = checked.settings;
    }
    if (!settings) settings = null;
    return { ok: true, value: { bpm: clampBpm(bpm), instrumentId, mode: choice.mode, settings, source: 'player' } };
  }

  function prepReady(pre, ctx, playerId, choice) {
    if (pre.stage !== 'prep') return fail('bad-state', 'La préparation n\'est pas ouverte.');
    if (!isParticipant(pre, playerId)) return fail('not-allowed', 'Tu ne participes pas à cette partie.');
    if (pre.prep[playerId]) return fail('already', 'Tu as déjà validé ta préparation.');
    if (ctx.now >= pre.endsAt) return fail('bad-state', 'Le temps de préparation est écoulé.');
    const checked = normalizePrep(choice, ctx);
    if (!checked.ok) return checked;
    pre.prep[playerId] = checked.value;
    return { ok: true, value: checked.value };
  }

  /** Paramètres par défaut raisonnables d'un joueur qui n'a pas répondu à temps. */
  function defaultPrep(ctx) {
    return { bpm: clampBpm(ctx && ctx.defaultBpm, BPM.default), instrumentId: 'piano', mode: DEFAULT_MODE, settings: null, source: 'default' };
  }

  /* ---------------------------- progression ---------------------------- */

  /** Joueurs présents qui doivent encore agir dans la phase courante. */
  function waitingFor(pre, ctx) {
    const present = presentIds(pre, ctx);
    if (pre.stage === 'propose') return present.filter((id) => !Themes.hasProposed(pre.book, id));
    if (pre.stage === 'vote') {
      if (pre.voteDraw) return [];
      return present.filter((id) => !Themes.hasVoted(pre.book, id) && Themes.optionsFor(pre.book, id).length > 0);
    }
    if (pre.stage === 'prep') return present.filter((id) => !pre.prep[id]);
    return [];
  }

  function everyoneDone(pre, ctx) {
    return presentIds(pre, ctx).length > 0 && waitingFor(pre, ctx).length === 0;
  }

  function enter(pre, stage, now) {
    pre.stage = stage;
    pre.seq += 1;
    pre.startedAt = now;
    pre.endsAt = stage === 'done' ? now : now + pre.seconds[stage] * 1000;
    if (stage === 'done') pre.doneAt = now;
  }

  function finishVote(pre, ctx) {
    Themes.resolve(pre.book, ctx.rand || Math.random, pre.voteDraw);
  }

  function finishPrep(pre, ctx) {
    pre.playerIds.forEach((id) => {
      if (!pre.prep[id]) pre.prep[id] = defaultPrep(ctx);
    });
  }

  /**
   * Fait avancer les phases avec l'horloge `ctx.now`. Renvoie la liste des changements [{ type: 'stage', from, to }].
   * `ctx` : { now, present: [ids], rand: () => [0,1[, hasSound?, defaultBpm? }.
   */
  function tick(pre, ctx) {
    const events = [];
    for (let guard = 0; guard < 8 && pre.stage !== 'done'; guard += 1) {
      const timeUp = ctx.now >= pre.endsAt;
      // Tirage au sort (deux joueurs) : on laisse le résultat affiché jusqu'à la fin de son délai.
      const early = !(pre.stage === 'vote' && pre.voteDraw) && everyoneDone(pre, ctx);
      if (!(timeUp || early)) break;
      const from = pre.stage;
      if (from === 'propose') {
        if (pre.book.themes.length === 0) {
          // Personne n'a proposé : rien à voter. Le thème par défaut s'applique et on passe à la préparation.
          finishVote(pre, ctx);
          enter(pre, 'prep', ctx.now);
        } else if (pre.voteDraw) {
          finishVote(pre, ctx); // le résultat est connu tout de suite et partagé : la page de vote l'affiche
          enter(pre, 'vote', ctx.now);
          pre.endsAt = ctx.now + pre.drawMs;
        } else {
          enter(pre, 'vote', ctx.now);
        }
      } else if (from === 'vote') {
        finishVote(pre, ctx);
        enter(pre, 'prep', ctx.now);
      } else if (from === 'prep') {
        finishPrep(pre, ctx);
        enter(pre, 'done', ctx.now);
      }
      events.push({ type: 'stage', from, to: pre.stage });
    }
    return events;
  }

  /** Vue envoyée aux clients : la même pour tous. Pas de choix de préparation avant la fin (seulement « prêt »). */
  function view(pre, now) {
    const book = Themes.view(pre.book);
    return {
      stage: pre.stage,
      seq: pre.seq,
      durationMs: pre.stage === 'done' ? 0 : pre.stage === 'vote' && pre.voteDraw ? pre.drawMs : pre.seconds[pre.stage] * 1000,
      remainingMs: pre.stage === 'done' ? 0 : Math.max(0, pre.endsAt - now),
      seconds: Object.assign({}, pre.seconds),
      playerIds: pre.playerIds.slice(),
      voteDraw: pre.voteDraw,
      book,
      ready: Object.keys(pre.prep),
      prep: pre.stage === 'done' ? JSON.parse(JSON.stringify(pre.prep)) : null,
    };
  }

  return {
    STAGES,
    STAGE_LABELS,
    DEFAULT_SECONDS,
    SECONDS_LIMITS,
    PRESETS,
    MODES,
    DEFAULT_MODE,
    BPM,
    DRAW_REVEAL_MS,
    clampSeconds,
    clampBpm,
    create,
    propose,
    vote,
    prepReady,
    normalizePrep,
    defaultPrep,
    waitingFor,
    everyoneDone,
    tick,
    view,
  };
});

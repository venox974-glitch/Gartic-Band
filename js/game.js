/**
 * GARTIC BANDE — logique de la partie : ROUNDS SIMULTANÉS (chaque joueur possède sa chanson).
 *
 * Trois entités distinctes :
 *   - les PARTICIPANTS  (state.players)
 *   - les CHANSONS      (state.songs)          : chacune a un créateur initial
 *   - les CONTRIBUTIONS (state.contributions)  : liées à la fois à un participant ET à une chanson
 *
 * Déroulement (n participants → n rounds, voir js/rounds.js pour la rotation) :
 *   Round 1       chaque participant crée la base de SA chanson
 *   Rounds 2 … n  chaque participant reçoit la chanson d'un autre (rotation circulaire) et y ajoute une couche
 *   Révélations   une par chanson : le créateur d'abord, puis une couche de plus à chaque boucle
 *
 * Dans un round, TOUT LE MONDE joue en même temps :
 *   intro (annonce, quelques secondes) → working (chrono commun) → fin du round
 *   Le round se termine quand tous les participants ont cliqué « Prêt », ou quand le chrono tombe à zéro :
 *   la contribution en cours de chacun est alors sauvegardée telle quelle ; qui n'a rien composé reçoit une
 *   contribution VIDE (marquée `empty`, aucune note inventée).
 *
 * Règle fondamentale : chaque participant contribue EXACTEMENT UNE FOIS à chaque chanson. Pour sa propre chanson,
 * la base du round 1 est sa contribution. Une contribution enregistrée est figée (Object.freeze) : ni écrasée ni dupliquée.
 *
 * L'éditeur (piano-roll) ne montre que la tâche du participant « au premier plan » (state.focusId) : le joueur
 * lui-même, ou n'importe quel participant en mode test (où une seule personne les contrôle tous). Le store n'est
 * qu'un affichage de travail : la vérité est dans state.songs / state.contributions.
 *
 * Modes :
 *   - test local   : le chrono et les « Prêt » sont gérés ici ; les personnages simulés composent seuls pendant le round ;
 *   - en ligne     : le SERVEUR décide du round, du chrono et de la fin du round (voir GB.game.online et js/online.js) ;
 *                    ce module affiche l'état reçu et envoie ma contribution.
 *
 * Ce module pilote l'état et le moteur audio ; il ne touche pas au DOM (voir game-ui.js).
 */
(function (GB) {
  'use strict';

  const { CONFIG, store } = GB;
  const Rounds = GB.rounds;

  const LIMITS = {
    participants: Rounds.LIMITS.players,
    bars: [2, 4],
  };

  const DEFAULT_SETUP = { participants: 4, bars: 4, bpm: 110, manual: false, roundSeconds: Rounds.DEFAULT_SECONDS };

  /** Durées de la partie, modifiables (les tests les raccourcissent). */
  const timings = {
    introMs: Rounds.INTRO_SECONDS * 1000,
    botEarliest: 0.2, // un personnage termine entre 20 % et 70 % du temps du round
    botLatest: 0.7,
    revealGapMs: 2200,
    tickMs: 200,
  };

  /**
   * Phases (pour le participant au premier plan) :
   *   idle      pas de partie en cours
   *   intro     annonce du round (le chrono n'a pas démarré)
   *   compose   il compose sa couche (instrument et difficulté choisis à la préparation, modifiables en cours de route)
   *   ready     il a cliqué « Prêt » : contribution enregistrée et verrouillée, il attend les autres
   *   closing   (en ligne) le chrono est à zéro, les brouillons sont en cours d'envoi
   *   reveal    révélations des chansons
   */
  const state = {
    active: false,
    phase: 'idle',
    config: null,
    players: [],
    songs: [],
    contributions: [],
    turns: [], // toutes les tâches : une par (round, participant)
    round: -1, // index du round en cours (0 = création des bases)
    roundCount: 0,
    roundStatus: null, // 'intro' | 'working' | 'closing'
    introEnd: 0,
    deadline: 0,
    duration: 0, // durée du chrono du round (ms)
    lastEnd: null, // pourquoi le round précédent s'est terminé : 'all-ready' | 'timeout'
    autoSent: false,
    focusId: null,
    loadedSongId: null,
    rng: null,
    newTrackId: null,
    reveal: null,
    prep: {}, // choix de préparation figés de chaque participant : { playerId: { bpm, instrumentId, mode, settings } }
    prefs: {}, // instrument et difficulté COURANTS de chaque participant (départ = préparation ; modifiables pendant les rounds)
    theme: null, // thème officiel de la partie : { themeId, text, authorName, source } (affiché pendant les rounds et la révélation)
    online: null, // en ligne : { youId, hostId, code, submit }
  };

  let ticker = null;
  let revealTimer = null;
  let contributionCounter = 0;
  const listeners = [];

  function emit() {
    listeners.forEach((listener) => listener(state));
  }

  function now() {
    return performance.now();
  }

  function clearTimers() {
    clearInterval(ticker);
    ticker = null;
    clearTimeout(revealTimer);
    revealTimer = null;
  }

  function startTicker() {
    clearInterval(ticker);
    ticker = setInterval(tick, timings.tickMs);
  }

  function clamp(value, [min, max]) {
    return Math.min(max, Math.max(min, Math.round(Number(value)) || min));
  }

  /* ------------------------------------------------------------------ */
  /*  Accès aux données                                                  */
  /* ------------------------------------------------------------------ */

  function playerById(playerId) {
    return state.players.find((player) => player.id === playerId) || null;
  }

  function songById(songId) {
    return state.songs.find((song) => song.id === songId) || null;
  }

  function roundTasks(round) {
    const index = round === undefined ? state.round : round;
    return state.turns.filter((turn) => turn.round === index);
  }

  function taskOf(playerId, round) {
    return roundTasks(round).find((turn) => turn.playerId === playerId) || null;
  }

  /** Tâche du participant au premier plan dans le round en cours. */
  function currentTurn() {
    return state.focusId ? taskOf(state.focusId) : null;
  }

  /** Contributions d'une chanson, dans l'ordre : la contribution initiale d'abord. */
  function contributionsOf(song) {
    return song.contributionIds.map((id) => state.contributions.find((entry) => entry.id === id));
  }

  function hasContributed(songId, playerId) {
    return state.contributions.some((entry) => entry.songId === songId && entry.playerId === playerId);
  }

  /** Difficulté courante d'un participant (choisie à la préparation, modifiable pendant les rounds). */
  function modeOf(playerId) {
    const pref = state.prefs[playerId];
    return pref && pref.mode ? pref.mode : 'beginner';
  }

  /** Ce participant est-il piloté depuis cet écran ? (moi en ligne ; le joueur, ou tous en mode test, en local.) */
  function isManual(player) {
    if (!player) return false;
    if (state.online) return player.id === state.online.youId;
    return player.isHuman || Boolean(state.config && state.config.manual);
  }

  function loopSeconds() {
    return (CONFIG.STEP_COUNT * 60) / store.state.bpm;
  }

  /** Piste verrouillée reconstruite à partir d'une contribution enregistrée. Une contribution vide n'a pas de piste. */
  function layerFromContribution(entry) {
    if (entry.empty) return null;
    const player = playerById(entry.playerId);
    GB.instruments.ensure(entry.instrument); // instrument personnalisé reçu d'ailleurs : on le réenregistre
    return store.addLayer({
      name: player.name + ' · ' + GB.INSTRUMENTS[entry.instrumentId].label,
      instrumentId: entry.instrumentId,
      color: player.color,
      author: player.id,
      turn: entry.order + 1,
      locked: true,
      settings: entry.settings,
      clip: entry.clip,
      notes: entry.notes.map((note) => GB.noteData(note)),
    });
  }

  /** Charge une chanson dans l'éditeur : une piste verrouillée par contribution (les `count` premières). */
  function loadSong(song, count) {
    // Chaque chanson a SON tempo (celui choisi par son créateur à la préparation) : la boucle, l'écoute et la révélation le suivent.
    const bpm = song.bpm ? Math.min(CONFIG.BPM_MAX, Math.max(CONFIG.BPM_MIN, Math.round(song.bpm))) : store.state.bpm;
    store.startGame(bpm);
    GB.audio.setBpm(bpm);
    const list = contributionsOf(song);
    list.slice(0, count === undefined ? list.length : count).forEach(layerFromContribution);
    state.loadedSongId = song.id;
    GB.audio.syncTracks();
  }

  /* ------------------------------------------------------------------ */
  /*  Contributions                                                      */
  /* ------------------------------------------------------------------ */

  /** Contenu actuel d'une tâche : la piste en cours de composition (ou le brouillon mis de côté), ou null s'il n'y a rien. */
  function contentOf(turn) {
    const track = turn.trackId ? store.getTrack(turn.trackId) : null;
    const source = track
      ? { instrumentId: track.instrumentId, settings: track.settings, clip: track.clip, notes: track.notes, mode: modeOf(turn.playerId) }
      : turn.draft || null;
    if (!source) return null;
    const hasNotes = source.notes && source.notes.length > 0;
    if (!hasNotes && !source.clip) return null;
    return source;
  }

  /**
   * Enregistre la contribution d'un participant à une chanson. Refuse (renvoie null) si ce participant
   * a déjà contribué à cette chanson : jamais de doublon, jamais d'écrasement.
   * `how` : 'ready' (clic sur Prêt) | 'timeout' (chrono à zéro) | 'absent' ; `source` : le contenu, ou null (contribution vide).
   */
  function commitContribution(turn, source, how, role) {
    const song = songById(turn.songId);
    if (!song || hasContributed(song.id, turn.playerId)) return null;
    contributionCounter += 1;
    const empty = !source;
    const instrumentId = empty ? null : source.instrumentId;
    const entry = Object.freeze({
      id: 'contribution-' + contributionCounter,
      songId: song.id,
      playerId: turn.playerId,
      order: song.contributionIds.length,
      kind: turn.kind === 'create' ? 'initial' : 'added',
      instrumentId,
      mode: empty ? null : source.mode || (state.prefs[turn.playerId] && state.prefs[turn.playerId].mode) || null,
      instrument: empty ? null : Object.freeze(GB.instruments.snapshot(instrumentId, source.settings)),
      settings: !empty && source.settings ? Object.freeze(Object.assign({}, source.settings)) : null,
      clip: !empty && source.clip ? Object.freeze(Object.assign({}, source.clip, { peaks: Object.freeze(source.clip.peaks.slice()) })) : null,
      role: role || null,
      round: turn.round,
      turnNumber: turn.number,
      empty,
      endReason: how,
      noteCount: empty ? 0 : source.notes.length,
      notes: Object.freeze(empty ? [] : source.notes.map((note) => Object.freeze(GB.noteData(note)))),
    });
    state.contributions.push(entry);
    song.contributionIds.push(entry.id);
    turn.contributionId = entry.id;
    turn.status = how === 'ready' ? 'ready' : how;
    turn.noteCount = entry.noteCount;
    turn.empty = empty;
    turn.instrumentId = instrumentId;
    turn.draft = null;
    return entry;
  }

  /* ------------------------------------------------------------------ */
  /*  Rounds                                                             */
  /* ------------------------------------------------------------------ */

  /** Plan de toute la partie : une tâche par (round, participant), calculée par js/rounds.js. */
  function buildTasks(playerIds, songIds) {
    const turns = [];
    Rounds.plan(playerIds.length).forEach((tasks, round) => {
      tasks.forEach((task) => {
        turns.push({
          number: turns.length + 1,
          round,
          kind: task.kind,
          songId: songIds[task.songIndex],
          playerId: playerIds[task.playerIndex],
          instrumentId: null,
          trackId: null,
          contributionId: null,
          status: 'pending', // 'pending' | 'working' | 'ready' | 'timeout' | 'absent'
          noteCount: 0,
          empty: false,
          draft: null,
          botAt: null,
        });
      });
    });
    return turns;
  }

  /** Phase du participant au premier plan, d'après le round et sa tâche. */
  function computePhase() {
    if (state.reveal) return;
    const turn = currentTurn();
    if (state.roundStatus === 'intro') state.phase = 'intro';
    else if (state.roundStatus === 'closing') state.phase = 'closing';
    else if (!turn) state.phase = 'ready';
    else if (turn.status !== 'working') state.phase = 'ready';
    else state.phase = 'compose'; // plus d'étape d'écoute ni de choix : l'instrument et la difficulté viennent de la préparation
  }

  /** Crée la couche du participant pour sa tâche : instrument de sa préparation (ou celui qu'il a choisi depuis). */
  function startTrack(turn) {
    const player = playerById(turn.playerId);
    const pref = state.prefs[turn.playerId] || {};
    let instrumentId = pref.instrumentId;
    if (pref.settings && pref.settings.sample && GB.instruments.registerSample && !GB.INSTRUMENTS[instrumentId]) {
      GB.instruments.registerSample({ hash: pref.settings.sample.hash, name: pref.settings.sample.name || 'Son importé', duration: pref.settings.sample.duration || 1, settings: {} });
    }
    if (GB.synth.isCustomId(instrumentId) && !GB.INSTRUMENTS[instrumentId]) GB.instruments.ensureCustom(instrumentId, pref.settings); // instrument personnalisé d'un autre joueur
    if (!GB.INSTRUMENTS[instrumentId]) instrumentId = 'piano';
    const track = store.addLayer({
      name: player.name + ' · ' + GB.INSTRUMENTS[instrumentId].label,
      instrumentId,
      color: player.color,
      author: player.id,
      turn: turn.number,
      locked: false,
      settings: instrumentId === pref.instrumentId && pref.settings ? JSON.parse(JSON.stringify(pref.settings)) : undefined,
    });
    turn.instrumentId = instrumentId;
    turn.trackId = track.id;
    return track;
  }

  /** Met la tâche du participant au premier plan dans l'éditeur (chanson chargée, brouillon restauré s'il existe). */
  function enterFocusTask() {
    const turn = currentTurn();
    if (!turn) return;
    const song = songById(turn.songId);
    const player = playerById(turn.playerId);
    const alreadyThere = state.loadedSongId === song.id && ((turn.trackId && store.getTrack(turn.trackId)) || turn.status !== 'working');
    GB.voice.cancel();
    if (!alreadyThere) {
      loadSong(song);
      turn.trackId = null;
      state.newTrackId = null;
      if (turn.status === 'working' && turn.draft) {
        const track = store.addLayer({
          name: player.name + ' · ' + GB.INSTRUMENTS[turn.draft.instrumentId].label,
          instrumentId: turn.draft.instrumentId,
          color: player.color,
          author: player.id,
          turn: turn.number,
          locked: false,
          settings: turn.draft.settings,
          clip: turn.draft.clip,
          notes: turn.draft.notes.map((note) => GB.noteData(note)),
        });
        turn.trackId = track.id;
        turn.instrumentId = track.instrumentId;
        state.phase = 'compose';
      } else if (turn.status === 'working') {
        startTrack(turn);
        state.phase = 'compose';
      }
    }
    computePhase();
    GB.audio.syncTracks();
  }

  /** Met de côté le travail en cours du participant au premier plan (changement de participant en mode test). */
  function saveDraft() {
    const turn = currentTurn();
    if (!turn || turn.status !== 'working' || !turn.trackId) return;
    const track = store.getTrack(turn.trackId);
    if (!track) return;
    turn.draft = {
      instrumentId: track.instrumentId,
      settings: track.settings ? JSON.parse(JSON.stringify(track.settings)) : null,
      clip: track.clip || null,
      notes: track.notes.map((note) => GB.noteData(note)),
    };
    turn.trackId = null;
  }

  /** Annonce d'un nouveau round : tout le monde le voit, le chrono démarre ensuite. */
  function startRound(index, previousEnd) {
    state.round = index;
    state.roundStatus = 'intro';
    state.lastEnd = previousEnd || null;
    state.introEnd = now() + timings.introMs;
    state.deadline = 0;
    state.autoSent = false;
    state.newTrackId = null;
    state.loadedSongId = null;
    if (!state.online) state.focusId = GB.HUMAN_PLAYER.id; // mode test : chaque round repart sur le joueur humain
    roundTasks().forEach((turn) => {
      turn.status = 'working';
      turn.trackId = null;
      turn.draft = null;
    });
    GB.voice.cancel();
    GB.audio.stop();
    computePhase();
    emit();
  }

  /** Le chrono démarre : les personnages simulés planifient leur composition, le participant au premier plan joue. */
  function beginWorking() {
    state.roundStatus = 'working';
    state.deadline = now() + state.duration;
    if (!state.online) {
      roundTasks().forEach((turn) => {
        const player = playerById(turn.playerId);
        if (isManual(player)) return;
        const fraction = timings.botEarliest + state.rng() * (timings.botLatest - timings.botEarliest);
        turn.botAt = now() + Math.max(900, state.duration * fraction);
      });
    }
    state.phase = 'idle';
    enterFocusTask();
    emit();
  }

  /** Un personnage simulé compose sa couche pour sa tâche du round (sur la chanson telle qu'elle est à ce round). */
  function botCompose(turn) {
    const player = playerById(turn.playerId);
    const song = songById(turn.songId);
    const tracks = contributionsOf(song)
      .filter((entry) => !entry.empty)
      .map((entry) => ({ instrumentId: entry.instrumentId, notes: entry.notes }));
    const layer = GB.bots.composeLayer({ player, tracks, progression: song.progression, rng: state.rng, opening: turn.kind === 'create' });
    commitContribution(turn, { instrumentId: layer.instrumentId, settings: null, clip: null, notes: layer.notes }, 'ready', layer.role);
  }

  /** Local : tous prêts ? alors on passe tout de suite au round suivant. */
  function checkAllReady() {
    if (state.online || state.roundStatus !== 'working') return;
    if (roundTasks().every((turn) => turn.status !== 'working')) endRound('all-ready');
  }

  /** Fin du round (local) : on sauvegarde ce que chacun avait, puis round suivant ou révélations. */
  function endRound(reason) {
    if (state.online || state.reveal) return;
    roundTasks().forEach((turn) => {
      if (turn.status !== 'working') return;
      const content = contentOf(turn);
      const entry = commitContribution(turn, content, 'timeout');
      const track = turn.trackId && store.getTrack(turn.trackId);
      if (entry && track) store.lockTrack(track.id);
    });
    if (state.round + 1 < state.roundCount) startRound(state.round + 1, reason);
    else {
      state.lastEnd = reason;
      startReveal();
    }
  }

  function tick() {
    if (!state.active || state.reveal) return;
    const time = now();
    if (state.roundStatus === 'intro') {
      if (time >= state.introEnd && !state.online) beginWorking(); // en ligne, c'est le serveur qui lance le chrono
      return;
    }
    if (state.roundStatus !== 'working') return;
    if (state.online) {
      if (time >= state.deadline && !state.autoSent) autoSendDraft();
      return;
    }
    let changed = false;
    roundTasks().forEach((turn) => {
      if (turn.status === 'working' && turn.botAt && time >= turn.botAt) {
        botCompose(turn);
        changed = true;
      }
    });
    if (roundTasks().every((turn) => turn.status !== 'working')) endRound('all-ready');
    else if (time >= state.deadline) endRound('timeout');
    else if (changed) emit(); // le chrono, lui, est affiché par l'interface sans tout redessiner
  }

  /** En ligne : le chrono est à zéro ; j'envoie mon brouillon (ou « rien ») pour qu'il soit sauvegardé. */
  function autoSendDraft() {
    state.autoSent = true;
    const turn = currentTurn();
    if (!turn || turn.status !== 'working' || !state.online) return;
    const content = contentOf(turn);
    GB.voice.cancel();
    const payload = content
      ? { instrumentId: content.instrumentId, instrument: GB.instruments.snapshot(content.instrumentId, content.settings), settings: content.settings, clip: content.clip, notes: content.notes.map((note) => GB.noteData(note)), mode: modeOf(turn.playerId) }
      : null;
    state.online.submit(state.round, payload, { auto: true });
    state.phase = 'closing';
    emit();
  }

  /* ------------------------------------------------------------------ */
  /*  Révélations                                                        */
  /* ------------------------------------------------------------------ */

  /**
   * Fin de la composition : on n'enchaîne PAS sur la révélation. Écran d'attente ('waiting') jusqu'à ce que l'hôte la lance.
   * Étapes de `state.reveal.status` : 'waiting' (avant le départ) → 'playing' (une chanson se joue) → 'done' (chanson finie,
   * on attend l'hôte) ; `ended` passe à true quand l'hôte termine la partie. Il n'existe pas d'état « pause ».
   */
  /** Sons importés utilisés dans la partie : on s'assure qu'ils sont décodés avant de lancer la musique. */
  function preloadSamples() {
    const hashes = state.contributions.map((entry) => (entry.settings && entry.settings.sample ? entry.settings.sample.hash : null)).filter(Boolean);
    if (hashes.length && GB.sounds) GB.sounds.whenReady(hashes);
  }

  function startReveal() {
    preloadSamples();
    clearTimers();
    GB.audio.stop();
    GB.audio.setLoopHook(null);
    state.roundStatus = null;
    state.phase = 'reveal';
    state.reveal = {
      songIndex: 0,
      furthest: -1, // la chanson la plus avancée déjà lancée (les réécoutes ne font pas reculer la révélation)
      shown: 0,
      total: 0,
      loops: 0,
      status: 'waiting',
      ended: false,
      doneSongs: state.songs.map(() => false),
      allDone: false,
      justAdded: null,
      token: 0,
      appliedSeq: -1, // en ligne : dernier numéro de séquence reçu du serveur
    };
    emit();
  }

  function humanId() {
    const human = state.players.find((player) => player.isHuman);
    return human ? human.id : null;
  }

  /** Qui est l'hôte ? En ligne : désigné par le serveur ; en test local : le joueur humain. */
  function hostId() {
    return state.online ? state.online.hostId : humanId();
  }

  /** Durée d'une boucle (ms). */
  function loopMs() {
    return (state.config.bars * GB.CONFIG.STEPS_PER_BAR * 60000) / store.state.bpm;
  }

  /**
   * Lance (ou relance) la révélation d'une chanson depuis le début.
   * `offsetMs` > 0 : on rejoint une révélation déjà commencée (reconnexion, son repris après une suspension) :
   * on charge les couches déjà arrivées et on se place au bon endroit de la boucle.
   */
  function playReveal(index, offsetMs) {
    const reveal = state.reveal;
    const song = state.songs[index];
    if (!reveal || !song) return false;
    reveal.token += 1;
    const token = reveal.token;
    GB.audio.stop();

    const list = contributionsOf(song);
    let startShown = 1;
    let startLoops = 0;
    let fraction = 0;
    let over = false;
    if (offsetMs > 0) {
      const loop = loopMs();
      const full = Math.floor(offsetMs / loop);
      if (full >= list.length) {
        over = true;
      } else {
        startShown = full + 1;
        startLoops = full + 1; // les rendez-vous « début de boucle » jusqu'à la boucle `full` sont passés
        fraction = Math.max(0.01, (offsetMs - full * loop) / loop);
      }
    }
    reveal.furthest = Math.max(reveal.furthest, index);
    Object.assign(reveal, {
      songIndex: index,
      shown: over ? list.length : startShown,
      total: list.length,
      loops: startLoops,
      status: over ? 'done' : 'playing',
      justAdded: list[(over ? list.length : startShown) - 1].id,
    });
    if (over) {
      reveal.doneSongs[index] = true;
      reveal.allDone = reveal.doneSongs.every(Boolean);
    }
    loadSong(song, over ? list.length : startShown);
    state.newTrackId = store.getTracks()[0] ? store.getTracks()[0].id : null;
    if (over) {
      // Révélation déjà terminée pour cette chanson : on rejoint la boucle complète, qui tourne à l'infini.
      GB.audio.setLoopHook(null);
      if (offsetMs > 0) {
        const loop = loopMs();
        GB.audio.seek(((offsetMs % loop) / loop) * GB.CONFIG.STEP_COUNT);
      }
      emit();
      GB.audio.play().catch(() => {});
      return true;
    }
    GB.audio.setLoopHook(() => revealLoopStart(token));
    if (fraction > 0) GB.audio.seek(fraction * GB.CONFIG.STEP_COUNT);
    emit();
    GB.audio.play().catch(() => {});
    return true;
  }

  /**
   * Fin de la révélation décidée par l'hôte : l'écran final s'affiche et la chanson en cours CONTINUE de tourner
   * en boucle (elle ne s'arrête que si on quitte, relance ou réécoute une autre chanson).
   */
  function endReveal() {
    const reveal = state.reveal;
    if (!reveal) return false;
    reveal.token += 1;
    GB.audio.setLoopHook(null);
    const keepPlaying = GB.audio.getStatus() === 'playing' && reveal.status === 'done';
    if (!keepPlaying) GB.audio.stop();
    reveal.ended = true;
    reveal.status = 'done';
    reveal.doneSongs = reveal.doneSongs.map(() => true);
    reveal.allDone = true;
    emit();
    return true;
  }

  /** Applique localement une commande de l'hôte (test local) ou l'état diffusé par le serveur (en ligne). */
  function applyReveal(command, arg) {
    if (command === 'start') return playReveal(0, 0);
    if (command === 'next') return playReveal(state.reveal.furthest + 1, 0);
    if (command === 'replay') return playReveal(arg, 0);
    if (command === 'end') return endReveal();
    return false;
  }

  /**
   * En ligne : le serveur a la décision. À chaque nouveau numéro de séquence on exécute l'ordre ;
   * si on arrive en retard (reconnexion) ou qu'on demande une resynchronisation, on rejoint au bon endroit.
   */
  function applyRevealView(view, force) {
    const reveal = state.reveal;
    if (!reveal || !view) return;
    const isNew = view.seq !== reveal.appliedSeq;
    if (!isNew && !force) return;
    const first = reveal.appliedSeq === -1;
    reveal.appliedSeq = view.seq;
    if (Number.isInteger(view.furthest)) {
      reveal.furthest = Math.max(reveal.furthest, view.furthest);
      for (let index = 0; index < view.furthest; index += 1) reveal.doneSongs[index] = true; // chansons déjà révélées avant mon arrivée
    }
    if (view.stage === 'ended') {
      if (!reveal.ended) endReveal();
    } else if (view.stage === 'song') {
      const late = force || (first && view.elapsedMs > 1500) ? view.elapsedMs : 0;
      playReveal(view.songIndex, late);
    } else if (reveal.status !== 'waiting') {
      emit();
    }
  }

  /**
   * Appelée par le moteur audio au 1er temps de chaque boucle, avant de lire les notes :
   * la nouvelle couche est donc prête pile au début de la boucle.
   *   boucle 0            → le créateur seul
   *   boucle k (1 … n−1)  → + la contribution n° k (les précédentes continuent de jouer)
   *   boucle n            → la boucle complète vient de se terminer : la révélation est finie
   * Une contribution vide n'ajoute aucun son : la révélation l'indique et passe à la suivante.
   */
  function revealLoopStart(token) {
    const reveal = state.reveal;
    if (!reveal || token !== reveal.token || state.phase !== 'reveal' || reveal.status !== 'playing') return;
    const loopIndex = reveal.loops;
    reveal.loops += 1;
    if (loopIndex === 0) return;

    if (loopIndex < reveal.total) {
      const entry = contributionsOf(state.songs[reveal.songIndex])[reveal.shown];
      const track = layerFromContribution(entry);
      GB.audio.syncTracks();
      reveal.shown += 1;
      reveal.justAdded = entry.id;
      state.newTrackId = track ? track.id : null;
      setTimeout(() => token === reveal.token && emit(), 0);
      return;
    }

    // Toutes les couches ont joué une boucle complète.
    reveal.status = 'done';
    reveal.doneSongs[reveal.songIndex] = true;
    reveal.allDone = reveal.doneSongs.every(Boolean);
    // La boucle complète continue de tourner À L'INFINI (la musique ne s'arrête pas) jusqu'à ce que l'hôte décide :
    // la chanson suivante ne démarre JAMAIS toute seule, seule une commande de l'hôte arrête ou change la musique.
    setTimeout(() => {
      if (token !== reveal.token) return;
      emit();
    }, 0);
  }

  /* ------------------------------------------------------------------ */
  /*  API publique                                                       */
  /* ------------------------------------------------------------------ */

  GB.game = {
    state,
    LIMITS,
    DEFAULT_SETUP,
    timings,

    onChange(listener) {
      listeners.push(listener);
    },

    /** Participants d'une partie à `participants` joueurs (le joueur humain compris). */
    getPlayers(participants, playerName) {
      const name = String(playerName || '').replace(/\s+/g, ' ').trim().slice(0, 16);
      return [Object.assign({}, GB.HUMAN_PLAYER, name ? { name } : {})].concat(GB.BOT_PLAYERS.slice(0, clamp(participants, LIMITS.participants) - 1));
    },

    currentTurn,
    playerById,
    songById,
    contributionsOf,
    hasContributed,
    isManual,
    taskOf,
    roundTasks,

    getCurrentPlayer() {
      return state.focusId ? playerById(state.focusId) : null;
    },

    getCurrentSong() {
      const turn = currentTurn();
      return turn ? songById(turn.songId) : null;
    },

    /** Participants qui n'ont pas encore contribué à cette chanson, dans l'ordre des joueurs. */
    getSongRemaining(songId) {
      return state.players.filter((player) => !hasContributed(songId, player.id));
    },

    /** Chansons auxquelles ce participant n'a pas encore contribué. */
    getPlayerRemaining(playerId) {
      return state.songs.filter((song) => !hasContributed(song.id, playerId));
    },

    isSongComplete(songId) {
      return state.players.every((player) => hasContributed(songId, player.id));
    },

    /** Instrument actuellement sélectionné pour la tâche en cours (ou null avant le choix). */
    getTurnInstrumentId() {
      const turn = currentTurn();
      if (!turn) return null;
      const track = turn.trackId ? store.getTrack(turn.trackId) : null;
      return track ? track.instrumentId : turn.instrumentId || null;
    },

    /** Chrono du round pour l'affichage. `phase` : 'intro' | 'working' | 'closing' | null. */
    getTimer() {
      if (!state.active || !state.roundStatus) return { phase: null, remainingMs: 0, totalMs: state.duration, fraction: 0 };
      const time = now();
      if (state.roundStatus === 'intro') {
        const remainingMs = Math.max(0, state.introEnd - time);
        return { phase: 'intro', remainingMs, totalMs: timings.introMs, fraction: 1 - remainingMs / Math.max(1, timings.introMs) };
      }
      const remainingMs = state.roundStatus === 'closing' ? 0 : Math.max(0, state.deadline - time);
      return { phase: state.roundStatus, remainingMs, totalMs: state.duration, fraction: state.duration ? remainingMs / state.duration : 0 };
    },

    /** Chiffres affichés pendant la partie. */
    getProgress() {
      const tasks = roundTasks();
      const total = state.turns.length;
      const done = state.turns.filter((entry) => entry.status !== 'working' && entry.status !== 'pending').length;
      return {
        round: Math.max(0, state.round) + 1,
        totalRounds: state.roundCount,
        stage: state.round === 0 ? 'create' : 'add',
        readyCount: tasks.filter((turn) => turn.status !== 'working').length,
        taskCount: tasks.length,
        doneTasks: done,
        totalTasks: total,
        songCount: state.songs.length,
      };
    },

    /** Contributions de toutes les chansons (chaque entrée est liée à un participant ET à une chanson). */
    getContributions() {
      return state.contributions.map((entry) => ({
        contribution: entry,
        song: songById(entry.songId),
        player: playerById(entry.playerId),
        instrument: entry.instrumentId ? GB.INSTRUMENTS[entry.instrumentId] : null,
      }));
    },

    /**
     * Lance une partie de test local. `setup` : { participants (2–8), bars, bpm, manual, roundSeconds, seed? }.
     * `manual` : tous les participants sont contrôlés à la main (on passe de l'un à l'autre) ; sinon, seul le joueur
     * est humain et les autres sont des personnages simulés qui composent pendant le round.
     */
    start(setup) {
      clearTimers();
      GB.voice.cancel();
      GB.audio.setLoopHook(null);
      const merged = Object.assign({}, DEFAULT_SETUP, setup || {});
      state.config = {
        participants: clamp(merged.participants, LIMITS.participants),
        bars: clamp(merged.bars, LIMITS.bars),
        bpm: Math.min(CONFIG.BPM_MAX, Math.max(CONFIG.BPM_MIN, Math.round(Number(merged.bpm)) || DEFAULT_SETUP.bpm)),
        manual: Boolean(merged.manual),
        roundSeconds: Rounds.clampSeconds(merged.roundSeconds),
        theme: merged.theme ? Object.assign({}, merged.theme) : GB.themes.defaultTheme(), // sans phase de thème : thème par défaut, indiqué comme tel
        playerName: String(merged.name || '').replace(/\s+/g, ' ').trim().slice(0, 16), // pseudo du joueur : figé au lancement
      };
      state.theme = state.config.theme;
      const seed = merged.seed !== undefined ? merged.seed : Math.floor(Math.random() * 4294967295);
      state.rng = GB.createRng(seed);

      GB.audio.stop();
      GB.setLoopBars(state.config.bars);
      store.startGame(state.config.bpm);
      GB.audio.setLoopSteps();
      GB.audio.setBpm(state.config.bpm);
      GB.audio.syncTracks();

      state.online = null;
      state.players = GB.game.getPlayers(state.config.participants, state.config.playerName);
      state.contributions = [];
      state.reveal = null;
      state.loadedSongId = null;
      contributionCounter = 0;

      // Choix de préparation : ceux qui sont passés (setup.preps) ou, à défaut, les valeurs par défaut.
      state.prep = {};
      state.prefs = {};
      state.players.forEach((player) => {
        const given = merged.preps && merged.preps[player.id];
        const prep = given ? Object.assign({}, given) : GB.phases.defaultPrep({ defaultBpm: state.config.bpm });
        prep.bpm = GB.phases.clampBpm(prep.bpm, state.config.bpm);
        state.prep[player.id] = prep;
        state.prefs[player.id] = { instrumentId: prep.instrumentId, mode: prep.mode, settings: prep.settings ? JSON.parse(JSON.stringify(prep.settings)) : null };
      });

      // Une chanson par participant, chacune avec son créateur, son tempo et sa propre grille d'accords.
      state.songs = state.players.map((player, index) => ({
        id: 'song-' + (index + 1),
        index,
        letter: String.fromCharCode(65 + index),
        creatorId: player.id,
        bpm: state.prep[player.id].bpm,
        progression: GB.pickProgression(state.rng),
        contributionIds: [],
      }));

      // Titre de chaque chanson : le pseudo de son créateur (figé ici, au lancement), jamais celui du dernier contributeur.
      const titles = GB.rounds.songTitles(state.songs, (id) => state.players.find((player) => player.id === id).name);
      state.songs.forEach((song) => {
        song.title = titles[song.id];
      });

      state.turns = buildTasks(
        state.players.map((player) => player.id),
        state.songs.map((song) => song.id)
      );
      state.roundCount = state.config.participants;
      state.duration = state.config.roundSeconds * 1000;
      state.focusId = GB.HUMAN_PLAYER.id;
      state.active = true;
      state.newTrackId = null;
      startTicker();
      startRound(0, null);
    },

    /** Mode test : passer à un autre participant (son brouillon est conservé, celui qu'on quitte aussi). */
    focusPlayer(playerId) {
      if (!state.active || state.online || !state.config.manual || state.reveal) return false;
      if (state.roundStatus !== 'working' || !playerById(playerId) || playerId === state.focusId) return false;
      saveDraft();
      state.focusId = playerId;
      state.phase = 'idle';
      state.loadedSongId = null;
      enterFocusTask();
      emit();
      return true;
    },

    /**
     * Change l'instrument de ma couche en cours (compact, pendant le round). Les notes et l'enregistrement sont conservés ;
     * le nouvel instrument est mémorisé comme mon instrument courant (la contribution l'enregistre).
     */
    changeInstrument(instrumentId, settings) {
      const turn = currentTurn();
      if (state.phase !== 'compose' || !turn || turn.status !== 'working' || !turn.trackId || !GB.INSTRUMENTS[instrumentId]) return false;
      const track = store.getTrack(turn.trackId);
      if (!track || track.locked) return false;
      if (track.instrumentId !== instrumentId) {
        if (!store.setInstrument(track.id, instrumentId)) return false;
        if (settings) track.settings = JSON.parse(JSON.stringify(settings));
      }
      turn.instrumentId = instrumentId;
      state.prefs[turn.playerId] = Object.assign({}, state.prefs[turn.playerId], { instrumentId, settings: track.settings ? JSON.parse(JSON.stringify(track.settings)) : null });
      GB.audio.syncTracks();
      emit();
      return true;
    },

    /** Change la difficulté du participant au premier plan (affichage du piano-roll : aucune note n'est touchée). */
    setMode(mode) {
      const turn = currentTurn();
      if (!turn || !GB.MODES[mode]) return false;
      state.prefs[turn.playerId] = Object.assign({}, state.prefs[turn.playerId], { mode });
      return true;
    },

    getMode(playerId) {
      return modeOf(playerId || state.focusId);
    },

    /** Réglages choisis à la préparation par un participant. */
    getPrep(playerId) {
      return state.prep[playerId] || null;
    },

    /** « Prêt » possible : au moins une note ou un enregistrement, pas de micro en cours, tâche encore ouverte. */
    canValidate() {
      const turn = currentTurn();
      const track = turn && turn.trackId ? store.getTrack(turn.trackId) : null;
      return (
        state.phase === 'compose' &&
        state.roundStatus === 'working' &&
        turn.status === 'working' &&
        Boolean(track) &&
        store.hasContent(track.id) &&
        !GB.voice.isRecording()
      );
    },

    /**
     * Clic sur « Prêt » : la contribution est enregistrée et verrouillée tout de suite (jamais deux fois).
     * Local : enregistrée ici. En ligne : envoyée au serveur, qui l'enregistre et la diffuse.
     */
    validateTurn() {
      if (!GB.game.canValidate()) return false;
      const turn = currentTurn();
      const track = store.getTrack(turn.trackId);
      if (state.online) {
        const sent = state.online.submit(state.round, {
          instrumentId: track.instrumentId,
          instrument: GB.instruments.snapshot(track.instrumentId, track.settings),
          settings: track.settings,
          clip: track.clip,
          notes: track.notes.map((note) => GB.noteData(note)),
          mode: modeOf(turn.playerId),
        }, {});
        if (!sent) return false;
        turn.status = 'ready'; // verrouillé tout de suite ; si le serveur refuse, sendFailed() rouvre
        turn.pendingSend = true;
        store.lockTrack(track.id);
        state.phase = 'ready';
        emit();
        return true;
      }
      const entry = commitContribution(turn, contentOf(turn), 'ready');
      if (!entry) return false;
      store.lockTrack(track.id);
      state.phase = 'ready';
      emit();
      checkAllReady();
      return true;
    },

    /* ----------------------------- révélations ----------------------------- */

    /** La révélation est en cours et pilotée par l'hôte : les joueurs n'ont ni pause, ni arrêt, ni déplacement de la barre. */
    isRevealLocked() {
      return Boolean(state.active && state.phase === 'reveal' && state.reveal && !state.reveal.ended);
    },

    /** Qui est l'hôte (id) ? */
    hostId,

    /** Suis-je l'hôte ? (`playerId` : un autre joueur, pour les tests) */
    isHost(playerId) {
      const who = playerId || (state.online ? state.online.youId : humanId());
      return Boolean(who) && who === hostId();
    },

    /**
     * Commande de révélation : 'start' | 'next' | 'end' | 'replay' (arg = index de la chanson).
     * SEUL l'hôte peut les donner (`by` : l'auteur de la commande, pour les tests ; par défaut moi).
     *   start  : écran d'attente → révélation de la 1re chanson
     *   next   : chanson terminée → chanson suivante         end : dernière chanson terminée → écran final
     *   replay : réécoute d'une chanson déjà révélée (pour tout le monde en même temps)
     * En ligne, la commande part au serveur qui la diffuse à tous ; en test local, elle s'applique directement.
     */
    revealCommand(command, arg, by) {
      const reveal = state.reveal;
      if (!state.active || state.phase !== 'reveal' || !reveal) return { ok: false, code: 'bad-state' };
      const who = by || (state.online ? state.online.youId : humanId());
      if (who !== hostId()) return { ok: false, code: 'not-host' };
      const last = state.songs.length - 1;
      const allowed =
        !reveal.ended &&
        ((command === 'start' && reveal.status === 'waiting') ||
          (command === 'next' && reveal.status === 'done' && reveal.furthest < last) ||
          (command === 'end' && reveal.status === 'done' && reveal.furthest === last) ||
          (command === 'replay' && reveal.status === 'done' && Number.isInteger(arg) && reveal.doneSongs[arg]));
      if (!allowed) return { ok: false, code: 'bad-state' };
      if (state.online) {
        const sent = state.online.revealSend(command, arg);
        return sent ? { ok: true, sent: true } : { ok: false, code: 'offline' };
      }
      applyReveal(command, arg);
      return { ok: true };
    },

    /** Après la fin de la partie : réécoute personnelle d'une chanson (plus de révélation à protéger, chacun écoute pour soi). */
    listenAgain(index) {
      const reveal = state.reveal;
      if (state.phase !== 'reveal' || !reveal || !reveal.ended) return false;
      return playReveal(index, 0);
    },

    /** En ligne : redemande l'état de la révélation (son rétabli après une suspension) pour rejoindre les autres. */
    resyncReveal() {
      const reveal = state.reveal;
      if (!state.online || state.phase !== 'reveal' || !reveal || reveal.ended || reveal.status === 'waiting') return false;
      reveal.wantResync = true;
      return state.online.revealSync();
    },

    /** Abandonne la partie (rien n'est conservé). */
    quit() {
      clearTimers();
      GB.voice.cancel();
      GB.audio.setLoopHook(null);
      if (state.reveal) state.reveal.token += 1;
      state.active = false;
      state.online = null;
      state.phase = 'idle';
      state.roundStatus = null;
      state.round = -1;
      state.newTrackId = null;
      state.reveal = null;
      emit();
    },

    /* ------------------------------- en ligne ------------------------------- */

    online: {
      isActive() {
        return Boolean(state.online);
      },

      getYouId() {
        return state.online ? state.online.youId : null;
      },

      isHost() {
        return Boolean(state.online) && state.online.hostId === state.online.youId;
      },

      /**
       * Démarre (ou reconstruit) la partie à partir de la vue du salon envoyée par le serveur.
       * `contributions` : toutes celles déjà enregistrées, dans l'ordre. `submit(round, contribution, extra)` envoie la mienne.
       * Appelée au lancement, mais aussi à la reconnexion : l'état local est entièrement refait depuis le serveur.
       */
      start(room, youId, contributions, submit, revealTools) {
        clearTimers();
        GB.voice.cancel();
        GB.audio.setLoopHook(null);
        if (state.reveal) state.reveal.token += 1;
        state.online = {
          youId,
          hostId: room.hostId,
          code: room.code,
          submit,
          revealSend: (revealTools && revealTools.send) || (() => false),
          revealSync: (revealTools && revealTools.sync) || (() => false),
        };
        state.config = {
          participants: room.players.length,
          bars: room.settings.bars,
          bpm: room.settings.bpm,
          manual: false,
          online: true,
          roundSeconds: room.settings.roundSeconds,
        };
        state.rng = GB.createRng(1);
        state.theme = room.theme || GB.themes.defaultTheme();

        GB.audio.stop();
        GB.setLoopBars(state.config.bars);
        store.startGame(state.config.bpm);
        GB.audio.setLoopSteps();
        GB.audio.setBpm(state.config.bpm);
        GB.audio.syncTracks();

        state.players = room.players.map((entry) => ({
          id: entry.id,
          name: entry.name,
          avatar: entry.avatar,
          color: entry.color,
          skin: entry.skin,
          isHuman: entry.id === youId,
          connected: entry.connected,
          host: entry.host,
        }));
        state.songs = room.songs.map((song, index) => ({ id: song.id, index, letter: song.letter, title: song.title, creatorId: song.creatorId, bpm: song.bpm || room.settings.bpm, progression: null, contributionIds: [] }));
        state.prep = {};
        state.prefs = {};
        const prepMap = room.pre && room.pre.prep ? room.pre.prep : {};
        state.players.forEach((player) => {
          const prep = prepMap[player.id] || GB.phases.defaultPrep({ defaultBpm: room.settings.bpm });
          state.prep[player.id] = prep;
          state.prefs[player.id] = { instrumentId: prep.instrumentId, mode: prep.mode, settings: prep.settings ? JSON.parse(JSON.stringify(prep.settings)) : null };
        });
        state.turns = [];
        room.plan.forEach((tasks, round) => {
          tasks.forEach((task) => {
            state.turns.push({
              number: state.turns.length + 1,
              round,
              kind: task.kind,
              songId: task.songId,
              playerId: task.playerId,
              instrumentId: null,
              trackId: null,
              contributionId: null,
              status: 'pending',
              noteCount: 0,
              empty: false,
              draft: null,
              botAt: null,
            });
          });
        });
        state.roundCount = room.plan.length;
        state.contributions = [];
        state.reveal = null;
        state.loadedSongId = null;
        state.newTrackId = null;
        state.focusId = youId;
        state.round = -1;
        state.roundStatus = null;
        state.duration = room.settings.roundSeconds * 1000;
        state.autoSent = false;
        state.phase = 'idle';
        state.active = true;
        (contributions || []).forEach((entry) => GB.game.online.applyContribution(entry, true));
        startTicker();
        GB.game.online.applyRoom(room);
      },

      /** Une contribution enregistrée par le serveur (la mienne ou celle d'un autre) : on l'enregistre une seule fois. */
      applyContribution(data, silent) {
        if (!state.online) return false;
        const song = songById(data.songId);
        if (!song || state.contributions.some((entry) => entry.id === data.id) || hasContributed(song.id, data.playerId)) return false;
        if (data.instrument) GB.instruments.ensure(data.instrument);
        const sampleHash = data.settings && data.settings.sample ? data.settings.sample.hash : null;
        if (sampleHash && !data.empty && GB.sounds) GB.sounds.ensure(sampleHash); // télécharge le son importé tout de suite, bien avant la révélation
        const empty = Boolean(data.empty);
        const entry = Object.freeze({
          id: data.id,
          songId: data.songId,
          playerId: data.playerId,
          order: song.contributionIds.length,
          kind: data.kind,
          instrumentId: empty ? null : data.instrumentId,
          mode: empty ? null : data.mode || null,
          instrument: empty ? null : Object.freeze(Object.assign({}, data.instrument || GB.instruments.snapshot(data.instrumentId, data.settings))),
          settings: !empty && data.settings ? Object.freeze(Object.assign({}, data.settings)) : null,
          clip: !empty && data.clip ? Object.freeze(Object.assign({}, data.clip, { peaks: Object.freeze((data.clip.peaks || []).slice()) })) : null,
          role: null,
          round: data.round,
          turnNumber: data.turnNumber,
          empty,
          endReason: data.endReason || 'ready',
          noteCount: empty ? 0 : data.notes.length,
          notes: Object.freeze(empty ? [] : data.notes.map((note) => Object.freeze(GB.noteData(note)))),
        });
        state.contributions.push(entry);
        song.contributionIds.push(entry.id);
        const turn = state.turns.find((candidate) => candidate.round === data.round && candidate.playerId === data.playerId);
        if (turn) {
          turn.status = entry.endReason === 'ready' ? 'ready' : entry.endReason;
          turn.contributionId = entry.id;
          turn.instrumentId = entry.instrumentId;
          turn.noteCount = entry.noteCount;
          turn.empty = empty;
          turn.pendingSend = false;
          turn.draft = null;
          if (data.playerId === state.online.youId && turn.trackId && store.getTrack(turn.trackId)) store.lockTrack(turn.trackId);
        }
        if (!silent && state.active && state.phase !== 'reveal') emit();
        return true;
      },

      /**
       * Nouvelle vue du salon envoyée par le serveur : présence, hôte, round, statut du chrono.
       * C'est le serveur qui décide du round et de la fin du round ; ici on s'aligne.
       */
      applyRoom(room) {
        if (!state.online) return;
        state.online.hostId = room.hostId;
        if (room.theme) state.theme = room.theme;
        room.players.forEach((incoming) => {
          const local = playerById(incoming.id);
          if (local) {
            local.connected = incoming.connected;
            local.host = incoming.host;
          }
        });
        if (room.status === 'finished') {
          if (state.phase !== 'reveal') startReveal();
          const force = Boolean(state.reveal && state.reveal.wantResync);
          if (force) state.reveal.wantResync = false;
          applyRevealView(room.reveal, force);
          return;
        }
        const info = room.round;
        if (!info) return;

        // Statut de chaque tâche du round (prêt, temps écoulé, absent…), tel que le serveur le connaît.
        info.tasks.forEach((entry) => {
          const turn = taskOf(entry.playerId, info.index);
          if (!turn) return;
          if (turn.status === 'working' && entry.status !== 'working') turn.status = entry.status;
          else if (turn.status === 'pending' || (turn.status !== 'working' && entry.status === 'working' && !turn.pendingSend && !turn.contributionId)) turn.status = entry.status;
        });

        const newRound = info.index !== state.round;
        const newStatus = info.status !== state.roundStatus;
        state.duration = info.durationMs;
        if (newRound) {
          state.round = info.index;
          state.lastEnd = info.lastEnd || null;
          state.autoSent = false;
          state.loadedSongId = null;
          state.newTrackId = null;
          GB.voice.cancel();
          GB.audio.stop();
        }
        if (newRound || newStatus) {
          state.roundStatus = info.status;
          if (info.status === 'intro') {
            state.introEnd = now() + info.remainingMs;
            state.phase = 'idle';
            computePhase();
          } else if (info.status === 'working') {
            state.deadline = now() + info.remainingMs;
            state.phase = state.phase === 'closing' ? 'idle' : state.phase;
            if (newRound) state.phase = 'idle';
            enterFocusTask();
          } else {
            state.deadline = now();
            const turn = currentTurn();
            if (turn && turn.status === 'working' && !state.autoSent) autoSendDraft();
            else state.phase = turn && turn.status !== 'working' ? 'ready' : 'closing';
          }
        } else if (info.status === 'working') {
          state.deadline = now() + info.remainingMs; // recale le chrono sur le serveur
        } else if (info.status === 'intro') {
          state.introEnd = now() + info.remainingMs;
        }
        emit();
      },

      /** Le serveur a refusé ma contribution : je reviens à la composition. */
      sendFailed() {
        const turn = currentTurn();
        if (!turn || !turn.pendingSend) return false;
        turn.pendingSend = false;
        turn.status = 'working';
        const track = turn.trackId && store.getTrack(turn.trackId);
        if (track) track.locked = false;
        state.phase = 'compose';
        emit();
        return true;
      },
    },

    /** Remet la boucle à 4 mesures pour la composition libre. */
    restoreFreePlayLoop() {
      GB.setLoopBars(4);
      GB.audio.setLoopSteps();
    },
  };
})((window.GB = window.GB || {}));

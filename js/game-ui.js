/**
 * GARTIC BANDE — interface de la Partie solo.
 *
 * Ce fichier affiche l'état de GB.game et transforme les clics en actions de partie.
 * Il réutilise l'éditeur existant (piano-roll, transport, tempo) via GB.ui.
 *
 * Écrans / vues :
 *   setup   configuration de la partie
 *   editor  l'éditeur, avec une vue différente selon la phase :
 *             - « lanes » : toutes les couches, pour écouter la chanson (listen, bot)
 *             - « pick »  : choix de l'instrument du tour
 *             - « roll »  : le piano-roll, pour composer sa couche
 *   final   révélations : chaque chanson est reconstruite couche après couche (liste des chansons, rejouable)
 */
(function (GB) {
  'use strict';

  const { CONFIG, store, audio, game } = GB;
  const ui = GB.ui;

  const $ = (id) => document.getElementById(id);
  const el = {
    btnSolo: $('btn-solo'),
    btnSetupStart: $('btn-setup-start'),
    btnSetupBack: $('btn-setup-back'),
    setupParticipants: $('setup-participants'),
    setupName: $('setup-name'),
    setupMode: $('setup-mode'),
    transition: $('transition'),
    setupSeconds: $('setup-seconds'),
    roundBar: $('round-bar'),
    rbLabel: $('rb-label'),
    rbKind: $('rb-kind'),
    rbTheme: $('rb-theme'),
    revealTheme: $('reveal-theme'),
    btnThemesStart: $('btn-themes-start'),
    btnThemesBack: $('btn-themes-back'),
    rbTime: $('rb-time'),
    rbFill: $('rb-fill'),
    rbReady: $('rb-ready'),
    rbMe: $('rb-me'),
    setupBars: $('setup-bars'),
    setupBpm: $('setup-bpm'),
    setupBpmValue: $('setup-bpm-value'),
    setupRoster: $('setup-roster'),
    setupSummary: $('setup-summary'),
    gamePlayers: $('game-players'),
    banner: $('phase-banner'),
    roll: $('roll'),
    lanes: $('lanes'),
    pick: $('pick'),
    btnToPick: $('btn-to-pick'),
    btnValidate: $('btn-validate'),
    btnClear: $('btn-clear'),
    btnQuit: $('btn-quit-game'),
    quitDialog: $('quit-dialog'),
    revealSongs: $('reveal-songs'),
    revealTitle: $('reveal-title'),
    revealSteps: $('reveal-steps'),
    revealStatus: $('reveal-status'),
    revealHeading: $('reveal-heading'),
    contribTitle: $('contrib-title'),
    btnRevealReplay: $('btn-reveal-replay'),
    btnRevealNext: $('btn-reveal-next'),
    finalLanes: $('final-lanes'),
    finalContributions: $('final-contributions'),
    finalSubtitle: $('final-subtitle'),
    revealWait: $('reveal-wait'),
    revealWaitText: $('reveal-wait-text'),
    btnRevealStart: $('btn-reveal-start'),
    btnRevealEnd: $('btn-reveal-end'),
    revealStage: $('reveal-stage'),
    revealHostNote: $('reveal-host-note'),
    revealVolume: $('reveal-volume'),
    audioBanner: $('audio-banner'),
    btnAudioResume: $('btn-audio-resume'),
    btnFinalAgain: $('btn-final-again'),
    btnFinalHome: $('btn-final-home'),
  };

  const setup = Object.assign({}, game.DEFAULT_SETUP);

  const INSTRUMENT_BLURBS = {
    piano: 'Notes claires et courtes',
    synth: 'Nappes douces qui durent',
    bass: 'Les graves qui portent le groove',
    lead: 'Mélodies pétillantes 8-bit',
    drums: 'Le rythme : un son par ligne',
    trumpet: 'Cuivre brillant et éclatant',
    flute: 'Souffle doux et aérien',
    vox: 'Voix électronique réglable',
    mic: 'Ta vraie voix, au micro',
  };

  function blurbFor(instrumentId) {
    if (INSTRUMENT_BLURBS[instrumentId]) return INSTRUMENT_BLURBS[instrumentId];
    const meta = GB.INSTRUMENTS[instrumentId];
    if (meta && meta.sample) return 'Son importé' + (meta.settings && meta.settings.sample && meta.settings.sample.duration ? ' · ' + meta.settings.sample.duration.toFixed(1).replace('.', ',') + ' s' : '');
    const wave = meta && meta.settings ? GB.instruments.WAVES.find((entry) => entry.value === meta.settings.wave) : null;
    return 'Instrument perso' + (wave ? ' · ' + wave.label.toLowerCase() : '');
  }

  const GAME_TIPS =
    '💡 Tout le monde joue en même temps pendant le round : tu écoutes, tu choisis un instrument, tu ajoutes ta couche. ' +
    'Les couches déjà validées sont verrouillées 🔒 (petits points sur la grille). ' +
    'Attrape une note pour la déplacer, tire sa poignée pour l\'allonger. Clique sur « Prêt » quand tu as fini : sinon le chrono sauvegarde ton travail à zéro.';

  function create(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function formatDuration(seconds) {
    return seconds >= 60 && seconds % 60 === 0 ? seconds / 60 + ' min' : seconds + ' s';
  }

  function formatClock(ms) {
    const total = Math.ceil(ms / 1000);
    return Math.floor(total / 60) + ':' + String(total % 60).padStart(2, '0');
  }

  function plural(count, singular, pluralForm) {
    return count + ' ' + (count > 1 ? pluralForm : singular);
  }

  /* ------------------------------------------------------------------ */
  /*  Configuration de la partie                                         */
  /* ------------------------------------------------------------------ */

  function renderSegmented(container, values, current, onPick, label) {
    container.innerHTML = '';
    values.forEach((value) => {
      const button = create('button', 'segmented-btn', label ? label(value) : String(value));
      button.type = 'button';
      button.classList.toggle('active', value === current);
      button.setAttribute('aria-pressed', String(value === current));
      button.addEventListener('click', () => onPick(value));
      container.append(button);
    });
  }

  function range(min, max) {
    return Array.from({ length: max - min + 1 }, (_, index) => min + index);
  }

  function renderSetup() {
    const L = game.LIMITS;
    renderSegmented(el.setupParticipants, range(...L.participants), setup.participants, (value) => {
      setup.participants = value;
      renderSetup();
    });
    renderSegmented(
      el.setupMode,
      [false, true],
      Boolean(setup.manual),
      (value) => {
        setup.manual = value;
        renderSetup();
      },
      (value) => (value ? '🎛 Test solo (je joue tout le monde)' : '🤖 Avec des personnages')
    );
    renderSegmented(el.setupBars, range(...L.bars), setup.bars, (value) => {
      setup.bars = value;
      renderSetup();
    }, (value) => String(value));
    renderSegmented(el.setupSeconds, GB.rounds.DURATIONS, setup.roundSeconds, (value) => {
      setup.roundSeconds = value;
      renderSetup();
    }, formatDuration);

    el.setupBpm.min = CONFIG.BPM_MIN;
    el.setupBpm.max = CONFIG.BPM_MAX;
    el.setupBpm.value = setup.bpm;
    el.setupBpmValue.textContent = setup.bpm;

    el.setupRoster.innerHTML = '';
    game.getPlayers(setup.participants, setup.name).forEach((player) => {
      const chip = create('div', 'roster-chip');
      chip.style.setProperty('--c', player.color);
      chip.append(create('span', 'roster-avatar', player.avatar), create('span', null, player.name));
      chip.classList.toggle('is-human', player.isHuman);
      el.setupRoster.append(chip);
    });

    const n = setup.participants;
    el.setupSummary.textContent =
      plural(n, 'participant', 'participants') + ' → ' + plural(n, 'chanson', 'chansons') + ' et ' + plural(n, 'round', 'rounds') +
      ' de ' + formatDuration(setup.roundSeconds) + ' (' + n + ' contributions par chanson, la base du créateur comprise) · boucle de ' + setup.bars + ' mesures' +
      (setup.manual ? ' · tu contrôles tous les participants (clique sur un participant pour jouer sa tâche)' : ' · tu joues le premier, les autres composent tout seuls pendant le round');
  }

  function showSetup() {
    audio.stop();
    renderSetup();
    ui.showScreen('setup');
  }

  /* ------------------------------------------------------------------ */
  /*  Thèmes en mode test local : mêmes règles que le serveur (js/themes.js)  */
  /* ------------------------------------------------------------------ */

  const BOT_THEMES = [
    'Une musique de boss final',
    'La bande-son d\'un jeu sous-marin',
    'Une musique qui fait peur à un fantôme',
    'Une musique qui donne envie de danser',
    'La fin du monde',
    'Un rêve étrange',
    'Un dimanche pluvieux au marché',
    'Une poursuite à dos de dragon',
  ];

  const localThemes = { book: null, players: [], actor: null, panel: null, botTimers: [] };

  function themeIds() {
    return localThemes.players.map((player) => player.id);
  }

  const themeController = {
    view: () => GB.themes.view(localThemes.book, performance.now(), themeIds()),
    remainingMs: () => Math.max(0, localThemes.book.vote.endsAt - performance.now()),
    actorId: () => localThemes.actor,
    hostId: () => localThemes.players[0].id, // en test local, le joueur humain est l'hôte
    players: () => localThemes.players,
    actors: () => localThemes.players,
    setActor(id) {
      localThemes.actor = id;
    },
    tick() {
      if (GB.themes.tick(localThemes.book, performance.now(), themeIds()) && localThemes.panel) localThemes.panel.render();
    },
    act(command, arg) {
      const book = localThemes.book;
      const by = localThemes.actor;
      const host = themeController.hostId();
      const now = performance.now();
      const input = arg || {};
      const T = GB.themes;
      const player = localThemes.players.find((entry) => entry.id === by);
      if (command === 'propose') return T.propose(book, player, input.text);
      if (command === 'remove') return T.remove(book, by, host, input.id);
      if (command === 'vote') return T.cast(book, by, input.id, now, themeIds());
      if (command === 'vote-close') return T.close(book, by, host, themeIds());
      if (command === 'pick') return T.pick(book, by, host, input.id);
      if (command === 'default') return T.useDefault(book, by, host);
      if (command === 'vote-open') {
        const result = T.openVote(book, by, host, input.seconds, now);
        if (result.ok) scheduleBotVotes();
        return result;
      }
      return { ok: false, code: 'unknown', error: 'Commande inconnue.' };
    },
    extra(box, rerender) {
      const view = themeController.view();
      if (view.vote.status === 'idle' && !view.theme) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn btn-ghost btn-small';
        button.textContent = '🤖 Les robots proposent un thème';
        button.addEventListener('click', () => {
          localThemes.players.filter((player) => !player.isHuman).forEach((bot, index) => {
            const text = BOT_THEMES[(index + localThemes.book.themes.length) % BOT_THEMES.length];
            GB.themes.propose(localThemes.book, bot, text);
          });
          rerender();
        });
        box.append(button);
      }
    },
  };

  /** Les robots votent au hasard, à des moments différents, tant que le vote est ouvert. */
  function scheduleBotVotes() {
    localThemes.botTimers.forEach(clearTimeout);
    localThemes.botTimers = localThemes.players
      .filter((player) => !player.isHuman)
      .map((bot) =>
        setTimeout(() => {
          const book = localThemes.book;
          if (!book || book.vote.status !== 'open' || book.themes.length === 0) return;
          const target = book.themes[Math.floor(Math.random() * book.themes.length)];
          GB.themes.cast(book, bot.id, target.id, performance.now(), themeIds());
          if (localThemes.panel) localThemes.panel.render();
        }, 700 + Math.random() * 1800)
      );
  }

  function showThemes() {
    audio.unlock();
    localThemes.players = game.getPlayers(setup.participants, setup.name);
    localThemes.book = GB.themes.create();
    localThemes.actor = localThemes.players[0].id;
    localThemes.botTimers.forEach(clearTimeout);
    if (localThemes.panel) localThemes.panel.destroy();
    localThemes.panel = GB.themesUI.mount($('local-themes'), themeController);
    ui.showScreen('themes');
  }

  function startFromThemes() {
    if (localThemes.book.vote.status === 'open') {
      ui.showToast('Clôture le vote avant de lancer la partie.');
      return;
    }
    localThemes.botTimers.forEach(clearTimeout);
    setup.theme = GB.themes.settle(localThemes.book); // sans choix : thème par défaut, clairement indiqué
    startGame();
    delete setup.theme;
  }

  function startGame() {
    audio.unlock();
    ui.stashStudio();
    ui.setMode('game');
    $('tips').textContent = GAME_TIPS;
    $('roll-legend').textContent = '';
    showEditorView('lanes');
    ui.showScreen('editor');
    game.start(setup);
  }

  /* ------------------------------------------------------------------ */
  /*  Vues de l'éditeur                                                  */
  /* ------------------------------------------------------------------ */

  /**
   * 'free' | 'roll' | 'lanes' | 'pick' | 'transition' : une seule vue principale à la fois dans la scène.
   * `withLanes` : en vue 'transition', afficher aussi la chanson terminée sous le message.
   */
  function showEditorView(view, withLanes) {
    el.roll.hidden = !(view === 'free' || view === 'roll');
    if (!(view === 'free' || view === 'roll')) ui.el.vowelBar.hidden = true; // la barre des voyelles ne vit qu'avec la grille
    if (!(view === 'free' || view === 'roll')) $('voice-panel').hidden = true; // en vue roll/free, c'est renderRoll qui décide
    el.lanes.hidden = !(view === 'lanes' || (view === 'transition' && withLanes));
    el.pick.hidden = view !== 'pick';
    el.transition.hidden = view !== 'transition';
  }

  function setBanner(player, message) {
    el.banner.innerHTML = '';
    el.banner.hidden = !message;
    if (!message) return;
    const color = player ? player.color : '#7C5CFF';
    el.banner.style.setProperty('--c', color);
    if (player) el.banner.append(create('span', 'banner-avatar', player.avatar));
    el.banner.append(create('span', null, message));
  }

  /** Active / désactive les boutons d'action de la scène selon la phase. Appelé aussi par ui.js. */
  function refreshActions() {
    const inGame = ui.isGameMode() && game.state.active;
    const phase = game.state.phase;
    el.btnClear.hidden = inGame && phase !== 'compose';
    el.btnToPick.hidden = !(inGame && phase === 'listen');
    el.btnValidate.hidden = !(inGame && phase === 'compose');
    const canValidate = inGame && game.canValidate();
    el.btnValidate.disabled = !canValidate;
    el.btnValidate.title = canValidate ? 'Verrouille ta contribution pour ce round' : 'Pose au moins une note (ou enregistre ta voix) pour être prêt';
  }

  /* ------------------------------------------------------------------ */
  /*  Vue « couches » (lanes) : toute la chanson d'un coup d'œil          */
  /* ------------------------------------------------------------------ */

  /**
   * Dessine une ligne par couche ; chaque note est une barre placée selon son départ,
   * sa durée et sa hauteur. Sert pendant la partie et sur l'écran final.
   */
  function renderLanes(container, options) {
    const opts = options || {};
    const tracks = store.getTracks();
    container.innerHTML = '';
    container.style.setProperty('--cols', CONFIG.STEP_COUNT);

    // En-tête : mesures et temps
    const head = create('div', 'lanes-row lanes-head');
    head.append(create('div', 'lane-label'));
    const headTrack = create('div', 'lanes-bars');
    for (let bar = 0; bar < CONFIG.STEP_COUNT / CONFIG.STEPS_PER_BAR; bar += 1) {
      headTrack.append(create('div', 'lanes-bar', 'Mesure ' + (bar + 1)));
    }
    head.append(headTrack);
    container.append(head);

    if (tracks.length === 0) {
      container.append(create('div', 'lanes-empty', 'La boucle est vide pour l\'instant — à toi de lancer la musique !'));
    }

    tracks.forEach((track) => {
      const instrument = GB.INSTRUMENTS[track.instrumentId];
      const author = track.author ? game.playerById(track.author) : null;
      const rowCount = GB.getRowCount(track.instrumentId);
      const isNew = opts.highlightTrackId === track.id;

      const lane = create('div', 'lanes-row lane');
      lane.dataset.trackId = track.id;
      lane.style.setProperty('--c', track.color);
      lane.classList.toggle('is-new', isNew);

      const label = create('div', 'lane-label');
      label.append(
        create('span', 'lane-avatar', author ? author.avatar : instrument.icon),
        (() => {
          const text = create('span', 'lane-text');
          text.append(create('strong', null, author ? author.name : track.name), create('small', null, instrument.icon + ' ' + instrument.label));
          return text;
        })()
      );
      lane.append(label);

      const laneTrack = create('div', 'lane-track');
      track.notes.forEach((note) => {
        const bar = create('i', 'lane-note');
        bar.style.setProperty('--x', note.step);
        bar.style.setProperty('--w', store.lengthOf(track, note));
        bar.style.setProperty('--yf', rowCount > 1 ? (rowCount - 1 - note.row) / (rowCount - 1) : 0.5);
        if (note.vowel) {
          bar.dataset.vowel = note.vowel; // voix robot : la voyelle est écrite sur la note
          bar.textContent = note.vowel.toUpperCase();
        }
        laneTrack.append(bar);
      });
      if (instrument.kind === 'audio' && track.clip) {
        const clip = track.clip;
        const block = create('div', 'lane-clip');
        block.style.setProperty('--x', clip.start);
        block.style.setProperty('--w', Math.max(0.5, Math.min((clip.duration * store.state.bpm) / 60, CONFIG.STEP_COUNT - clip.start)));
        const canvas = create('canvas');
        canvas.width = 360;
        canvas.height = 48;
        block.append(canvas);
        laneTrack.append(block);
        GB.voice.drawWave(canvas, clip.peaks, 'rgba(255,255,255,0.95)');
      }
      lane.append(laneTrack);
      container.append(lane);
    });

    // Tête de lecture commune à toutes les lignes
    const overlay = create('div', 'lanes-overlay');
    overlay.append(create('div', 'playhead'));
    container.append(overlay);
  }

  /* ------------------------------------------------------------------ */
  /*  Vue « choix de l'instrument »                                      */
  /* ------------------------------------------------------------------ */

  /** « La chanson d'Alex » → « la chanson d'Alex » (pour l'insérer dans une phrase). */
  function inline(title) {
    return title.charAt(0).toLowerCase() + title.slice(1);
  }

  function renderPick() {
    const turn = game.currentTurn();
    const player = game.getCurrentPlayer();
    const song = game.getCurrentSong();
    el.pick.innerHTML = '';
    el.pick.style.setProperty('--c', player.color);
    const who = player.isHuman && !game.state.config.manual ? 'Choisis ton instrument' : player.name + ' choisit son instrument';
    el.pick.append(
      create('h3', 'pick-title', who + ' · ' + song.title),
      create(
        'p',
        'pick-sub',
        turn.kind === 'create'
          ? 'Tu crées ta propre chanson : ton instrument lance la musique.'
          : 'Tu peux en prendre un différent à chaque chanson. Ta couche s\'ajoutera à ' + inline(song.title) + '.'
      )
    );

    const cards = create('div', 'pick-cards');
    GB.instruments.pickable().forEach((instrumentId) => {
      const instrument = GB.INSTRUMENTS[instrumentId];
      const users = store
        .getTracks()
        .filter((track) => track.instrumentId === instrumentId)
        .map((track) => (track.author ? game.playerById(track.author).avatar : '•'));

      const card = create('button', 'pick-card');
      card.type = 'button';
      card.dataset.instrument = instrumentId;
      card.append(
        create('span', 'pick-icon', instrument.icon),
        create('strong', null, instrument.label),
        create('small', null, blurbFor(instrumentId)),
        create('span', 'pick-used', users.length ? 'Déjà joué par ' + users.join(' ') : 'Pas encore dans cette chanson')
      );
      cards.append(card);
    });
    const make = create('button', 'pick-card pick-card-new');
    make.type = 'button';
    make.dataset.action = 'new-instrument';
    make.append(create('span', 'pick-icon', '＋'), create('strong', null, 'Créer un instrument'), create('small', null, 'Forme d\'onde, enveloppe, écho…'));
    cards.append(make);
    const mine = create('button', 'pick-card pick-card-new');
    mine.type = 'button';
    mine.dataset.action = 'my-sounds';
    mine.append(create('span', 'pick-icon', '🎧'), create('strong', null, 'Mes sons'), create('small', null, 'Importe un son et joue-le en notes'));
    cards.append(mine);
    el.pick.append(cards);
  }

  /* ------------------------------------------------------------------ */
  /*  Bandeau de la partie                                               */
  /* ------------------------------------------------------------------ */

  /** Statut affiché sous le nom d'un joueur (pas d'étapes : seulement ce qu'il fait maintenant). */
  function statusOf(player, task) {
    if (player.connected === false) return 'absent';
    if (!task) return '';
    if (task.status === 'ready') return 'prêt ✓';
    if (task.status === 'timeout' || task.status === 'absent') return 'temps écoulé';
    return 'compose…';
  }

  /** Panneau « Joueurs » : qui est prêt, qui compose encore. En mode test, un clic change de participant. */
  function renderGameBar() {
    const state = game.state;
    const current = game.getCurrentPlayer();
    const canSwitch = state.config.manual && !state.online && state.roundStatus === 'working';

    el.gamePlayers.innerHTML = '';
    state.players.forEach((player) => {
      const task = game.taskOf(player.id);
      const chip = create('div', 'gp');
      chip.style.setProperty('--c', player.color);
      chip.classList.toggle('active', Boolean(current) && current.id === player.id);
      chip.classList.toggle('is-human', player.isHuman);
      chip.classList.toggle('absent', player.connected === false);
      chip.classList.toggle('ready', Boolean(task) && task.status !== 'working' && task.status !== 'pending');
      chip.classList.toggle('working', Boolean(task) && task.status === 'working');
      chip.dataset.playerId = player.id;
      if (canSwitch) {
        chip.classList.add('clickable');
        chip.tabIndex = 0;
        chip.setAttribute('role', 'button');
        chip.title = 'Jouer la tâche de ' + player.name;
      }
      const text = create('span', 'gp-text');
      text.append(
        create('span', 'gp-name', player.name + (player.isHuman && player.name !== 'Toi' ? ' (toi)' : '')),
        create('small', 'gp-status', statusOf(player, task))
      );
      chip.append(create('span', 'gp-avatar', player.avatar), text);
      el.gamePlayers.append(chip);
    });

    updateRoundBar();
  }

  function meStatus(state, turn) {
    if (!turn) return '';
    if (state.phase === 'ready') return '🔒 Ta contribution est verrouillée';
    if (state.phase === 'closing') return '⏱ Envoi de ton travail…';
    if (state.phase === 'listen') return '👂 Écoute la chanson reçue';
    if (state.phase === 'pick') return '🎨 Choisis ton instrument';
    if (state.phase === 'compose') return '✏️ Tu composes';
    return '';
  }

  /** Barre du round : numéro, consigne, chrono (mis à jour sans tout redessiner), nombre de prêts. */
  function updateRoundBar() {
    const state = game.state;
    const visible = state.active && ui.isGameMode() && state.roundStatus && state.phase !== 'reveal';
    el.roundBar.dataset.state = visible ? state.roundStatus : 'idle';
    if (!visible) return;
    const progress = game.getProgress();
    const timer = game.getTimer();
    const turn = game.currentTurn();
    el.rbLabel.textContent = 'Round ' + progress.round + '/' + progress.totalRounds;
    const song = turn ? game.songById(turn.songId) : null;
    const creator = song ? game.playerById(song.creatorId) : null;
    el.rbKind.textContent =
      progress.stage === 'create'
        ? song ? 'Crée la base de ' + inline(song.title) : 'Crée la base de ta chanson'
        : song ? 'Ajoute ta couche à ' + inline(song.title) + ' (' + plural(song.contributionIds.length, 'couche', 'couches') + ' déjà)' : '';
    el.rbTheme.textContent = state.theme ? '🎯 Thème : ' + state.theme.text + (state.theme.source === 'default' ? ' (par défaut)' : '') : '';
    el.rbMe.textContent = meStatus(state, turn);
    el.rbMe.dataset.me = state.phase;
    el.rbReady.textContent = progress.readyCount + '/' + progress.taskCount + ' prêts';
    let urgency = 'ok';
    if (timer.phase === 'working') {
      urgency = timer.remainingMs <= 10000 ? 'danger' : timer.fraction <= 0.25 ? 'warn' : 'ok';
      el.rbTime.textContent = formatClock(timer.remainingMs);
      el.rbFill.style.transform = 'scaleX(' + Math.max(0, Math.min(1, timer.fraction)).toFixed(4) + ')';
    } else if (timer.phase === 'intro') {
      el.rbTime.textContent = formatClock(state.duration);
      el.rbFill.style.transform = 'scaleX(1)';
    } else {
      el.rbTime.textContent = '0:00';
      el.rbFill.style.transform = 'scaleX(0)';
      urgency = 'danger';
    }
    el.roundBar.dataset.urgency = urgency;
    const progressNode = el.roundBar.querySelector('.rb-progress');
    progressNode.setAttribute('aria-valuenow', String(Math.round((1 - Math.max(0, Math.min(1, timer.fraction))) * 100)));
    const countdown = $('ri-count');
    if (countdown && timer.phase === 'intro') countdown.textContent = String(Math.max(1, Math.ceil(timer.remainingMs / 1000)));
  }

  /* ------------------------------------------------------------------ */
  /*  Affichage selon la phase                                           */
  /* ------------------------------------------------------------------ */

  function setStageTitle(player, title, subtitle) {
    ui.el.stageName.textContent = title;
    ui.el.stageInstrument.textContent = subtitle || '';
    ui.el.stageInstrument.hidden = !subtitle;
    ui.el.stageChip.style.setProperty('--track-color', player ? player.color : '#7C5CFF');
  }

  function startPlayback() {
    audio.play().catch(() => ui.showToast('Impossible de démarrer le son : clique sur Lecture.'));
  }

  /** Annonce du round : consigne, chanson reçue, compte à rebours avant le chrono. */
  function renderIntro() {
    const state = game.state;
    const progress = game.getProgress();
    const turn = game.currentTurn();
    const song = game.songById(turn.songId);
    const creator = game.playerById(song.creatorId);
    const player = game.getCurrentPlayer();
    const mine = isMine(player);
    el.transition.innerHTML = '';
    el.transition.style.setProperty('--c', player.color);
    const box = create('div', 'round-intro');
    box.append(create('div', 'transition-icon', turn.kind === 'create' ? '✨' : '🎧'));
    box.append(create('h3', null, 'Round ' + progress.round + '/' + progress.totalRounds));
    box.append(
      create(
        'p',
        null,
        turn.kind === 'create'
          ? (mine ? 'Crée la base de ta propre chanson : ' + song.title + '.' : player.name + ' crée la base de sa chanson : ' + song.title + '.') + ' Tout le monde compose en même temps !'
          : (mine ? 'Tu reçois' : player.name + ' reçoit') + ' ' + creator.avatar + ' ' + inline(song.title) +
              '. Écoute-la, choisis un instrument et ajoute ta couche : la base et les couches déjà là restent intactes.'
      )
    );
    if (state.lastEnd) {
      box.append(
        create('p', 'empty-note', state.lastEnd === 'timeout' ? '⏱ Le round précédent s\'est terminé faute de temps : chaque travail en cours a été gardé.' : '🎉 Tout le monde était prêt : on enchaîne !')
      );
    }
    const assign = create('div', 'ri-assign');
    state.players.forEach((entry) => {
      const task = game.taskOf(entry.id);
      const target = game.songById(task.songId);
      const chip = create('span', 'si-song');
      chip.style.setProperty('--c', entry.color);
      const targetCreator = game.playerById(target.creatorId);
      chip.append(create('span', 'si-letter', targetCreator.avatar), create('span', null, entry.avatar + ' ' + entry.name), create('small', 'si-title', target.title));
      assign.append(chip);
    });
    box.append(assign);
    box.append(create('p', null, 'Durée du round : ' + formatDuration(Math.round(state.duration / 1000)) + ' · le chrono démarre dans'));
    const count = create('div', 'ri-count', '4');
    count.id = 'ri-count';
    box.append(count);
    el.transition.append(box);
  }

  /** Est-ce moi qui joue ce participant ? (en test local : le joueur ; en ligne : moi ; en mode test total : tous.) */
  function isMine(player) {
    return Boolean(player) && player.isHuman && !game.state.config.manual;
  }

  /** Texte « qui joue » : « toi » pour le joueur, le prénom sinon. */
  function who(player) {
    return isMine(player) || (game.state.online && player.id === game.online.getYouId()) ? 'toi' : player.name;
  }

  function renderPhase() {
    const state = game.state;
    const player = game.getCurrentPlayer();
    const turn = game.currentTurn();
    if (!player || !turn) return;
    const song = game.songById(turn.songId);
    const creator = game.playerById(song.creatorId);
    const mine = isMine(player) || (state.online && player.id === game.online.getYouId());
    ui.el.instrumentPanel.hidden = state.phase !== 'compose';
    ui.el.stageInstrument.hidden = false;

    renderGameBar();
    ui.renderTempo();

    if (state.phase === 'intro') {
      showEditorView('transition', false);
      ui.renderTracks();
      setStageTitle(player, 'Round ' + (state.round + 1) + ' · préparation', '');
      setBanner(null, '');
      audio.stop();
      renderIntro();
    } else if (state.phase === 'listen') {
      showEditorView('lanes');
      ui.renderTracks();
      setStageTitle(player, 'Écoute ' + inline(song.title), plural(store.getTracks().length, 'couche', 'couches'));
      setBanner(
        player,
        (mine ? 'À toi' : player.name) + ' : ' + inline(song.title) + '. Écoute-la tant que tu veux (le chrono tourne), puis ' +
          (mine ? 'choisis ton' : 'choisit son') + ' instrument.'
      );
      renderLanes(el.lanes);
      startPlayback();
    } else if (state.phase === 'pick') {
      showEditorView('pick');
      ui.renderTracks();
      setStageTitle(player, 'Choix de l\'instrument', song.title + ' · round ' + (state.round + 1));
      setBanner(
        player,
        turn.kind === 'create'
          ? (mine ? 'Tu crées' : player.name + ' crée') + ' la base de ' + inline(song.title) + ' : la boucle est vide, lance-la !'
          : 'Quel instrument ' + (mine ? 'vas-tu' : player.name + ' va-t-il/elle') + ' ajouter à ' + inline(song.title) + ' ?'
      );
      renderPick();
    } else if (state.phase === 'compose') {
      showEditorView('roll');
      ui.renderTracks();
      ui.renderInstrumentPicker();
      ui.renderStageHeader();
      ui.renderRoll();
      const track = store.getSelectedTrack();
      setBanner(
        player,
        (mine ? 'À toi de composer' : player.name + ' compose') + ' avec ' + GB.INSTRUMENTS[track.instrumentId].label +
          ' (' + inline(song.title) + ') ! Clique sur « Prêt » quand c\'est bon, ou le chrono s\'en chargera.'
      );
    } else if (state.phase === 'ready' || state.phase === 'closing') {
      showEditorView('lanes');
      ui.renderTracks();
      const waiting = game.roundTasks().filter((entry) => entry.status === 'working').length;
      if (state.phase === 'closing') {
        setStageTitle(player, 'Temps écoulé', 'Sauvegarde en cours…');
        setBanner(player, '⏱ Temps écoulé : ' + (mine ? 'ta' : 'la') + ' contribution en cours est sauvegardée…');
      } else if (turn.empty) {
        setStageTitle(player, 'Rien enregistré', song.title);
        setBanner(player, '⏱ ' + (mine ? 'Tu n\'as' : player.name + ' n\'a') + ' rien composé : ce round est enregistré comme une contribution vide.');
      } else {
        setStageTitle(player, (mine ? 'Tu es prêt' : player.name + ' est prêt'), song.title + ' · verrouillé');
        setBanner(
          player,
          '✅ Contribution verrouillée. ' +
            (waiting > 0 ? 'En attente des autres joueurs (' + plural(waiting, 'joueur travaille encore', 'joueurs travaillent encore') + ')…' : 'Tout le monde est prêt !')
        );
      }
      renderLanes(el.lanes, { highlightTrackId: turn.trackId });
      startPlayback();
    }
    refreshActions();
  }

  /* ------------------------------------------------------------------ */
  /*  Écran des révélations                                              */
  /* ------------------------------------------------------------------ */

  let lastRevealKey = null;

  function renderReveal() {
    const state = game.state;
    const reveal = state.reveal;
    const song = state.songs[reveal.songIndex];
    const creator = game.playerById(song.creatorId);
    const entries = game.contributionsOf(song);
    const hasNext = reveal.furthest < state.songs.length - 1;
    const waiting = reveal.status === 'waiting';
    const ended = reveal.ended;
    const host = game.isHost();
    const hostPlayer = game.playerById(game.hostId());
    const hostName = hostPlayer ? hostPlayer.avatar + ' ' + hostPlayer.name : 'l\'hôte';
    const done = reveal.status === 'done';

    ui.showScreen('final');
    el.revealHeading.textContent = ended
      ? '🏁 Partie terminée !'
      : waiting ? '🎼 Composition terminée' : '🎶 ' + song.title;
    el.revealTheme.textContent = state.theme ? '🎯 Thème : ' + state.theme.text + (state.theme.source === 'default' ? ' (thème par défaut)' : '') : '';
    el.finalSubtitle.textContent =
      plural(state.songs.length, 'chanson', 'chansons') + ' · ' + plural(state.players.length, 'participant', 'participants') +
      ' · ' + state.config.bars + ' mesures à ' + store.state.bpm + ' BPM';

    // Liste des chansons : on y lit le titre de chaque chanson (pseudo du créateur initial).
    // Pendant la révélation, seul l'hôte peut relancer une chanson déjà entendue ; après la fin, chacun réécoute pour soi.
    el.revealSongs.innerHTML = '';
    state.songs.forEach((entry, index) => {
      const owner = game.playerById(entry.creatorId);
      const finished = reveal.doneSongs[index];
      const button = create('button', 'reveal-song');
      button.type = 'button';
      button.dataset.songIndex = index;
      button.dataset.songId = entry.id;
      button.style.setProperty('--c', owner.color);
      button.disabled = !(finished && (ended || (host && done)));
      button.classList.toggle('done', finished);
      button.classList.toggle('current', !waiting && index === reveal.songIndex);
      button.setAttribute('aria-current', String(!waiting && index === reveal.songIndex));
      const text = create('span');
      const label = ended ? (finished ? ' · ✅ réécouter' : '') : finished ? ' · ✅' : !waiting && index === reveal.songIndex ? ' · en cours' : ' · à venir';
      text.append(document.createTextNode(entry.title), create('small', null, owner.avatar + ' ' + owner.name + label));
      button.append(create('span', 'rs-letter', owner.avatar), text);
      el.revealSongs.append(button);
    });

    // Écran d'attente : la révélation ne démarre pas toute seule.
    el.revealWait.hidden = !waiting;
    el.revealStage.hidden = waiting;
    el.contribTitle.hidden = waiting;
    el.finalContributions.hidden = waiting;
    el.btnRevealStart.hidden = !(waiting && host);
    el.revealWaitText.textContent = host
      ? 'Tu es l\'hôte : lance la révélation quand tout le monde est prêt. Chaque chanson sera dévoilée couche après couche, en même temps pour tous les joueurs.'
      : 'En attente de l\'hôte (' + hostName + ') : c\'est lui qui démarre la révélation. Elle s\'affichera ici en même temps pour tout le monde.';
    el.btnFinalAgain.hidden = !ended;
    updateAudioBanner();
    if (waiting) return;

    el.revealTitle.textContent = song.title + ' — base créée par ' + creator.avatar + ' ' + creator.name;

    // Ordre d'entrée : le créateur d'abord, puis les autres, un par boucle.
    el.revealSteps.innerHTML = '';
    entries.forEach((entry, index) => {
      const player = game.playerById(entry.playerId);
      const step = create('span', 'reveal-step');
      step.style.setProperty('--c', player.color);
      step.classList.toggle('on', index < reveal.shown);
      step.classList.toggle('fresh', entry.id === reveal.justAdded && reveal.status === 'playing' && index > 0);
      step.classList.toggle('empty', Boolean(entry.empty));
      const instrument = entry.instrumentId ? GB.INSTRUMENTS[entry.instrumentId] : null;
      step.append(
        create('span', 'rst-n', String(index + 1)),
        create('span', null, player.avatar + ' ' + player.name + ' ' + (instrument ? instrument.icon : '∅'))
      );
      step.title = (index === 0 ? 'Créateur · ' : 'Boucle ' + (index + 1) + ' · ') + (instrument ? instrument.label : 'contribution vide (rien composé)');
      el.revealSteps.append(step);
    });

    // Message d'état
    const last = entries[reveal.shown - 1];
    const lastPlayer = game.playerById(last.playerId);
    if (ended) {
      el.revealStatus.textContent = '🎉 Toutes les chansons ont été entendues — la dernière continue en boucle. Clique sur une chanson pour la réécouter (chacun pour soi).';
    } else if (done) {
      el.revealStatus.textContent =
        '🔁 Boucle complète : ' + reveal.total + ' couches ensemble, en boucle sans fin. ' +
        (host
          ? hasNext ? 'La musique tourne jusqu\'à ce que tu cliques sur « Chanson suivante ».' : 'C\'était la dernière : clique sur « Terminer la partie ».'
          : 'La musique tourne jusqu\'à ce que l\'hôte (' + hostName + ') passe à la suite.');
    } else {
      el.revealStatus.textContent =
        'Boucle ' + reveal.shown + '/' + reveal.total + ' : ' +
        (last.empty
          ? lastPlayer.name + ' n\'a rien ajouté ici (contribution vide)'
          : reveal.shown === 1 ? lastPlayer.name + ' lance la chanson' : '+ ' + lastPlayer.name + ' rejoint la musique') +
        (reveal.shown === reveal.total ? ' — boucle complète !' : '');
    }

    // Couches visibles (re-dessinées seulement quand elles changent)
    const key = reveal.songIndex + ':' + reveal.shown + ':' + reveal.token;
    if (key !== lastRevealKey) {
      lastRevealKey = key;
      renderLanes(el.finalLanes, { highlightTrackId: state.newTrackId });
    }

    // Contributions déjà entendues
    el.contribTitle.textContent = 'Contributions à ' + inline(song.title) + ' (' + reveal.shown + '/' + reveal.total + ')';
    el.finalContributions.innerHTML = '';
    entries.slice(0, reveal.shown).forEach((entry, index) => {
      const player = game.playerById(entry.playerId);
      const card = create('div', 'contribution');
      card.style.setProperty('--c', player.color);
      card.classList.toggle('is-human', player.isHuman);
      const head = create('div', 'contribution-head');
      head.append(create('span', 'contribution-avatar', player.avatar), create('strong', null, player.name));
      const list = create('ul', 'contribution-list');
      const item = create('li');
      const instrument = entry.instrumentId ? GB.INSTRUMENTS[entry.instrumentId] : null;
      item.append(
        create('span', entry.empty ? 'contribution-instrument empty-note' : 'contribution-instrument', instrument ? instrument.icon + ' ' + instrument.label : '∅ Rien composé'),
        create(
          'small',
          null,
          (index === 0 ? 'Création' : 'Ajout n°' + index) + ' · ' +
            (entry.empty ? 'contribution vide (' + (entry.endReason === 'absent' ? 'joueur absent' : 'temps écoulé') + ')' : entry.clip ? 'voix ' + entry.clip.duration.toFixed(1).replace('.', ',') + ' s' : plural(entry.noteCount, 'note', 'notes')) +
            (!entry.empty && entry.endReason === 'timeout' ? ' · sauvegardé au chrono' : '') +
            (!entry.empty && entry.notes.some((note) => note.vowel) ? ' · voyelles ' + entry.notes.slice().sort((a, b) => a.step - b.step).map((note) => (note.vowel || '').toUpperCase()).join(' ') : '')
        )
      );
      list.append(item);
      card.append(head, list);
      el.finalContributions.append(card);
    });

    // Boutons de l'hôte, adaptés à l'état : jamais d'action impossible. Les autres joueurs n'ont AUCUN bouton de lecture.
    el.btnRevealReplay.hidden = !(host && done && !ended);
    el.btnRevealNext.hidden = !(host && done && hasNext && !ended);
    el.btnRevealEnd.hidden = !(host && done && !hasNext && !ended);
    el.revealHostNote.textContent = ended
      ? ''
      : host
        ? '🎛 Tu contrôles la révélation : la chanson suivante ne démarre que quand tu le décides.'
        : '🎛 L\'hôte (' + hostName + ') contrôle la révélation : tout le monde entend la même chose au même moment.';
  }

  /** Le navigateur a-t-il suspendu l'audio pendant la révélation ? On le dit et on propose de reprendre. */
  let lastAudioState = 'running';
  function audioContextState() {
    try {
      return Tone.getContext().rawContext.state;
    } catch (error) {
      return 'running';
    }
  }

  function updateAudioBanner() {
    const reveal = game.state.reveal;
    const watch = game.state.active && game.state.phase === 'reveal' && reveal && !reveal.ended && reveal.status !== 'waiting';
    const current = audioContextState();
    el.audioBanner.hidden = !(watch && current !== 'running');
    if (watch && lastAudioState !== 'running' && current === 'running') game.resyncReveal(); // le son revient : on rejoint les autres
    lastAudioState = current;
  }

  let lastPhaseKey = null;

  /** Un rendu complet refait la grille : on l'évite quand rien d'important n'a changé pour MON écran (ex. un autre joueur devient prêt). */
  function phaseKey(state) {
    const turn = game.currentTurn();
    const waiting = state.phase === 'ready' ? game.roundTasks().filter((entry) => entry.status === 'working').length : '';
    return [state.phase, state.round, state.roundStatus, state.focusId, turn && turn.status, turn && turn.trackId, turn && turn.empty, waiting].join('|');
  }

  function onGameChange(state) {
    if (!state.active) {
      lastPhaseKey = null;
      updateRoundBar();
      return;
    }
    if (state.phase === 'reveal') {
      lastPhaseKey = null;
      el.roundBar.dataset.state = 'idle';
      renderReveal();
      return;
    }
    const key = phaseKey(state);
    if (key === lastPhaseKey && (state.phase === 'compose' || state.phase === 'pick' || state.phase === 'listen')) {
      renderGameBar();
      refreshActions();
      return;
    }
    lastPhaseKey = key;
    renderPhase();
  }

  /* ------------------------------------------------------------------ */
  /*  Actions                                                            */
  /* ------------------------------------------------------------------ */

  function leaveGame(destination) {
    const wasOnline = game.state.active && game.online.isActive();
    if (wasOnline && GB.online) GB.online.leave();
    if (GB.voiceUI) GB.voiceUI.reset();
    game.quit();
    audio.stop();
    game.restoreFreePlayLoop();
    ui.setMode('free');
    showEditorView('free');
    if (destination === 'setup' && !wasOnline) showSetup();
    else ui.showScreen('home');
  }

  function bindEvents() {
    el.btnSolo.addEventListener('click', () => {
      audio.unlock();
      showSetup();
    });
    el.btnSetupBack.addEventListener('click', () => ui.showScreen('home'));
    el.btnSetupStart.addEventListener('click', showThemes);
    el.btnThemesBack.addEventListener('click', () => ui.showScreen('setup'));
    el.btnThemesStart.addEventListener('click', startFromThemes);
    el.setupBpm.addEventListener('input', () => {
      setup.bpm = Number(el.setupBpm.value);
      el.setupBpmValue.textContent = setup.bpm;
    });

    el.setupName.addEventListener('input', () => {
      setup.name = el.setupName.value;
      renderSetup();
    });
    el.btnToPick.addEventListener('click', () => game.finishListening());
    el.btnValidate.addEventListener('click', () => {
      if (game.validateTurn()) ui.showToast('Tu es prêt ✅ — contribution verrouillée');
    });

    el.pick.addEventListener('click', (event) => {
      const creator = event.target.closest('[data-action="new-instrument"]');
      if (creator) {
        GB.instrumentUI.openDialog(null);
        return;
      }
      if (event.target.closest('[data-action="my-sounds"]')) {
        GB.soundsUI.open();
        return;
      }
      const card = event.target.closest('[data-instrument]');
      if (!card) return;
      audio.unlock();
      const track = game.pickInstrument(card.dataset.instrument);
      if (track) audio.preview(track.id, GB.INSTRUMENTS[track.instrumentId].kind === 'drums' ? 0 : GB.PREVIEW_ROW);
    });

    el.btnQuit.addEventListener('click', () => {
      const online = game.state.active && game.online.isActive();
      $('quit-text').textContent = online
        ? 'Tu quittes le salon : ta place sera libérée, tes tours restants seront considérés comme absents et ta chanson abandonnée si tu ne l\'as pas terminée.'
        : 'La chanson en cours sera perdue.';
      if (typeof el.quitDialog.showModal === 'function') el.quitDialog.showModal();
      else if (window.confirm('Quitter la partie ? La chanson en cours sera perdue.')) leaveGame('home');
    });
    el.quitDialog.addEventListener('close', () => {
      if (el.quitDialog.returnValue === 'confirm') leaveGame('home');
    });

    el.gamePlayers.addEventListener('click', (event) => {
      const chip = event.target.closest('.gp.clickable');
      if (chip) game.focusPlayer(chip.dataset.playerId);
    });
    el.gamePlayers.addEventListener('keydown', (event) => {
      const chip = event.target.closest('.gp.clickable');
      if (chip && (event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault();
        game.focusPlayer(chip.dataset.playerId);
      }
    });
    setInterval(updateRoundBar, 250);
    // Révélation : seules les commandes de l'hôte existent (le jeu refuse les autres). Aucun bouton de pause.
    el.btnRevealStart.addEventListener('click', () => {
      audio.unlock();
      game.revealCommand('start');
    });
    el.btnRevealNext.addEventListener('click', () => game.revealCommand('next'));
    el.btnRevealEnd.addEventListener('click', () => game.revealCommand('end'));
    el.btnRevealReplay.addEventListener('click', () => {
      lastRevealKey = null;
      game.revealCommand('replay', game.state.reveal.songIndex);
    });
    el.revealSongs.addEventListener('click', (event) => {
      const button = event.target.closest('[data-song-index]');
      if (!button || button.disabled) return;
      const index = Number(button.dataset.songIndex);
      lastRevealKey = null;
      if (game.state.reveal.ended) game.listenAgain(index);
      else game.revealCommand('replay', index);
    });
    el.revealVolume.addEventListener('input', () => audio.setMasterVolume(Number(el.revealVolume.value) / 100));
    el.btnAudioResume.addEventListener('click', () => {
      audio.unlock().then(() => {
        updateAudioBanner();
        game.resyncReveal();
      });
    });
    setInterval(updateAudioBanner, 700);
    el.btnFinalAgain.addEventListener('click', () => leaveGame('setup'));
    el.btnFinalHome.addEventListener('click', () => leaveGame('home'));

    game.onChange(onGameChange);
    GB.instrumentUI.onSaved(() => {
      if (game.state.active && game.state.phase === 'pick') renderPick();
    });
  }

  GB.gameUI = {
    init() {
      bindEvents();
      renderSetup();
    },
    showEditorView,
    refreshActions,
    /** Lance une partie de test local avec ces réglages (utilisé par les tests automatiques, durées courtes comprises). */
    startLocal(overrides) {
      Object.assign(setup, overrides || {});
      startGame();
    },
    /** Prépare l'écran de jeu pour une partie en ligne (la partie elle-même est reconstruite par game.online.start). */
    enterOnline() {
      audio.unlock();
      ui.stashStudio();
      ui.setMode('game');
      $('tips').textContent = GAME_TIPS;
      $('roll-legend').textContent = '';
      showEditorView('lanes');
      ui.showScreen('editor');
    },
  };
})((window.GB = window.GB || {}));

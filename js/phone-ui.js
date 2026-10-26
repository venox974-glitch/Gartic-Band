/**
 * GARTIC BANDE — mode PHONE côté navigateur (téléphone arabe musical, en ligne seulement).
 *
 * Le SERVEUR décide de tout (round, chrono, qui voit quoi) ; ici on affiche ce qu'il envoie et on lui renvoie MON maillon :
 *   phone-input   (privé)  le maillon précédent de MA chaîne, rien d'autre
 *   room          (public) avancement : round, chrono, qui a fini
 *   phone-chains  (public, à la révélation) toutes les chaînes
 *
 * Déroulement : idée (texte) → voix a cappella → notes (recopier la voix) → voix de mémoire → … → deviner.
 *   origin      écran texte : j'écris une chanson connue, une idée ou un thème
 *   sing        l'idée reçue s'affiche EN GROS au-dessus de l'éditeur ; si on reçoit des notes, on les écoute d'abord (écran « écoute »),
 *               puis on chante de mémoire SANS pouvoir les revoir ni les réécouter
 *   transcribe  éditeur : j'écoute la voix reçue et je la recopie au piano-roll (plusieurs pistes)
 *   guess       écran : j'écoute (miniature + son) et j'écris le titre
 * La révélation finale ressemble à une conversation de SMS : bulles qui apparaissent après un « … » qui écrit.
 * Les voix partent au serveur en HTTP (jamais par le WebSocket) et y restent jusqu'à la fin de la partie.
 */
(function (GB) {
  'use strict';

  const { CONFIG, store, audio, net } = GB;
  const ui = GB.ui;
  const P = GB.phone;
  const $ = (id) => document.getElementById(id);

  const el = {
    screen: $('screen-phone'),
    body: $('ph-body'),
    round: $('ph-round'),
    kind: $('ph-kind'),
    time: $('ph-time'),
    fill: $('ph-fill'),
    quit: $('ph-quit'),
    bar: $('phone-bar'),
    pbRound: $('pb-round'),
    pbKind: $('pb-kind'),
    pbTime: $('pb-time'),
    pbFill: $('pb-fill'),
    pbReady: $('pb-ready'),
    pbQuit: $('pb-quit'),
    task: $('phone-task'),
    idea: $('phone-idea'),
    ideaText: $('pi-text'),
    taskTitle: $('pt-title'),
    taskText: $('pt-text'),
    taskExtra: $('pt-extra'),
    titleField: $('pt-title-field'),
    title: $('pb-title'),
  };

  const ROLE_VERB = { origin: 'a proposé', transcribe: 'a recopié au piano-roll', sing: 'a rechanté de mémoire', guess: 'a deviné' };

  const st = {
    active: false,
    room: null,
    receivedAt: 0,
    input: null,
    chains: null,
    key: '',
    ticker: 0,
    sending: false,
    autoSent: false,
    savedMaxTracks: 0,
    ownTrackId: null,
    editorRound: -1, // round pour lequel l'éditeur est déjà prêt (pour ne pas effacer le travail en revenant d'un écran d'écoute)
    singStage: 'listen',
    clips: new Map(), // empreinte -> promesse du clip décodé
    listenToken: 0,
    playingKey: null,
    headRaf: 0,
    headScore: null,
    revealSeq: -1,
    revealKey: '',
    revealShown: 0,
    revealChain: -1,
    typingTimer: 0,
    quitArmed: 0,
    lastTick: -1,
  };

  const youId = () => (GB.online && GB.online.you ? GB.online.you.id : null);
  const playerById = (id) => (st.room ? st.room.players.find((player) => player.id === id) : null) || { id, name: '?', color: '#7C5CFF', skin: null };
  const hasVoice = (kind) => kind === 'sing';

  function create(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function formatTime(ms) {
    const seconds = Math.ceil(Math.max(0, ms) / 1000);
    return Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
  }

  const beep = (frequency, ms, volume) => GB.voiceUI && GB.voiceUI.beep && GB.voiceUI.beep(frequency, ms, volume);

  /* ------------------------------------------------------------------ */
  /*  Utilitaires audio                                                  */
  /* ------------------------------------------------------------------ */

  function bytesToBase64(bytes) {
    let text = '';
    for (let index = 0; index < bytes.length; index += 0x8000) text += String.fromCharCode.apply(null, bytes.subarray(index, index + 0x8000));
    return window.btoa(text);
  }

  function base64ToBytes(base64) {
    const text = window.atob(base64);
    const bytes = new Uint8Array(text.length);
    for (let index = 0; index < text.length; index += 1) bytes[index] = text.charCodeAt(index);
    return bytes;
  }

  /** Une voix reçue du serveur devient un « clip » comme ceux de l'instrument micro. */
  function fetchClip(meta) {
    if (!st.clips.has(meta.hash)) {
      st.clips.set(
        meta.hash,
        net.fetchSound(meta.hash).then((buffer) => {
          if (!buffer) {
            st.clips.delete(meta.hash); // on réessaiera
            return null;
          }
          return { id: 'phone-' + meta.hash.slice(0, 10), wav: bytesToBase64(new Uint8Array(buffer)), sampleRate: meta.sampleRate, duration: meta.duration, peaks: meta.peaks || [], start: meta.start, gainDb: meta.gainDb };
        })
      );
    }
    return st.clips.get(meta.hash);
  }

  const isVoiceLink = (link) => link.kind === 'sing';

  /**
   * Charge un maillon (notes ou voix) dans le magasin de l'éditeur, en pistes VERROUILLÉES, sans toucher à l'affichage.
   * Renvoie le nombre de pistes qui n'ont pas pu être chargées (voix introuvable).
   */
  async function addLinkLayers(link, label) {
    let missing = 0;
    for (const [index, track] of (link.tracks || []).entries()) {
      if (isVoiceLink(link)) {
        const clip = await fetchClip(track);
        if (!clip) {
          missing += 1;
          continue;
        }
        store.addLayer({ name: label + ' · voix ' + (index + 1), instrumentId: 'mic', color: '#7C5CFF', locked: true, clip });
      } else {
        if (track.instrument) GB.instruments.ensure(track.instrument);
        const instrumentId = GB.INSTRUMENTS[track.instrumentId] ? track.instrumentId : 'piano';
        store.addLayer({ name: label + ' · ' + GB.INSTRUMENTS[instrumentId].label, instrumentId, color: '#7C5CFF', locked: true, settings: track.settings, notes: (track.notes || []).map((note) => GB.noteData(note)) });
      }
    }
    return missing;
  }

  function setLoop(bars, bpm) {
    GB.setLoopBars(bars);
    audio.setLoopSteps();
    store.setBpm(bpm);
    audio.setBpm(store.state.bpm);
  }

  /** Écoute d'un maillon hors de l'éditeur (écrans « chanter de mémoire », « deviner » et révélation). */
  async function playLink(link, key) {
    const token = (st.listenToken += 1);
    audio.stop();
    stopPlayhead();
    st.playingKey = key;
    refreshPlayButtons();
    store.startGame(link.bpm || st.room.settings.bpm);
    setLoop(st.room.settings.bars, link.bpm || st.room.settings.bpm);
    const missing = await addLinkLayers(link, 'Maillon');
    if (token !== st.listenToken) return;
    if (missing && !store.getTracks().length) {
      ui.showToast('La voix est introuvable (déjà effacée ?)');
      st.playingKey = null;
      refreshPlayButtons();
      return;
    }
    audio.syncTracks();
    await audio.play();
    if (token !== st.listenToken) return;
    const score = document.querySelector('[data-score-key="' + key + '"]');
    if (score) watchPlayhead(score);
  }

  function stopListening() {
    st.listenToken += 1;
    st.playingKey = null;
    audio.stop();
    stopPlayhead();
    refreshPlayButtons();
  }

  function refreshPlayButtons() {
    document.querySelectorAll('[data-play-key]').forEach((button) => {
      const playing = st.playingKey === button.dataset.playKey;
      GB.icons.set(button, playing ? 'stop' : 'play', playing ? 'Arrêter' : 'Écouter');
      button.classList.toggle('is-playing', playing);
    });
  }

  function playButton(link, key) {
    const button = create('button', 'btn btn-secondary ph-play');
    button.type = 'button';
    button.dataset.playKey = key;
    GB.icons.set(button, 'play', 'Écouter');
    button.addEventListener('click', () => {
      audio.unlock();
      if (st.playingKey === key) stopListening();
      else playLink(link, key);
    });
    return button;
  }

  /* ------------------------------------------------------------------ */
  /*  Partition miniature : les notes (ou la voix) d'un maillon           */
  /* ------------------------------------------------------------------ */

  /**
   * Dessine un maillon en petit : une ligne par piste, les notes en barres, la voix en forme d'onde.
   * Les notes s'allument quand la lecture passe dessus (la musique se « révèle » au fil de la boucle).
   */
  function miniScore(link, key) {
    const bars = st.room.settings.bars;
    const cols = bars * CONFIG.STEPS_PER_BAR;
    const bpm = link.bpm || st.room.settings.bpm;
    const score = create('div', 'ph-score');
    score.dataset.scoreKey = key;
    score.dataset.cols = String(cols);
    score.style.setProperty('--cols', cols);
    const ruler = create('div', 'ph-score-ruler');
    for (let bar = 0; bar < bars; bar += 1) ruler.append(create('span', null, 'Mesure ' + (bar + 1)));
    score.append(ruler);
    const rows = create('div', 'ph-score-rows');
    (link.tracks || []).forEach((track, index) => {
      const row = create('div', 'ph-score-row');
      row.dataset.hue = String(index % 5);
      if (isVoiceLink(link)) {
        const widthCols = Math.min(cols - track.start, (track.duration * bpm) / 60);
        const wave = create('div', 'ph-wave');
        wave.style.setProperty('--x', track.start);
        wave.style.setProperty('--w', Math.max(0.5, widthCols));
        const peaks = (track.peaks && track.peaks.length ? track.peaks : [0.3]).slice();
        const count = Math.min(peaks.length, 60);
        for (let bucket = 0; bucket < count; bucket += 1) {
          const from = Math.floor((bucket * peaks.length) / count);
          const to = Math.max(from + 1, Math.floor(((bucket + 1) * peaks.length) / count));
          const level = Math.max.apply(null, peaks.slice(from, to));
          const bar = create('i', 'ph-wave-bar');
          bar.style.height = Math.max(8, Math.round(level * 100)) + '%';
          bar.dataset.col = String(track.start + (bucket / count) * widthCols);
          wave.append(bar);
        }
        row.append(wave);
      } else {
        const notes = track.notes || [];
        const rowsUsed = notes.map((note) => note.row);
        const low = Math.min.apply(null, rowsUsed.concat([100]));
        const high = Math.max.apply(null, rowsUsed.concat([-1]));
        const span = Math.max(6, high - low + 1);
        notes.forEach((note) => {
          const bar = create('i', 'ph-note');
          bar.dataset.step = String(note.step);
          bar.style.setProperty('--x', note.step);
          bar.style.setProperty('--w', Math.max(0.2, note.length));
          bar.style.setProperty('--y', ((high - note.row) / span) * 100 + '%');
          bar.style.setProperty('--h', 100 / span + '%');
          if (note.vowel) bar.textContent = note.vowel.toUpperCase();
          row.append(bar);
        });
      }
      rows.append(row);
    });
    score.append(rows, create('i', 'ph-score-head'));
    score.querySelector('.ph-score-head').hidden = true;
    return score;
  }

  function stopPlayhead() {
    cancelAnimationFrame(st.headRaf);
    st.headRaf = 0;
    if (st.headScore) {
      const head = st.headScore.querySelector('.ph-score-head');
      if (head) head.hidden = true;
    }
    st.headScore = null;
  }

  function watchPlayhead(score) {
    stopPlayhead();
    st.headScore = score;
    const cols = Number(score.dataset.cols) || 16;
    const head = score.querySelector('.ph-score-head');
    const loop = () => {
      if (st.headScore !== score || !score.isConnected) return;
      if (audio.getStatus() === 'playing') {
        const position = audio.getPlayheadPosition();
        head.hidden = false;
        head.style.left = (position / cols) * 100 + '%';
        score.querySelectorAll('.ph-note:not(.on)').forEach((note) => {
          if (Number(note.dataset.step) <= position) note.classList.add('on');
        });
        score.querySelectorAll('.ph-wave-bar:not(.on)').forEach((bar) => {
          if (Number(bar.dataset.col) <= position) bar.classList.add('on');
        });
      } else head.hidden = true;
      st.headRaf = requestAnimationFrame(loop);
    };
    loop();
  }

  /* ------------------------------------------------------------------ */
  /*  Cycle de vie                                                       */
  /* ------------------------------------------------------------------ */

  function activate() {
    st.active = true;
    st.key = '';
    audio.unlock();
    ui.stashStudio();
    document.body.classList.add('phone-active');
    st.savedMaxTracks = CONFIG.MAX_TRACKS;
    CONFIG.MAX_TRACKS = 14; // musique reçue (verrouillée) + mes pistes
    clearInterval(st.ticker);
    st.ticker = setInterval(tickUI, 250);
  }

  function stop() {
    if (!st.active) return;
    clearInterval(st.ticker);
    clearTimeout(st.typingTimer);
    st.active = false;
    st.room = null;
    st.input = null;
    st.chains = null;
    st.key = '';
    st.editorRound = -1;
    st.revealSeq = -1;
    st.revealKey = '';
    st.revealShown = 0;
    st.revealChain = -1;
    stopListening();
    if (GB.voiceUI) GB.voiceUI.reset();
    document.body.classList.remove('phone-active', 'phone-bpm-locked');
    document.body.removeAttribute('data-phone-kind');
    el.bar.hidden = true;
    el.task.hidden = true;
    el.idea.hidden = true;
    CONFIG.MAX_TRACKS = st.savedMaxTracks || 8;
    GB.setLoopBars(4);
    audio.setLoopSteps();
    ui.setMode('free');
  }

  function route(room) {
    st.room = room;
    st.receivedAt = performance.now();
    if (!st.active) activate();
    render();
  }

  function onInput(input) {
    const sameRound = st.input && st.input.round === input.round;
    st.input = input;
    if (!sameRound) {
      st.sending = false;
      st.autoSent = false;
      st.key = ''; // nouveau round : on reconstruit l'écran (jamais en cas de simple renvoi après une reconnexion : le travail en cours est gardé)
      st.singStage = 'listen';
      if (el.title) el.title.value = '';
    }
    if (input.previous && isVoiceLink(input.previous) && input.previous.tracks) input.previous.tracks.forEach((track) => fetchClip(track)); // précharge la voix pendant l'annonce
    render();
  }

  function onChains(chains) {
    st.chains = chains;
    if (st.room && st.room.status === 'finished') {
      st.revealKey = '';
      render();
    }
  }

  function onError(message) {
    st.sending = false;
    ui.showToast(message.message || 'Erreur');
    refreshReady();
  }

  /* ------------------------------------------------------------------ */
  /*  Affichage principal                                                */
  /* ------------------------------------------------------------------ */

  function showPhoneScreen() {
    el.bar.hidden = true;
    el.task.hidden = true;
    el.idea.hidden = true;
    ui.showScreen('phone');
  }

  function remainingMs() {
    const round = st.room && st.room.phone && st.room.phone.round;
    if (!round) return 0;
    return Math.max(0, round.remainingMs - (performance.now() - st.receivedAt));
  }

  function render() {
    const room = st.room;
    if (!room || !room.phone) return;
    if (room.status === 'finished') {
      renderReveal();
      return;
    }
    const round = room.phone.round;
    if (!round) return;
    const me = round.tasks.find((task) => task.playerId === youId());
    if (!st.input || st.input.round !== round.index) {
      if (st.key !== 'loading') {
        st.key = 'loading';
        showPhoneScreen();
        el.body.innerHTML = '';
        el.body.append(create('p', 'ph-note', 'Préparation du round…'));
        setHeader(round);
      }
      return;
    }
    const stage = round.status === 'intro' ? 'intro' : me && me.status === 'working' ? 'work' : 'wait';
    const key = round.index + ':' + stage;
    if (key !== st.key) {
      st.key = key;
      setHeader(round);
      if (stage === 'intro') buildIntro();
      else if (stage === 'work') buildWork();
      else buildWait();
    } else if (stage === 'wait') {
      updateWait();
    }
    refreshReady();
  }

  function setHeader(round) {
    const label = 'Round ' + (round.index + 1) + '/' + round.total;
    const kind = P.LABELS[round.kind].title;
    el.round.textContent = label;
    el.kind.textContent = kind;
    el.pbRound.textContent = label;
    el.pbKind.textContent = kind;
  }

  function tickUI() {
    if (!st.active || !st.room || !st.room.phone || !st.room.phone.round || st.room.status === 'finished') return;
    const round = st.room.phone.round;
    const remaining = remainingMs();
    const text = round.status === 'intro' ? 'Départ ' + Math.ceil(remaining / 1000) + ' s' : formatTime(remaining);
    el.time.textContent = text;
    el.pbTime.textContent = text;
    const used = round.status === 'working' ? 1 - remaining / Math.max(1, round.durationMs) : round.status === 'closing' ? 1 : 0;
    el.fill.style.transform = 'scaleX(' + Math.max(0, Math.min(1, 1 - used)).toFixed(3) + ')';
    el.pbFill.style.transform = el.fill.style.transform;
    const urgency = round.status === 'working' && remaining < 10000 ? 'danger' : round.status === 'working' && remaining < 30000 ? 'warn' : 'ok';
    el.screen.dataset.urgency = urgency;
    el.bar.dataset.urgency = urgency;
    // Annonce : grand compte à rebours + un bip à chaque seconde (3, 2, 1) et un bip aigu au départ
    const count = st.key.endsWith(':intro') && $('ph-intro-count');
    if (count) {
      const seconds = Math.ceil(remaining / 1000);
      if (String(seconds) !== count.textContent) {
        count.textContent = String(seconds);
        count.style.animation = 'none';
        void count.offsetWidth;
        count.style.animation = '';
        if (seconds <= 3 && seconds >= 1) beep(660, 150);
      }
    }
    if (round.status === 'working' && st.lastTick === 1 && !st.key.endsWith(':intro')) st.lastTick = -1;
    // Temps écoulé : le brouillon part tout seul (le serveur attend quelques secondes de grâce)
    if (round.status === 'closing' && st.key.endsWith(':work') && !st.autoSent && !st.sending) {
      st.autoSent = true;
      submit(true);
    }
    if (!el.bar.hidden) refreshReady();
  }

  /* ------------------------------------------------------------------ */
  /*  Annonce, attente                                                   */
  /* ------------------------------------------------------------------ */

  function micBanner() {
    if (!hasVoice(st.input.kind) || !GB.micprefs || GB.micprefs.hasAnyCalibrated()) return null;
    const banner = create('div', 'voice-calib');
    banner.append(create('span', null, 'Ton micro n\'est pas calibré : ta voix risque d\'être décalée.'));
    const button = create('button', 'btn btn-secondary btn-small', 'Calibrer mon micro');
    button.type = 'button';
    button.addEventListener('click', () => GB.calibration && GB.calibration.open());
    banner.append(button);
    return banner;
  }

  function buildIntro() {
    stopListening();
    showPhoneScreen();
    const kind = st.input.kind;
    const card = create('section', 'ph-card ph-intro');
    card.append(create('p', 'ph-step', 'Round ' + (st.input.round + 1) + ' sur ' + st.input.total));
    card.append(create('h2', null, P.LABELS[kind].title));
    card.append(create('p', 'ph-help', P.LABELS[kind].help));
    const banner = micBanner();
    if (banner) card.append(banner);
    const count = create('div', 'ph-count');
    count.id = 'ph-intro-count';
    count.setAttribute('role', 'timer');
    count.textContent = String(Math.ceil(remainingMs() / 1000));
    card.append(count);
    el.body.innerHTML = '';
    el.body.append(card);
  }

  function buildWait() {
    stopListening();
    showPhoneScreen();
    el.body.innerHTML = '';
    const card = create('section', 'ph-card');
    card.append(create('h2', null, 'Ton maillon est envoyé !'));
    card.append(create('p', 'ph-help', 'On attend les autres joueurs…'));
    const list = create('ul', 'ph-who');
    list.id = 'ph-who';
    card.append(list);
    el.body.append(card);
    updateWait();
  }

  function updateWait() {
    const list = $('ph-who');
    if (!list || !st.room.phone.round) return;
    list.innerHTML = '';
    st.room.phone.round.tasks.forEach((task) => {
      const player = playerById(task.playerId);
      const item = create('li', 'ph-who-item');
      item.dataset.status = task.status;
      item.style.setProperty('--c', player.color);
      item.append(GB.avatar.node(player, 'sb-roster'), create('span', null, player.name), create('small', null, task.status === 'ready' ? 'a fini' : task.status === 'working' ? 'travaille…' : task.status === 'absent' ? 'absent' : 'temps écoulé'));
      list.append(item);
    });
  }

  /* ------------------------------------------------------------------ */
  /*  Round de travail                                                   */
  /* ------------------------------------------------------------------ */

  function buildWork() {
    const kind = st.input.kind;
    const previous = st.input.previous && !st.input.previous.missing ? st.input.previous : null;
    if (kind === 'guess' || kind === 'origin') buildGuess();
    else if (kind === 'sing' && previous && previous.tracks && st.singStage === 'listen') buildListen(previous);
    else buildEditor(kind);
  }

  /** Écran « chanter de mémoire », 1re étape : la mélodie reçue est révélée en notes miniatures, avec le son. */
  function buildListen(previous) {
    stopListening();
    showPhoneScreen();
    el.body.innerHTML = '';
    const card = create('section', 'ph-card ph-listen-card');
    card.append(create('h2', null, 'Écoute et retiens la mélodie'));
    card.append(create('p', 'ph-help ph-big-help', 'Écoute autant que tu veux, mais attention : une fois que tu passes au chant, tu ne pourras plus la revoir ni la réécouter. Chante-la de mémoire !'));
    card.append(miniScore(previous, 'listen'));
    const actions = create('div', 'ph-controls');
    const again = playButton(previous, 'listen');
    again.id = 'ph-listen-play';
    const go = create('button', 'btn btn-primary ph-go');
    go.id = 'ph-go-sing';
    go.type = 'button';
    GB.icons.set(go, 'mic', 'Je chante de mémoire');
    go.addEventListener('click', () => {
      stopListening();
      st.singStage = 'record';
      buildEditor('sing');
    });
    actions.append(again, go);
    card.append(actions);
    el.body.append(card);
    refreshPlayButtons();
    audio.unlock();
    playLink(previous, 'listen'); // la mélodie se lance toute seule, en boucle
  }

  function buildGuess() {
    stopListening();
    showPhoneScreen();
    el.body.innerHTML = '';
    const card = create('section', 'ph-card ph-text');
    const isIdea = st.input.kind === 'origin';
    card.append(create('h2', null, P.LABELS[st.input.kind].title), create('p', 'ph-help ph-big-help', P.LABELS[st.input.kind].help));
    const previous = st.input.previous;
    if (isIdea) {
      // premier round : rien à écouter
    } else if (previous && !previous.missing) {
      card.append(miniScore(previous, 'guess'));
      const listen = create('div', 'ph-listen');
      listen.append(playButton(previous, 'guess'), create('span', 'ph-listen-note', previous.kind === 'transcribe' ? 'Une mélodie à deviner' : 'Une voix à deviner'));
      card.append(listen);
    } else {
      card.append(create('p', 'ph-note', 'Le maillon précédent est manquant (joueur absent). Écris ce que tu veux.'));
    }
    const field = create('input', 'text-input ph-input');
    field.id = 'ph-text';
    field.type = 'text';
    field.maxLength = P.TEXT_MAX;
    field.autocomplete = 'off';
    field.placeholder = isIdea ? 'Ex. : Joyeux anniversaire, ou « un chat qui danse »' : 'Ton idée : le titre de la chanson…';
    field.setAttribute('aria-label', 'Ta réponse');
    const send = create('button', 'btn btn-primary ph-send');
    send.id = 'ph-send';
    send.type = 'button';
    GB.icons.set(send, 'check', 'Prêt');
    send.addEventListener('click', () => submit(false));
    field.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') submit(false);
    });
    field.addEventListener('input', refreshReady);
    card.append(field, send);
    el.body.append(card);
    field.focus();
    refreshReady();
  }

  function setTask(title, text, extra, big) {
    el.taskTitle.textContent = title;
    el.task.classList.remove('has-idea');
    el.idea.hidden = !big;
    el.ideaText.textContent = big ? '« ' + big + ' »' : '';
    if (big) el.taskTitle.textContent = 'Chante ce thème a cappella';
    el.taskText.textContent = text;
    el.titleField.hidden = true;
    el.taskExtra.hidden = !extra;
    if (extra) {
      GB.icons.set(el.taskExtra, extra.icon, extra.label);
      el.taskExtra.onclick = extra.onClick;
    }
    el.task.hidden = false;
  }

  /** Ouvre l'éditeur : voix d'origine, recopier la voix, ou chanter de mémoire. */
  function buildEditor(kind) {
    stopListening();
    const input = st.input;
    const previous = input.previous && !input.previous.missing ? input.previous : null;
    const bpm = input.bpm || st.room.settings.bpm;
    const bars = input.bars || st.room.settings.bars;
    const lockedBpm = kind === 'transcribe' || (kind === 'sing' && previous && previous.bpm);
    document.body.setAttribute('data-phone-kind', kind);
    document.body.classList.toggle('phone-bpm-locked', Boolean(lockedBpm));

    const idea = kind === 'sing' && previous && previous.text ? previous.text : null; // l'idée reçue : affichée en GROS, impossible de la manquer
    const task = {
      transcribe: previous
        ? ['Recopie la voix au piano-roll', 'Appuie sur ▶ Lecture pour écouter la voix, puis pose les notes que tu entends. Le Speech to Note est permis. Tu peux ajouter plusieurs pistes.']
        : ['La voix est manquante', 'Le joueur précédent n\'a rien rendu : compose une chanson connue de ton choix au piano-roll.'],
      sing: idea
        ? ['« ' + idea + ' »', 'Appuie sur « Enregistrer ma voix », attends le 3-2-1, puis chante.']
        : previous && previous.tracks
          ? ['Chante la mélodie de mémoire', 'Appuie sur « Enregistrer ma voix », attends le 3-2-1, puis chante la mélodie que tu viens d\'écouter. Pas de musique, pas de retour en arrière !']
          : ['L\'idée est manquante', 'Le joueur précédent n\'a rien rendu : chante une chanson connue de ton choix.'],
    }[kind];
    const extra = null; // pas de « revoir » : la mélodie s'écoute avant, puis on la refait de mémoire

    if (st.editorRound === input.round) {
      // retour depuis l'écran d'écoute : le travail en cours (voix déjà enregistrée…) est conservé
      el.bar.hidden = false;
      ui.showScreen('editor');
      setTask(task[0], task[1], extra, idea);
      refreshReady();
      return;
    }
    st.editorRound = input.round;

    GB.setLoopBars(bars);
    audio.setLoopSteps();
    ui.startComposition(() => {
      store.startGame(bpm);
      const own = store.addTrack(); // ma première piste (l'éditeur ne s'affiche jamais sans piste)
      if (hasVoice(kind)) store.setInstrument(own.id, 'mic');
      st.ownTrackId = own.id;
    });
    setLoop(bars, bpm); // startComposition remet la boucle à 4 mesures : on rétablit celle du salon
    ui.setMode('free');
    $('mode-pill').textContent = 'Phone';
    audio.syncTracks();
    ui.renderAll();
    el.bar.hidden = false;
    ui.showScreen('editor');
    if (GB.voiceUI) GB.voiceUI.render();
    setTask(task[0], task[1], extra, idea);
    refreshReady();

    if (kind === 'transcribe' && previous && previous.tracks) {
      const roundAtStart = input.round;
      el.taskText.textContent = 'Chargement de la voix…';
      addLinkLayers(previous, 'Reçu').then((missing) => {
        if (!st.active || !st.input || st.input.round !== roundAtStart) return;
        if (st.ownTrackId && store.getTrack(st.ownTrackId)) store.selectTrack(st.ownTrackId);
        audio.syncTracks();
        ui.renderAll();
        if (GB.voiceUI) GB.voiceUI.render();
        el.taskText.textContent = (missing ? 'Une voix n\'a pas pu être chargée (introuvable). ' : '') + task[1];
      });
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Envoi du maillon                                                   */
  /* ------------------------------------------------------------------ */

  function ownTracks() {
    return store.getTracks().filter((track) => !track.locked);
  }

  const titleValue = () => (el.title ? el.title.value.trim() : '');

  /** Le maillon prêt à partir, ou null s'il n'y a rien à envoyer. Les voix sont d'abord envoyées en HTTP. */
  async function buildLink() {
    const kind = st.input.kind;
    if (kind === 'guess' || kind === 'origin') {
      const field = $('ph-text');
      const text = field ? field.value.trim() : '';
      return text ? { text } : null;
    }
    const own = ownTracks();
    if (hasVoice(kind)) {
      const voices = own.filter((track) => GB.INSTRUMENTS[track.instrumentId].kind === 'audio' && track.clip);
      if (!voices.length) return null;
      const tracks = [];
      for (const track of voices.slice(0, P.TRACKS_MAX.voice)) {
        const bytes = base64ToBytes(track.clip.wav);
        const hash = await GB.sounds.sha256(bytes.buffer);
        const sent = await net.uploadBytes(hash, bytes);
        if (!sent.ok) throw new Error(sent.error);
        tracks.push({ hash, duration: track.clip.duration, start: track.clip.start, gainDb: track.clip.gainDb, peaks: track.clip.peaks, sampleRate: track.clip.sampleRate });
      }
      const link = { bpm: store.state.bpm, tracks };
      return link;
    }
    const withNotes = own.filter((track) => GB.INSTRUMENTS[track.instrumentId].kind !== 'audio' && track.notes.length > 0);
    if (!withNotes.length) return null;
    const tracks = [];
    for (const track of withNotes.slice(0, P.TRACKS_MAX.notes)) {
      const hash = track.settings && track.settings.sample ? track.settings.sample.hash : null;
      if (hash) {
        const sent = await net.uploadSound(hash);
        if (!sent.ok) throw new Error(sent.error);
      }
      tracks.push({
        instrumentId: track.instrumentId,
        instrument: GB.instruments.snapshot(track.instrumentId, track.settings),
        settings: track.settings || null,
        notes: track.notes.map((note) => GB.noteData(note)),
      });
    }
    return { bpm: store.state.bpm, tracks };
  }

  function canSubmit() {
    if (!st.input || st.sending) return false;
    const kind = st.input.kind;
    if (kind === 'guess' || kind === 'origin') {
      const field = $('ph-text');
      return Boolean(field && field.value.trim());
    }
    if (GB.voiceUI && GB.voiceUI.isRecording()) return false;
    const own = ownTracks();
    if (hasVoice(kind)) return own.some((track) => GB.INSTRUMENTS[track.instrumentId].kind === 'audio' && track.clip);
    return own.some((track) => GB.INSTRUMENTS[track.instrumentId].kind !== 'audio' && track.notes.length > 0);
  }

  function refreshReady() {
    const ok = canSubmit();
    const send = $('ph-send');
    if (send) send.disabled = !ok;
    el.pbReady.disabled = !ok;
    const label = st.sending ? 'Envoi…' : 'Prêt';
    GB.icons.set(el.pbReady, 'check', label);
    if (send) GB.icons.set(send, 'check', label);
    const kind = st.input && st.input.kind;
    el.pbReady.title = ok ? 'Envoie ton maillon aux autres' : hasVoice(kind) ? 'Enregistre ta voix pour être prêt' : 'Pose au moins une note pour être prêt';
  }

  async function submit(auto) {
    if (!st.input || st.sending) return;
    if (!auto && !canSubmit()) return;
    st.sending = true;
    refreshReady();
    try {
      const link = await buildLink();
      if (!link) {
        st.sending = false; // rien à envoyer : le serveur créera un maillon vide à la fin du temps
        refreshReady();
        return;
      }
      if (!net.phoneSubmit(st.input.round, link)) {
        st.sending = false;
        ui.showToast('Connexion perdue : ton maillon n\'est pas parti. Réessaie dans un instant.');
      }
    } catch (error) {
      st.sending = false;
      ui.showToast(error && error.message ? error.message : 'L\'envoi a échoué.');
    }
    refreshReady();
  }

  /* ------------------------------------------------------------------ */
  /*  Révélation en « SMS »                                              */
  /* ------------------------------------------------------------------ */

  function normalize(text) {
    return String(text || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  /** Bulle de message : avatar + prénom, puis le contenu (texte, ou partition miniature + bouton d'écoute). */
  function bubble(link, key) {
    const player = link.playerId ? playerById(link.playerId) : null;
    const row = create('article', 'ph-msg ph-link ph-link-' + link.kind);
    row.dataset.kind = link.kind;
    if (player) row.style.setProperty('--c', player.color);
    if (player) row.append(GB.avatar.node(player, 'sb-roster'));
    const box = create('div', 'ph-msg-box');
    box.append(create('div', 'ph-msg-who', (player ? player.name : 'Personne') + ' ' + (player ? ROLE_VERB[link.kind] : 'n\'a rien rendu')));
    const body = create('div', 'ph-bubble');
    if (link.empty) {
      body.classList.add('is-empty');
      body.append(create('p', 'ph-link-empty', link.endReason === 'absent' ? '(joueur absent)' : '(rien rendu à temps)'));
    } else if (link.kind === 'guess' || link.kind === 'origin') {
      body.append(create('p', 'ph-link-text', '« ' + link.text + ' »'));
    } else {
      body.append(miniScore(link, key));
      const line = create('div', 'ph-link-play');
      line.append(playButton(link, key), create('small', null, (link.tracks.length > 1 ? link.tracks.length + ' pistes' : '1 piste') + ' · ' + link.bpm + ' BPM'));
      body.append(line);
    }
    box.append(body);
    row.append(box);
    return row;
  }

  /** La bulle « … » : quelqu'un est en train d'écrire. */
  function typingBubble(link) {
    const player = link.playerId ? playerById(link.playerId) : null;
    const row = create('article', 'ph-msg ph-typing');
    if (player) {
      row.style.setProperty('--c', player.color);
      row.append(GB.avatar.node(player, 'sb-roster'));
    }
    const box = create('div', 'ph-msg-box');
    box.append(create('div', 'ph-msg-who', (player ? player.name : 'Quelqu\'un') + ' écrit…'));
    const dots = create('div', 'ph-bubble ph-dots');
    dots.append(create('i'), create('i'), create('i'));
    dots.setAttribute('aria-label', 'En train d\'écrire');
    box.append(dots);
    row.append(box);
    return row;
  }

  function renderReveal() {
    const room = st.room;
    const reveal = room.phone.reveal;
    const isHost = room.hostId === youId();
    showPhoneScreen();
    el.round.textContent = 'Révélation';
    el.kind.textContent = '';
    el.time.textContent = '';
    el.fill.style.transform = 'scaleX(0)';
    const key = [reveal.stage, reveal.chain, reveal.shown, reveal.seq, st.chains ? 1 : 0, room.phone.purged ? 1 : 0, isHost ? 1 : 0].join(':');
    if (key === st.revealKey) return;
    const sameChain = st.revealChain === reveal.chain;
    const grew = sameChain && reveal.shown > st.revealShown; // nouveau maillon dans la même chaîne
    const newChain = !sameChain;
    st.revealKey = key;
    clearTimeout(st.typingTimer);
    el.body.innerHTML = '';

    if (reveal.stage === 'waiting') {
      stopListening();
      const card = create('section', 'ph-card');
      card.append(create('h2', null, 'Toutes les chaînes sont terminées !'));
      card.append(create('p', 'ph-help', 'On découvre ce que chaque chanson est devenue, message après message.'));
      if (isHost) {
        const go = create('button', 'btn btn-primary');
        go.id = 'ph-reveal-start';
        go.type = 'button';
        GB.icons.set(go, 'play', 'Lancer la révélation');
        go.addEventListener('click', () => {
          audio.unlock();
          net.phoneReveal('start');
        });
        card.append(go);
      } else {
        card.append(create('p', 'ph-note', 'L\'hôte va lancer la révélation.'));
      }
      el.body.append(card);
      return;
    }

    if (!st.chains) {
      el.body.append(create('p', 'ph-note', 'Chargement des chaînes…'));
      return;
    }

    if (reveal.stage === 'ended') {
      stopListening();
      renderEnded();
      return;
    }

    const chain = st.chains[reveal.chain];
    const starter = playerById(chain.starterId);
    const section = create('section', 'ph-chain');
    section.dataset.chain = String(reveal.chain);
    section.append(create('h2', 'ph-chain-title', 'Chaîne ' + (reveal.chain + 1) + '/' + st.chains.length + ' · lancée par ' + starter.name));
    const list = create('div', 'ph-links ph-thread');
    section.append(list);
    const controls = create('div', 'ph-controls');
    const tail = create('div', 'ph-tail'); // verdict + boutons : apparaissent une fois le dernier message affiché
    section.append(tail, controls);
    el.body.append(section);

    const showLink = (index) => list.append(bubble(chain.links[index], 'c' + reveal.chain + 'l' + index));
    for (let index = 0; index < reveal.shown - 1; index += 1) showLink(index);
    const lastIndex = reveal.shown - 1;
    const latest = chain.links[lastIndex];
    const reveal_ = () => {
      showLink(lastIndex);
      list.lastChild.classList.add('pop');
      buildTail();
      refreshPlayButtons();
      if (!latest.empty && latest.tracks) playLink(latest, 'c' + reveal.chain + 'l' + lastIndex);
      else stopListening();
      list.lastChild.scrollIntoView && list.lastChild.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    };

    function buildTail() {
      tail.innerHTML = '';
      controls.innerHTML = '';
      const chainDone = reveal.shown >= chain.links.length;
      if (chainDone) {
        const first = chain.links[0];
        const last = chain.links[chain.links.length - 1];
        if (first && last && !first.empty && !last.empty && first.text !== undefined && last.text !== undefined) {
          const found = normalize(first.text) === normalize(last.text);
          const verdict = create('p', 'ph-verdict', found ? '✔ Trouvée ! C\'était « ' + first.text + ' »' : 'C\'était « ' + first.text + ' » → réponse : « ' + last.text + ' »');
          verdict.dataset.found = String(found);
          tail.append(verdict);
        } else if (first && !first.empty && first.text !== undefined) {
          tail.append(create('p', 'ph-verdict', 'C\'était « ' + first.text + ' »'));
        }
      }
      const lastChain = reveal.chain >= st.chains.length - 1;
      if (isHost) {
        const replay = create('button', 'btn btn-ghost');
        replay.type = 'button';
        replay.id = 'ph-reveal-replay';
        GB.icons.set(replay, 'restart', 'Réécouter');
        replay.addEventListener('click', () => net.phoneReveal('replay'));
        controls.append(replay);
        const next = create('button', 'btn btn-primary');
        next.type = 'button';
        next.id = 'ph-reveal-next';
        if (lastChain && chainDone) {
          GB.icons.set(next, 'check', 'Terminer la partie');
          next.addEventListener('click', () => net.phoneReveal('end'));
        } else {
          GB.icons.set(next, 'play', chainDone ? 'Chaîne suivante' : 'Message suivant');
          next.addEventListener('click', () => {
            audio.unlock();
            net.phoneReveal('next');
          });
        }
        controls.append(next);
      } else {
        controls.append(create('p', 'ph-note', 'L\'hôte fait défiler la révélation.'));
      }
    }

    // « Replay » : même maillon, on relance seulement le son. Nouveau maillon ou nouvelle chaîne : animation d'écriture puis bulle.
    const replayOnly = sameChain && reveal.shown === st.revealShown && reveal.seq !== st.revealSeq && st.revealSeq !== -1;
    const first = st.revealSeq === -1 || newChain;
    const animate = grew || first || (!sameChain);
    st.revealSeq = reveal.seq;
    st.revealShown = reveal.shown;
    st.revealChain = reveal.chain;
    if (replayOnly || !animate) {
      showLink(lastIndex);
      buildTail();
      refreshPlayButtons();
      if (replayOnly && !latest.empty && latest.tracks) playLink(latest, 'c' + reveal.chain + 'l' + lastIndex);
      return;
    }
    const typing = typingBubble(latest);
    list.append(typing);
    buildTail();
    controls.classList.add('is-waiting');
    typing.scrollIntoView && typing.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    beep(520, 90, 0.12);
    st.typingTimer = setTimeout(() => {
      typing.remove();
      controls.classList.remove('is-waiting');
      beep(880, 110, 0.18); // « bip » de réception du message
      reveal_();
    }, 1100);
  }

  function renderEnded() {
    const card = create('section', 'ph-card ph-ended');
    card.append(create('h2', null, 'Partie terminée !'));
    card.append(create('p', 'ph-help', 'Les enregistrements vocaux ont été supprimés du serveur.'));
    const table = create('ul', 'ph-recap');
    st.chains.forEach((chain) => {
      const first = chain.links[0];
      const last = chain.links[chain.links.length - 1];
      const found = first && last && first.text !== undefined && last.text !== undefined && !first.empty && !last.empty && normalize(first.text) === normalize(last.text);
      const item = create('li', 'ph-recap-item');
      item.dataset.found = String(Boolean(found));
      item.append(create('span', null, first && !first.empty ? '« ' + first.text + ' »' : '(sans titre)'), create('b', null, '→'), create('span', null, last && !last.empty ? '« ' + last.text + ' »' : '(pas de réponse)'), create('small', null, found ? '✔ trouvée' : ''));
      table.append(item);
    });
    card.append(table);
    const home = create('button', 'btn btn-primary');
    home.type = 'button';
    home.id = 'ph-home';
    GB.icons.set(home, 'home', 'Retour à l\'accueil');
    home.addEventListener('click', () => {
      GB.online.leave();
      ui.showScreen('home');
    });
    card.append(home);
    el.body.append(card);
  }

  /* ------------------------------------------------------------------ */
  /*  Quitter                                                            */
  /* ------------------------------------------------------------------ */

  function quit(button) {
    if (!st.quitArmed) {
      st.quitArmed = window.setTimeout(() => {
        st.quitArmed = 0;
        GB.icons.set(button, 'close', 'Quitter');
      }, 3000);
      GB.icons.set(button, 'close', 'Sûr ? Clique encore');
      return;
    }
    clearTimeout(st.quitArmed);
    st.quitArmed = 0;
    GB.online.leave();
    ui.showScreen('home');
  }

  function bind() {
    el.pbReady.addEventListener('click', () => submit(false));
    el.quit.addEventListener('click', () => quit(el.quit));
    el.pbQuit.addEventListener('click', () => quit(el.pbQuit));
    if (el.title) el.title.addEventListener('input', refreshReady);
    // l'état du bouton Prêt suit le travail dans l'éditeur (notes posées, voix enregistrée)
    document.addEventListener('pointerup', () => st.active && !el.bar.hidden && setTimeout(refreshReady, 60));
    document.addEventListener('keyup', () => st.active && !el.bar.hidden && setTimeout(refreshReady, 60));
  }

  GB.phoneUI = {
    route,
    stop,
    onInput,
    onChains,
    onError,
    isActive: () => st.active,
    state: st,
    refreshReady,
  };

  bind();
})((window.GB = window.GB || {}));

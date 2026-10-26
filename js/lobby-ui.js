/**
 * GARTIC BANDE — écran « Salon privé » : créer un salon, le rejoindre avec un code, voir les participants,
 * régler la partie (hôte) et la lancer. Tout passe par le serveur (net.js) : sans serveur joignable, cet écran
 * l'explique clairement au lieu de faire semblant.
 */
(function (GB) {
  'use strict';

  const { net, online } = GB;
  const ui = GB.ui;
  const $ = (id) => document.getElementById(id);

  const el = {
    btnOnline: $('btn-online'),
    btnResume: $('btn-resume-online'),
    title: $('lobby-title'),
    connect: $('lobby-connect'),
    room: $('lobby-room'),
    name: $('lobby-name'),
    code: $('lobby-code'),
    serverBox: $('lobby-server'),
    url: $('lobby-url'),
    msg: $('lobby-msg'),
    btnCreate: $('btn-lobby-create'),
    btnJoin: $('btn-lobby-join'),
    btnBack: $('btn-lobby-back'),
    roomCode: $('lobby-room-code'),
    btnCopy: $('btn-lobby-copy'),
    players: $('lobby-players'),
    modeList: $('lobby-mode-list'),
    count: $('lobby-count'),
    state: $('lobby-state'),
    settings: $('lobby-settings'),
    settingsNote: $('lobby-settings-note'),
    panel: $('lobby-panel'),
    summary: $('lobby-summary'),
    roomMsg: $('lobby-room-msg'),
    btnStart: $('btn-lobby-start'),
    btnLeave: $('btn-lobby-leave'),
    banner: $('online-banner'),
  };

  const NAME_KEY = 'gartic-bande.nickname.v1';
  let busy = false;

  function create(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function range(min, max) {
    return Array.from({ length: max - min + 1 }, (_, index) => min + index);
  }

  function setMessage(text, kind) {
    el.msg.textContent = text || '';
    el.msg.className = 'form-error' + (kind ? ' ' + kind : '');
  }

  function readName() {
    try {
      return window.localStorage.getItem(NAME_KEY) || '';
    } catch (error) {
      return '';
    }
  }

  function saveName(name) {
    try {
      window.localStorage.setItem(NAME_KEY, name);
    } catch (error) {
      /* sans conséquence */
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Connexion                                                          */
  /* ------------------------------------------------------------------ */

  function serverUrl() {
    return el.url.value.trim() || net.defaultUrl();
  }

  async function connectThen(action) {
    if (busy) return;
    const name = el.name.value.replace(/\s+/g, ' ').trim();
    if (!name) {
      setMessage('Choisis un pseudo pour que tes amis te reconnaissent.');
      el.name.focus();
      return;
    }
    const url = serverUrl();
    if (!url) {
      el.serverBox.open = true;
      setMessage('Indique l\'adresse du serveur : ce jeu a été ouvert comme un simple fichier, il ne sait pas où se connecter.');
      el.url.focus();
      return;
    }
    busy = true;
    setButtons();
    setMessage('Connexion au serveur…', 'info');
    try {
      await net.connect(url);
      net.saveUrl(el.url.value.trim());
      saveName(name);
      setMessage('', '');
      action(name);
    } catch (error) {
      el.serverBox.open = true;
      setMessage(error.message, 'error');
    } finally {
      busy = false;
      setButtons();
    }
  }

  function setButtons() {
    el.btnCreate.disabled = busy;
    el.btnJoin.disabled = busy;
  }

  /* ------------------------------------------------------------------ */
  /*  Salle d'attente                                                    */
  /* ------------------------------------------------------------------ */

  function renderSegmented(container, values, current, onPick, disabled, label) {
    container.innerHTML = '';
    values.forEach((value) => {
      const button = create('button', 'segmented-btn', label ? label(value) : String(value));
      button.type = 'button';
      button.disabled = disabled;
      button.classList.toggle('active', value === current);
      button.setAttribute('aria-pressed', String(value === current));
      button.addEventListener('click', () => onPick(value));
      container.append(button);
    });
  }

  /* Modes de jeu : seul BUILD UP existe. Les autres sont annoncés pour que la place soit visible et claire. */
  const GAME_MODES = GB.modes.list(); // registre partagé avec le serveur (js/modes.js)

  const SPEED_PRESETS = GB.phases.PRESETS;
  const PHASE_FIELDS = [
    { key: 'proposeSeconds', stage: 'propose', label: 'Idées de thème' },
    { key: 'voteSeconds', stage: 'vote', label: 'Vote' },
    { key: 'prepSeconds', stage: 'prep', label: 'Préparation' },
    { key: 'roundSeconds', stage: 'compose', label: 'Un round de composition' },
  ];

  let openPanel = null; // réglage dont le panneau est ouvert
  let lastRoom = null;

  function fmt(seconds) {
    return seconds >= 60 && seconds % 60 === 0 ? seconds / 60 + ' min' : seconds + ' s';
  }

  function presetOf(settings) {
    return SPEED_PRESETS.find((preset) => PHASE_FIELDS.every((field) => settings[field.key] === preset.seconds[field.stage])) || null;
  }

  function renderModes(room, isHost) {
    el.modeList.innerHTML = '';
    GAME_MODES.forEach((mode) => {
      const item = create('li', 'mode-item');
      const button = create('button', 'mode-choice');
      button.type = 'button';
      button.dataset.mode = mode.id;
      const selected = mode.id === (room.settings.gameMode || GB.modes.DEFAULT);
      button.classList.toggle('selected', selected && mode.available);
      button.classList.toggle('soon', !mode.available);
      button.setAttribute('aria-pressed', String(selected && mode.available));
      button.setAttribute('aria-disabled', String(!mode.available));
      button.disabled = !mode.available;
      button.title = mode.available ? mode.blurb : 'En préparation : ce mode n\'est pas encore disponible.';
      button.append(GB.icons.el(mode.icon, 'mode-icon'), create('strong', null, mode.label), create('small', null, mode.available ? (selected ? 'Sélectionné' : 'Disponible') : 'En préparation'));
      button.addEventListener('click', () => {
        if (!mode.available || !isHost) return;
        net.configure({ gameMode: mode.id });
      });
      item.append(button);
      el.modeList.append(item);
    });
  }

  function chip(key, icon, label, value) {
    const button = create('button', 'setting-chip');
    button.type = 'button';
    button.dataset.setting = key;
    const open = openPanel === key;
    button.classList.toggle('open', open);
    button.setAttribute('aria-expanded', String(open));
    button.setAttribute('aria-controls', 'lobby-panel');
    button.append(GB.icons.el(icon, 'chip-icon'), create('span', 'chip-text'));
    button.lastChild.append(create('small', null, label), create('strong', null, value));
    button.addEventListener('click', () => {
      openPanel = openPanel === key ? null : key;
      if (lastRoom) renderSettings(lastRoom, lastRoom.hostId === (online.you && online.you.id));
    });
    return button;
  }

  function renderSettings(room, isHost) {
    const s = room.settings;
    const preset = presetOf(s);
    el.settings.innerHTML = '';
    const phoneMode = s.gameMode === 'phone';
    const modeLabel = (GAME_MODES.find((entry) => entry.id === (s.gameMode || GB.modes.DEFAULT)) || GAME_MODES[0]).label;
    el.settings.append(
      phoneMode
        ? chip('phone', 'clock', 'Rounds et durées', (s.phoneRounds > 0 ? s.phoneRounds + ' rounds' : 'Tous les rounds') + ' · ' + fmt(s.roundSeconds))
        : chip('speed', 'clock', 'Vitesse des phases', preset ? preset.label : 'Personnalisée'),
      chip('mode', 'gamepad', 'Mode de jeu', modeLabel),
      chip('bars', 'loop', 'Boucle', s.bars + ' mesures'),
      chip('max', 'users', 'Joueurs max', String(s.max))
    );
    el.settingsNote.textContent = isHost ? '(clique pour modifier)' : '(modifiable par l\'hôte)';
    el.panel.hidden = !openPanel;
    el.panel.innerHTML = '';
    if (!openPanel) return;
    el.panel.dataset.panel = openPanel;
    const close = GB.icons.set(create('button', 'icon-btn panel-close'), 'close');
    close.type = 'button';
    close.setAttribute('aria-label', 'Fermer le panneau');
    close.addEventListener('click', () => {
      openPanel = null;
      renderSettings(room, isHost);
    });
    const note = isHost ? null : create('p', 'panel-note', 'Seul l\'hôte peut changer ces réglages.');
    if (openPanel === 'speed') {
      el.panel.append(create('h4', 'panel-title', 'Vitesse des phases'), close);
      const presets = create('div', 'segmented');
      presets.id = 'speed-presets';
      SPEED_PRESETS.forEach((entry) => {
        const button = create('button', 'segmented-btn', entry.label);
        button.type = 'button';
        button.dataset.preset = entry.id;
        button.disabled = !isHost;
        button.classList.toggle('active', preset && preset.id === entry.id);
        button.setAttribute('aria-pressed', String(Boolean(preset && preset.id === entry.id)));
        button.addEventListener('click', () => net.configure(PHASE_FIELDS.reduce((patch, field) => Object.assign(patch, { [field.key]: entry.seconds[field.stage] }), {})));
        presets.append(button);
      });
      const custom = create('div', 'speed-custom');
      PHASE_FIELDS.forEach((field) => {
        const [min, max] = GB.phases.SECONDS_LIMITS[field.stage];
        const label = create('label', 'speed-field');
        label.append(create('span', null, field.label));
        const input = create('input', 'text-input');
        input.type = 'number';
        input.inputMode = 'numeric';
        input.min = String(min);
        input.max = String(max);
        input.step = '5';
        input.value = String(s[field.key]);
        input.disabled = !isHost;
        input.dataset.key = field.key;
        input.setAttribute('aria-label', field.label + ' en secondes (de ' + min + ' à ' + max + ')');
        input.addEventListener('change', () => {
          const value = Math.round(Number(input.value));
          if (Number.isFinite(value)) net.configure({ [field.key]: Math.min(max, Math.max(min, value)) });
        });
        label.append(input, create('small', null, 's (' + min + '–' + max + ')'));
        custom.append(label);
      });
      el.panel.append(presets, create('p', 'panel-hint', 'Les durées sont des MAXIMUMS : dès que tout le monde a terminé, on passe à la suite.'), custom);
    } else if (openPanel === 'phone') {
      const present = room.players.filter((player) => player.connected).length;
      el.panel.append(create('h4', 'panel-title', 'Phone : rounds et durées'), close);
      const rounds = create('div', 'segmented');
      rounds.id = 'setting-phone-rounds';
      const maxRounds = Math.max(3, Math.min(8, present));
      const roundValues = [0].concat(range(3, maxRounds));
      el.panel.append(create('p', 'panel-hint', 'Nombre de rounds (le dernier est toujours la devinette). « Tous » = autant que de joueurs.'), rounds);
      renderSegmented(rounds, roundValues, s.phoneRounds, (value) => net.configure({ phoneRounds: value }), !isHost, (value) => (value === 0 ? 'Tous' : String(value)));
      const compose = create('div', 'segmented');
      compose.id = 'setting-phone-compose';
      el.panel.append(create('p', 'panel-hint', 'Durée pour composer ou recopier (5 min conseillées).'), compose);
      renderSegmented(compose, [120, 180, 300, 420, 600], s.roundSeconds, (value) => net.configure({ roundSeconds: value }), !isHost, fmt);
      const sing = create('div', 'segmented');
      sing.id = 'setting-phone-sing';
      el.panel.append(create('p', 'panel-hint', 'Durée pour chanter.'), sing);
      renderSegmented(sing, [60, 90, 120, 180, 300], s.singSeconds, (value) => net.configure({ singSeconds: value }), !isHost, fmt);
      el.panel.append(create('p', 'panel-hint', 'Les durées sont des MAXIMUMS : dès que tout le monde a terminé, on passe à la suite.'));
    } else if (openPanel === 'mode') {
      const chosen = GAME_MODES.find((entry) => entry.id === (s.gameMode || GB.modes.DEFAULT)) || GAME_MODES[0];
      el.panel.append(create('h4', 'panel-title', 'Mode de jeu : ' + chosen.label), close, create('p', 'panel-hint', chosen.blurb), create('p', 'panel-hint', 'D\'autres modes arrivent : ils sont visibles dans la colonne de gauche, marqués « En préparation ».'));
    } else if (openPanel === 'bars') {
      const group = create('div', 'segmented');
      group.id = 'setting-bars';
      el.panel.append(create('h4', 'panel-title', 'Longueur de la boucle'), close, group);
      renderSegmented(group, range(2, 4), s.bars, (value) => net.configure({ bars: value }), !isHost, (value) => value + ' mesures');
    } else if (openPanel === 'max') {
      const group = create('div', 'segmented');
      group.id = 'setting-max';
      el.panel.append(create('h4', 'panel-title', 'Joueurs maximum'), close, group);
      renderSegmented(group, range(2, 8), s.max, (value) => net.configure({ max: value }), !isHost);
    }
    if (note) el.panel.append(note);
  }

  function renderRoom(room) {
    lastRoom = room;
    const youId = online.you && online.you.id;
    const isHost = room.hostId === youId;
    el.connect.hidden = true;
    el.room.hidden = false;
    el.title.textContent = 'Salon de ' + (room.players.find((player) => player.host) || { name: 'ton ami' }).name;
    el.roomCode.textContent = room.code;

    const present = room.players.filter((player) => player.connected).length;
    el.count.textContent = '(' + present + '/' + room.settings.max + ')';
    el.players.innerHTML = '';
    room.players.forEach((player) => {
      const chipNode = create('div', 'roster-chip lobby-player');
      chipNode.style.setProperty('--c', player.color);
      chipNode.classList.toggle('is-human', player.id === youId);
      chipNode.classList.toggle('absent', !player.connected);
      chipNode.dataset.playerId = player.id;
      chipNode.append(
        GB.avatar.node(player, 'sb-lobby'),
        create('span', 'lobby-player-name', player.name + (player.id === youId ? ' (toi)' : '')),
        create('small', 'roster-tag', (player.host ? 'hôte' : '') + (player.host && !player.connected ? ' · ' : '') + (player.connected ? '' : 'absent')),
        create('span', 'presence', player.connected ? '● en ligne' : '○ absent')
      );
      el.players.append(chipNode);
    });

    renderModes(room, isHost);
    renderSettings(room, isHost);

    const s = room.settings;
    const needed = (GB.modes.list().find((entry) => entry.id === (s.gameMode || GB.modes.DEFAULT)) || { players: [2, 8] }).players[0];
    el.state.textContent = isHost
      ? present >= needed ? 'Tu es l\'hôte : lance la partie quand tout le monde est là.' : 'Tu es l\'hôte : il faut au moins ' + needed + ' joueurs pour lancer.'
      : 'En attente de l\'hôte (' + ((room.players.find((player) => player.host) || {}).name || '?') + ') pour lancer la partie.';
    const phoneRoundCount = GB.phone ? GB.phone.roundCount(present, s.phoneRounds) : present;
    if (s.gameMode === 'phone') el.summary.textContent = present + ' joueur' + (present > 1 ? 's' : '') + ' : ' + present + ' chaînes et ' + phoneRoundCount + ' rounds (écrire, composer, chanter, recopier… puis deviner) · boucle de ' + s.bars + ' mesures · composer ' + fmt(s.roundSeconds) + ', chanter ' + fmt(s.singSeconds) + ' (maximums)';
    else el.summary.textContent =
      present + ' joueur' + (present > 1 ? 's' : '') + ' présent' + (present > 1 ? 's' : '') + (present >= 2 ? ' : ' + present + ' chansons et ' + present + ' rounds de composition' : '') +
      ' · boucle de ' + s.bars + ' mesures · idées ' + fmt(s.proposeSeconds) + ', vote ' + fmt(s.voteSeconds) + ', préparation ' + fmt(s.prepSeconds) + ', round ' + fmt(s.roundSeconds) + ' (maximums)';
    el.btnStart.hidden = !isHost;
    el.btnStart.disabled = present < needed;
    el.btnStart.textContent = 'Lancer la partie (' + present + ' joueur' + (present > 1 ? 's' : '') + ')';
    el.roomMsg.textContent = isHost ? '' : 'Partage le code avec tes amis en attendant !';
    el.roomMsg.className = isHost ? 'form-error' : 'form-error info';
  }

  function showLobbyScreen() {
    ui.showScreen('lobby');
    const hasRoom = online.isInRoom() && online.room.status === 'lobby';
    el.connect.hidden = hasRoom;
    el.room.hidden = !hasRoom;
    if (hasRoom) renderRoom(online.room);
    else el.title.textContent = 'Joue avec tes amis';
  }

  /* ------------------------------------------------------------------ */
  /*  Bandeau de connexion                                               */
  /* ------------------------------------------------------------------ */

  function renderBanner(status) {
    const inRoom = online.isInRoom() || Boolean(net.session);
    let text = '';
    if (inRoom && status === 'reconnecting') text = 'Connexion perdue : reconnexion en cours… ta place est gardée.';
    else if (inRoom && status === 'offline' && net.session) text = 'Connexion perdue. Recharge la page pour reprendre ta place dans le salon.';
    el.banner.textContent = text;
    el.banner.hidden = !text;
  }

  /* ------------------------------------------------------------------ */
  /*  Branchement                                                        */
  /* ------------------------------------------------------------------ */

  function bind() {
    el.url.value = net.getSavedUrl();
    el.url.placeholder = net.defaultUrl() || 'wss://mon-serveur.example.com/ws';
    el.name.value = readName();
    el.serverBox.open = !net.defaultUrl() && !el.url.value;

    el.btnOnline.addEventListener('click', () => {
      GB.audio.unlock();
      setMessage('', '');
      showLobbyScreen();
    });
    el.btnBack.addEventListener('click', () => ui.showScreen('home'));
    el.code.addEventListener('input', () => {
      el.code.value = el.code.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
      setMessage('', '');
    });
    el.btnCreate.addEventListener('click', () => connectThen((name) => net.create(name, 4)));
    el.btnJoin.addEventListener('click', () => {
      if (el.code.value.trim().length < 5) {
        setMessage('Le code du salon fait 5 caractères (lettres et chiffres).');
        el.code.focus();
        return;
      }
      connectThen((name) => net.join(el.code.value, name));
    });
    el.code.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') el.btnJoin.click();
    });
    el.name.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') (el.code.value ? el.btnJoin : el.btnCreate).click();
    });

    el.btnCopy.addEventListener('click', async () => {
      const code = el.roomCode.textContent;
      try {
        await navigator.clipboard.writeText(code);
        ui.showToast('Code copié : ' + code);
      } catch (error) {
        ui.showToast('Copie impossible : note le code ' + code);
      }
    });
    el.btnStart.addEventListener('click', () => net.start());
    el.btnLeave.addEventListener('click', () => {
      online.leave();
      ui.showScreen('home');
    });

    online.on('room', (room) => {
      if (room.status === 'lobby') {
        if (!document.getElementById('screen-lobby').hidden || online.isInRoom()) {
          ui.showScreen('lobby');
          renderRoom(room);
        }
      }
      renderBanner(net.status);
    });
    online.on('error', (message) => {
      if (!document.getElementById('screen-lobby').hidden) {
        if (el.room.hidden) setMessage(message.message, 'error');
        else {
          el.roomMsg.textContent = message.message;
          el.roomMsg.className = 'form-error';
        }
      }
    });
    online.on('left', () => {
      el.connect.hidden = false;
      el.room.hidden = true;
      renderBanner(net.status);
    });
    online.on('status', (status) => {
      renderBanner(status);
      if (status === 'online' && net.session && online.isInRoom()) renderBanner('online');
    });
    net.on('gave-up', () => renderBanner('offline'));

    // Reprendre un salon après un rechargement de la page.
    const saved = net.getSavedSession();
    el.btnResume.hidden = !saved;
    if (saved) {
      GB.icons.set(el.btnResume, 'back', 'Reprendre le salon ' + saved.code);
      el.btnResume.addEventListener('click', async () => {
        el.btnResume.disabled = true;
        try {
          GB.audio.unlock();
          await net.resume(saved);
          showLobbyScreen();
        } catch (error) {
          net.forget();
          el.btnResume.hidden = true;
          ui.showToast(error.message);
        } finally {
          el.btnResume.disabled = false;
        }
      });
    }
  }

  GB.lobbyUI = { showLobbyScreen };
  bind();
})((window.GB = window.GB || {}));

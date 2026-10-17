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
    max: $('lobby-max'),
    bars: $('lobby-bars'),
    seconds: $('lobby-seconds'),
    bpm: $('lobby-bpm'),
    bpmValue: $('lobby-bpm-value'),
    settings: $('lobby-settings'),
    summary: $('lobby-summary'),
    roomMsg: $('lobby-room-msg'),
    btnStart: $('btn-lobby-start'),
    btnLeave: $('btn-lobby-leave'),
    banner: $('online-banner'),
  };

  // Panneau des thèmes : les ordres partent au serveur, qui est l'autorité ; la vue vient de la dernière « room » reçue.
  let themesPanel = null;
  let roomReceivedAt = 0;
  const themeController = {
    view: () => (online.room ? online.room.themes : null),
    remainingMs: () => (online.room && online.room.themes ? Math.max(0, online.room.themes.vote.remainingMs - (performance.now() - roomReceivedAt)) : 0),
    actorId: () => (online.you ? online.you.id : null),
    hostId: () => (online.room ? online.room.hostId : null),
    players: () => (online.room ? online.room.players : []),
    act: (command, arg) => {
      if (!net.themeCommand(command, arg)) return { ok: false, error: 'Connexion perdue : réessaie dans un instant.' };
      return undefined;
    },
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

  function renderRoom(room) {
    const youId = online.you && online.you.id;
    const isHost = room.hostId === youId;
    el.connect.hidden = true;
    el.room.hidden = false;
    el.title.textContent = 'Salon de ' + (room.players.find((player) => player.host) || { name: 'ton ami' }).name;
    el.roomCode.textContent = room.code;

    el.players.innerHTML = '';
    room.players.forEach((player) => {
      const chip = create('div', 'roster-chip');
      chip.style.setProperty('--c', player.color);
      chip.classList.toggle('is-human', player.id === youId);
      chip.classList.toggle('absent', !player.connected);
      chip.append(
        create('span', 'roster-avatar', player.avatar),
        create('span', null, player.name + (player.id === youId ? ' (toi)' : '')),
        create('small', 'roster-tag', player.host ? '👑 hôte' : player.connected ? '' : 'absent')
      );
      el.players.append(chip);
    });

    el.max.parentElement.hidden = !isHost;
    el.bars.parentElement.hidden = !isHost;
    el.seconds.parentElement.hidden = !isHost;
    renderSegmented(
      el.seconds,
      GB.rounds.DURATIONS,
      room.settings.roundSeconds,
      (value) => net.configure({ roundSeconds: value }),
      !isHost,
      (value) => (value >= 60 && value % 60 === 0 ? value / 60 + ' min' : value + ' s')
    );
    el.bpm.parentElement.parentElement.hidden = !isHost;
    renderSegmented(el.max, range(2, 8), room.settings.max, (value) => net.configure({ max: value }), !isHost);
    renderSegmented(el.bars, range(2, 4), room.settings.bars, (value) => net.configure({ bars: value }), !isHost);
    el.bpm.min = 60;
    el.bpm.max = 180;
    el.bpm.value = room.settings.bpm;
    el.bpm.disabled = !isHost;
    el.bpmValue.textContent = room.settings.bpm;

    const present = room.players.filter((player) => player.connected).length;
    el.summary.textContent =
      present + ' joueur' + (present > 1 ? 's' : '') + ' présent' + (present > 1 ? 's' : '') + ' (capacité ' + room.settings.max + ') · ' +
      room.settings.bars + ' mesures · ' + room.settings.bpm + ' BPM · rounds de ' + room.settings.roundSeconds + ' s' +
      (present >= 2 ? ' → ' + present + ' chansons, ' + present + ' rounds' : ' · il faut au moins 2 joueurs');
    if (!themesPanel) themesPanel = GB.themesUI.mount($('lobby-themes'), themeController);
    else themesPanel.render();
    const voting = room.themes && room.themes.vote.status === 'open';
    el.btnStart.hidden = !isHost;
    el.btnStart.disabled = present < 2 || voting;
    el.btnStart.title = voting ? 'Clôture le vote avant de lancer la partie' : '';
    el.btnStart.textContent = 'Lancer la partie (' + present + ' joueur' + (present > 1 ? 's' : '') + ')';
    el.roomMsg.textContent = isHost ? '' : 'En attendant que l\'hôte lance la partie… partage le code avec tes amis !';
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
    if (inRoom && status === 'reconnecting') text = '📡 Connexion perdue : reconnexion en cours… ta place est gardée.';
    else if (inRoom && status === 'offline' && net.session) text = '📡 Connexion perdue. Recharge la page pour reprendre ta place dans le salon.';
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
    el.bpm.addEventListener('input', () => {
      el.bpmValue.textContent = el.bpm.value;
    });
    el.bpm.addEventListener('change', () => net.configure({ bpm: Number(el.bpm.value) }));
    el.btnStart.addEventListener('click', () => net.start());
    el.btnLeave.addEventListener('click', () => {
      online.leave();
      ui.showScreen('home');
    });

    online.on('room', (room) => {
      roomReceivedAt = performance.now();
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
      el.btnResume.textContent = '↩ Reprendre le salon ' + saved.code;
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

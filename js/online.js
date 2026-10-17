/**
 * GARTIC BANDE — partie en ligne : relie les messages du serveur (net.js) à la partie (game.js).
 *
 * Le serveur décide ; ce module ne fait que transmettre :
 *   welcome / room     → vue du salon (salle d'attente) ou état du round en cours (chrono, qui est prêt…)
 *   started / sync     → démarrage de la partie, ou reprise après une reconnexion
 *   contribution       → une contribution enregistrée par le serveur (la mienne, celle d'un autre, ou une contribution vide)
 *   error              → refus du serveur (ma contribution, une commande…)
 */
(function (GB) {
  'use strict';

  const { net, game } = GB;
  const ui = GB.ui;
  const listeners = { room: [], error: [], left: [], status: [] };

  const online = {
    room: null, // dernière vue du salon
    you: null, // { id, name }

    /** Salon ou partie en ligne en cours ? */
    isInRoom() {
      return Boolean(online.room && online.you);
    },

    on(type, listener) {
      listeners[type].push(listener);
    },

    /** Quitte le salon : en jeu ou en salle d'attente, puis ferme la connexion. */
    leave() {
      if (net.status === 'online') net.leave();
      else net.forget();
      net.close();
      online.room = null;
      online.you = null;
      if (game.state.active && game.online.isActive()) game.quit();
      listeners.left.forEach((listener) => listener());
    },
  };

  function emit(type, payload) {
    listeners[type].forEach((listener) => listener(payload));
  }

  function submit(round, contribution) {
    // Son importé : le fichier part d'abord au serveur (HTTP, par empreinte) ; la contribution ne contient que l'empreinte.
    const hash = contribution && contribution.settings && contribution.settings.sample ? contribution.settings.sample.hash : null;
    if (hash) {
      if (!net.session) {
        ui.showToast('Connexion perdue : ta contribution n\'est pas partie. Réessaie dans un instant.');
        return false;
      }
      net.uploadSound(hash).then((result) => {
        if (result.ok && net.submit(round, contribution)) return;
        ui.showToast(result.ok ? 'Connexion perdue : ta contribution n\'est pas partie. Réessaie dans un instant.' : 'Ton son n\'a pas pu être envoyé : ' + result.error);
        if (game.state.active && game.online.isActive()) game.online.sendFailed();
      });
      return true;
    }
    const sent = net.submit(round, contribution);
    if (!sent) ui.showToast('Connexion perdue : ta contribution n\'est pas partie. Réessaie dans un instant.');
    return sent;
  }

  /** Démarre l'écran de jeu en ligne puis reconstruit la partie depuis les données du serveur. */
  function enterGame(room, contributions) {
    if (GB.gameUI) GB.gameUI.enterOnline();
    game.online.start(room, online.you.id, contributions, submit, {
      send: (command, index) => net.revealCommand(command, index),
      sync: () => net.revealSync(),
    });
  }

  function init() {
    net.on('welcome', (message) => {
      online.you = { id: message.you.id, name: message.you.name };
      online.room = message.room;
      emit('room', message.room);
    });

    net.on('sync', (message) => {
      if (!online.you) return;
      online.room = message.room;
      if (game.state.active && game.online.isActive()) {
        // Reconnexion en cours de partie : on garde ce qu'on est en train de faire et on rattrape ce qui a été manqué.
        message.contributions.forEach((entry) => game.online.applyContribution(entry));
        game.online.applyRoom(message.room);
      } else {
        enterGame(message.room, message.contributions);
      }
      emit('room', message.room);
    });

    net.on('started', (message) => {
      online.room = message.room;
      enterGame(message.room, []);
      emit('room', message.room);
    });

    net.on('room', (message) => {
      online.room = message.room;
      if (game.state.active && game.online.isActive()) game.online.applyRoom(message.room);
      emit('room', message.room);
    });

    net.on('contribution', (message) => {
      if (game.state.active && game.online.isActive()) game.online.applyContribution(message.contribution);
    });

    net.on('error', (message) => {
      if (game.state.active && game.online.isActive()) {
        if (game.online.sendFailed()) ui.showToast(message.message);
        else ui.showToast(message.message);
      }
      emit('error', message);
    });

    net.on('left', () => {
      online.room = null;
      online.you = null;
    });

    net.on('status', (message) => emit('status', message.status));
  }

  GB.sounds.setRemoteFetcher((hash) => net.fetchSound(hash)); // les sons des autres joueurs viennent du serveur du salon
  GB.online = online;
  init();
})((window.GB = window.GB || {}));

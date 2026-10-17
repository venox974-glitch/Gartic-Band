/**
 * GARTIC BANDE — panneau « Thème de la partie » : propositions, vote, résultat.
 *
 * Le même panneau sert au salon en ligne (les ordres partent au serveur, qui décide) et au mode test local
 * (les ordres sont appliqués par js/themes.js dans la page). Il ne connaît que ce « contrôleur » :
 *   view()        vue des thèmes (voir GB.themes.view)
 *   remainingMs() temps de vote restant (ms)
 *   actorId()     l'identifiant du joueur au nom duquel on agit
 *   hostId()      l'identifiant de l'hôte
 *   players()     [{ id, name, avatar }]
 *   act(cmd, arg) 'propose' {text} · 'remove' {id} · 'vote-open' {seconds} · 'vote' {id} · 'vote-close' · 'pick' {id} · 'default'
 *   actors()      (optionnel, mode test) joueurs qu'on peut « incarner » + setActor(id)
 *   extra(box)    (optionnel) ajoute des boutons de test (ex. « faire proposer les robots »)
 * Tout le texte venant des joueurs est affiché avec textContent : aucun HTML n'est interprété.
 */
(function (GB) {
  'use strict';

  const { themes: Themes } = GB;

  function create(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function formatTime(ms) {
    const total = Math.max(0, Math.ceil(ms / 1000));
    return Math.floor(total / 60) + ':' + String(total % 60).padStart(2, '0');
  }

  const panels = new Set();
  let voteSeconds = Themes.LIMITS.voteDefault; // durée choisie par l'hôte pour le prochain vote

  function mount(root, controller) {
    const panel = { root, controller, draft: '', message: '', timerEl: null, fillEl: null };
    panels.add(panel);
    render(panel);
    return { render: () => render(panel), destroy: () => panels.delete(panel) };
  }

  function say(panel, text) {
    panel.message = text || '';
    const node = panel.root.querySelector('.themes-msg');
    if (node) node.textContent = panel.message;
  }

  function run(panel, command, arg) {
    const result = panel.controller.act(command, arg);
    if (result && result.ok === false) say(panel, result.error || 'Action refusée.');
    else say(panel, '');
    if (result && result.ok !== undefined) render(panel); // mode local : réponse immédiate ; en ligne, la vue arrive du serveur
    return result;
  }

  function render(panel) {
    const { root, controller } = panel;
    const view = controller.view();
    if (!view) {
      root.innerHTML = '';
      return;
    }
    const me = controller.actorId();
    const host = me === controller.hostId();
    const players = controller.players();
    const nameOf = (id) => {
      const found = players.find((player) => player.id === id);
      return found ? found.avatar + ' ' + found.name : '?';
    };
    const draftInput = root.querySelector('.themes-input');
    const hadFocus = Boolean(draftInput) && document.activeElement === draftInput;
    const caret = draftInput ? draftInput.selectionStart : 0;
    if (draftInput) panel.draft = draftInput.value;
    root.innerHTML = '';

    root.append(create('h3', 'themes-title', '🎯 Thème de la partie'));

    // Sélecteur de joueur (mode test local seulement)
    if (controller.actors) {
      const bar = create('div', 'themes-actors');
      bar.append(create('span', 'themes-actors-label', 'Tu joues en tant que :'));
      controller.actors().forEach((actor) => {
        const button = create('button', 'segmented-btn', actor.avatar + ' ' + actor.name + (actor.id === controller.hostId() ? ' 👑' : ''));
        button.type = 'button';
        button.classList.toggle('active', actor.id === me);
        button.addEventListener('click', () => {
          controller.setActor(actor.id);
          render(panel);
        });
        bar.append(button);
      });
      root.append(bar);
    }

    // Thème retenu
    if (view.theme) {
      const card = create('div', 'theme-winner');
      card.dataset.source = view.theme.source;
      card.append(create('div', 'theme-winner-label', view.theme.source === 'default' ? 'Thème par défaut' : '🏆 Thème de la partie'));
      card.append(create('div', 'theme-winner-text', view.theme.text));
      card.append(
        create(
          'div',
          'theme-winner-meta',
          Themes.sourceLabel(view.theme) + (view.theme.authorName ? ' · proposé par ' + view.theme.authorName : '')
        )
      );
      root.append(card);
      if (host && view.vote.status !== 'idle') root.append(create('p', 'themes-hint', 'Le thème reste affiché pendant tous les rounds et la révélation.'));
    }

    const status = view.vote.status;
    const chosen = Boolean(view.theme);

    // Formulaire de proposition
    if (!chosen && status === 'idle') {
      const mine = view.themes.filter((theme) => theme.authorId === me).length;
      const form = create('form', 'themes-form');
      const input = create('input', 'text-input themes-input');
      input.type = 'text';
      input.maxLength = view.limits.textMax;
      input.placeholder = 'Ex. Une musique de boss final';
      input.setAttribute('aria-label', 'Proposer un thème musical');
      input.value = panel.draft;
      const counter = create('small', 'themes-count', input.value.length + '/' + view.limits.textMax);
      input.addEventListener('input', () => {
        counter.textContent = input.value.length + '/' + view.limits.textMax;
      });
      const button = create('button', 'btn btn-primary', 'Proposer');
      button.type = 'submit';
      button.disabled = mine >= view.limits.perPlayer;
      form.append(input, button, counter);
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        const result = run(panel, 'propose', { text: input.value });
        if (!result || result.ok !== false) {
          panel.draft = '';
          input.value = '';
        }
      });
      root.append(form);
      root.append(create('p', 'themes-hint', 'Tu as fait ' + mine + '/' + view.limits.perPlayer + ' propositions. Tout le monde voit la liste.'));
    }

    // Liste des propositions
    const list = create('ul', 'themes-list');
    list.setAttribute('aria-label', 'Propositions de thèmes');
    if (view.themes.length === 0) list.append(create('li', 'themes-empty', 'Aucune proposition pour l\'instant : lance-toi !'));
    const maxVotes = Math.max(0, ...view.themes.map((theme) => theme.votes));
    view.themes.forEach((theme) => {
      const item = create('li', 'theme-item');
      item.dataset.themeId = theme.id;
      const isWinner = chosen && view.theme.themeId === theme.id;
      item.classList.toggle('winner', isWinner);
      item.classList.toggle('mine-vote', view.vote.votes[me] === theme.id);
      const text = create('div', 'theme-text');
      text.append(create('strong', null, theme.text), create('small', null, 'proposé par ' + nameOf(theme.authorId)));
      item.append(text);

      if (status !== 'idle') {
        const count = create('span', 'theme-votes', theme.votes + (theme.votes > 1 ? ' votes' : ' vote'));
        count.classList.toggle('lead', status === 'closed' && theme.votes === maxVotes && maxVotes > 0);
        item.append(count);
      }
      if (status === 'open') {
        const button = create('button', 'btn btn-small', view.vote.votes[me] === theme.id ? '✅ Ton vote' : 'Voter');
        button.type = 'button';
        button.classList.toggle('btn-primary', view.vote.votes[me] === theme.id);
        button.addEventListener('click', () => run(panel, 'vote', { id: theme.id }));
        item.append(button);
      }
      if (status === 'closed' && !chosen && host && view.result && view.result.tied.includes(theme.id)) {
        const button = create('button', 'btn btn-primary btn-small', 'Choisir celui-ci');
        button.type = 'button';
        button.addEventListener('click', () => run(panel, 'pick', { id: theme.id }));
        item.append(button);
      }
      if (status === 'idle' && !chosen) {
        if (host) {
          const pickButton = create('button', 'btn btn-small', 'Choisir sans vote');
          pickButton.type = 'button';
          pickButton.title = 'Retenir directement ce thème, sans vote';
          pickButton.addEventListener('click', () => run(panel, 'pick', { id: theme.id }));
          item.append(pickButton);
        }
        if (host || theme.authorId === me) {
          const remove = create('button', 'icon-btn danger', '🗑');
          remove.type = 'button';
          remove.title = host && theme.authorId !== me ? 'Supprimer cette proposition (hôte)' : 'Retirer ma proposition';
          remove.setAttribute('aria-label', remove.title);
          remove.addEventListener('click', () => run(panel, 'remove', { id: theme.id }));
          item.append(remove);
        }
      }
      list.append(item);
    });
    root.append(list);

    // Vote : minuteur + commandes de l'hôte
    if (status === 'open') {
      const box = create('div', 'themes-vote');
      const head = create('div', 'themes-vote-head');
      panel.timerEl = create('strong', 'themes-timer', formatTime(controller.remainingMs()));
      head.append(create('span', null, '🗳 Vote ouvert · un seul vote par joueur, modifiable jusqu\'à la fin · '), panel.timerEl);
      const bar = create('div', 'themes-bar');
      panel.fillEl = create('div', 'themes-bar-fill');
      bar.append(panel.fillEl);
      box.append(head, bar);
      const voted = Object.keys(view.vote.votes).length;
      box.append(create('small', 'themes-hint', voted + '/' + players.length + ' joueurs ont voté'));
      if (host) {
        const close = create('button', 'btn btn-primary', 'Clôturer le vote');
        close.type = 'button';
        close.addEventListener('click', () => run(panel, 'vote-close'));
        box.append(close);
      }
      root.append(box);
    } else {
      panel.timerEl = null;
      panel.fillEl = null;
    }

    if (status === 'closed' && !chosen && view.result) {
      const box = create('div', 'themes-result');
      if (view.result.reason === 'tie') {
        box.append(create('strong', null, '⚖️ Égalité !'));
        box.append(create('span', null, host ? ' Choisis le thème parmi ceux à égalité.' : ' L\'hôte choisit parmi les thèmes à égalité…'));
      } else {
        box.append(create('strong', null, 'Personne n\'a voté.'));
        box.append(create('span', null, host ? ' Choisis une proposition ou prends le thème par défaut.' : ' L\'hôte choisit un thème ou prend le thème par défaut…'));
      }
      if (host && view.result.reason === 'no-votes') {
        const button = create('button', 'btn btn-small', 'Thème par défaut');
        button.type = 'button';
        button.addEventListener('click', () => run(panel, 'default'));
        box.append(button);
      }
      root.append(box);
    }

    // Commandes de l'hôte avant le vote
    if (status === 'idle' && !chosen) {
      if (host) {
        const controls = create('div', 'themes-host');
        controls.append(create('span', 'themes-actors-label', 'Durée du vote :'));
        const group = create('div', 'segmented');
        Themes.LIMITS.voteSeconds.forEach((seconds) => {
          const button = create('button', 'segmented-btn', seconds < 60 ? seconds + ' s' : seconds / 60 + ' min');
          button.type = 'button';
          button.classList.toggle('active', seconds === voteSeconds);
          button.addEventListener('click', () => {
            voteSeconds = seconds;
            render(panel);
          });
          group.append(button);
        });
        controls.append(group);
        const start = create('button', 'btn btn-violet', '🗳 Lancer le vote');
        start.type = 'button';
        start.disabled = view.themes.length === 0;
        start.title = view.themes.length === 0 ? 'Il faut au moins une proposition' : '';
        start.addEventListener('click', () => run(panel, 'vote-open', { seconds: voteSeconds }));
        const fallback = create('button', 'btn btn-ghost btn-small', 'Utiliser le thème par défaut');
        fallback.type = 'button';
        fallback.addEventListener('click', () => run(panel, 'default'));
        controls.append(start, fallback);
        root.append(controls);
      } else {
        root.append(create('p', 'themes-hint', 'L\'hôte lancera le vote quand il y aura assez de propositions.'));
      }
    }

    if (controller.extra) {
      const box = create('div', 'themes-extra');
      controller.extra(box, () => render(panel));
      if (box.childNodes.length) root.append(box);
    }
    root.append(create('p', 'themes-msg form-error', panel.message));
    const fresh = root.querySelector('.themes-input');
    if (hadFocus && fresh) {
      fresh.focus(); // une mise à jour venue d'un autre joueur ne doit pas faire perdre la saisie
      try {
        fresh.setSelectionRange(caret, caret);
      } catch (error) {
        /* sans conséquence */
      }
    }
  }

  // Le décompte du vote est rafraîchi sans tout redessiner.
  setInterval(() => {
    panels.forEach((panel) => {
      if (!panel.timerEl || !panel.root.isConnected) return;
      const view = panel.controller.view();
      if (!view || view.vote.status !== 'open') return;
      const remaining = panel.controller.remainingMs();
      panel.timerEl.textContent = formatTime(remaining);
      if (panel.fillEl && view.vote.durationMs) panel.fillEl.style.transform = 'scaleX(' + Math.max(0, Math.min(1, remaining / view.vote.durationMs)) + ')';
      if (remaining <= 0 && panel.controller.tick) panel.controller.tick();
    });
  }, 250);

  GB.themesUI = { mount, formatTime };
})((window.GB = window.GB || {}));

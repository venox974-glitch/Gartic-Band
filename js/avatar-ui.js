/**
 * GARTIC BANDE — page « Skin » : choix de la couleur et du chapeau (l'apparence seulement ; les sons sont dans le Casier, js/locker-ui.js) (enregistré tout de suite, dans ce navigateur).
 */
(function (GB) {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const el = {
    open: $('btn-custom'),
    back: $('btn-custom-back'),
    preview: $('avatar-preview'),
    colors: $('avatar-colors'),
    hats: $('avatar-hats'),
    summary: $('avatar-summary'),
  };
  if (!el.open || !el.preview) return;

  function create(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  /** Le personnage de l'accueil (« Ton perso ») : couleur + chapeau du joueur, immobile. */
  function renderHome() {
    const holder = $('home-perso-figure');
    if (holder) holder.innerHTML = GB.avatar.markup(GB.avatar.get(), 'home-perso-key');
  }

  function render() {
    const avatar = GB.avatar.get();
    renderHome();
    el.preview.innerHTML = GB.avatar.markup(avatar, 'key-preview');
    const color = GB.avatar.COLORS.find((entry) => entry.id === avatar.color);
    const hat = GB.avatar.HATS.find((entry) => entry.id === avatar.hat);
    el.summary.textContent = 'Ton personnage : ' + color.label.toLowerCase() + ', ' + (avatar.hat === 'none' ? 'sans chapeau' : hat.label.toLowerCase()) + '.';

    el.colors.textContent = '';
    GB.avatar.COLORS.forEach((entry) => {
      const button = create('button', 'swatch');
      button.type = 'button';
      button.setAttribute('role', 'radio');
      button.setAttribute('aria-checked', String(entry.id === avatar.color));
      button.setAttribute('aria-label', entry.label);
      button.title = entry.label;
      button.style.setProperty('--sw', entry.value);
      button.append(create('span', 'swatch-name', entry.label));
      button.addEventListener('click', () => {
        GB.avatar.set({ color: entry.id });
        render();
      });
      el.colors.append(button);
    });

    el.hats.textContent = '';
    GB.avatar.HATS.forEach((entry) => {
      const button = create('button', 'hat-choice');
      button.type = 'button';
      button.setAttribute('role', 'radio');
      button.setAttribute('aria-checked', String(entry.id === avatar.hat));
      const picture = create('span', 'hat-picture');
      picture.innerHTML = entry.id === 'none' ? '<span class="hat-none" aria-hidden="true">∅</span>' : GB.avatar.markup({ color: avatar.color, hat: entry.id }, 'key-mini');
      button.append(picture, create('span', 'hat-name', entry.label));
      button.addEventListener('click', () => {
        GB.avatar.set({ hat: entry.id });
        render();
      });
      el.hats.append(button);
    });
  }

  el.open.addEventListener('click', () => {
    render();
    GB.ui.showScreen('custom');
  });
  el.back.addEventListener('click', () => GB.ui.showScreen('home'));

  renderHome();

  GB.avatarUI = { render };
})((window.GB = window.GB || {}));

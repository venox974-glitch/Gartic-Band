/**
 * GARTIC BANDE — jeu d'icônes (SVG en ligne, trait uniforme, couleur = celle du texte).
 * Remplace tous les émojis : même style partout, rendu identique sur tous les appareils.
 *
 *   GB.icons.svg('play')            -> texte HTML <svg…> (à mettre dans innerHTML)
 *   GB.icons.el('play', 'ins-icon') -> <span class="ic …"> contenant l'icône
 *   GB.icons.set(bouton, 'play', 'Lecture') -> met « icône + texte » dans un élément (efface le contenu précédent)
 *   <i class="ic" data-i="play"></i>  dans index.html : rempli automatiquement au chargement.
 * Un nom inconnu (ex. ancien émoji reçu d'ailleurs) donne l'icône « note » : jamais d'erreur.
 */
(function (GB) {
  'use strict';

  const P = {
    note: '<path d="M9 18V5l11-2v13"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>',
    piano: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M8 5v14M12 5v14M16 5v14"/>',
    moon: '<path d="M20 14.5A8 8 0 1 1 9.500 4a6.500 6.500 0 0 0 10.500 10.500z"/>',
    guitar: '<circle cx="8.500" cy="15.500" r="4.500"/><path d="M12 12l8-8M18 3l3 3"/>',
    alien: '<path d="M5 9h14v7H5zM8 5l2 4M16 5l-2 4M8 16v3M16 16v3"/><circle cx="9.500" cy="12.500" r="0.9" fill="currentColor"/><circle cx="14.500" cy="12.500" r="0.9" fill="currentColor"/>',
    drum: '<ellipse cx="12" cy="9" rx="8" ry="3"/><path d="M4 9v7c0 1.700 3.600 3 8 3s8-1.300 8-3V9M8 4l3 5M16 4l-3 5"/>',
    trumpet: '<path d="M3 10h9l8-4v12l-8-4H3z"/><path d="M6 14v3"/>',
    flute: '<path d="M3 17L17 3l4 4L7 21z"/><circle cx="10" cy="12" r="0.8" fill="currentColor"/><circle cx="13" cy="9" r="0.8" fill="currentColor"/>',
    robot: '<rect x="5" y="8" width="14" height="11" rx="2"/><path d="M12 5v3"/><circle cx="12" cy="4" r="1"/><circle cx="9" cy="13" r="1" fill="currentColor"/><circle cx="15" cy="13" r="1" fill="currentColor"/><path d="M9.500 16.500h5"/>',
    mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
    headphones: '<path d="M4 15v-3a8 8 0 0 1 16 0v3"/><rect x="3" y="14" width="4" height="6" rx="1.500"/><rect x="17" y="14" width="4" height="6" rx="1.500"/>',
    knob: '<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>',
    wave: '<path d="M2 12c2-6 4-6 6 0s4 6 6 0 4-6 6 0"/>',
    bell: '<path d="M6 16v-5a6 6 0 0 1 12 0v5l2 2H4zM10 21h4"/>',
    rocket: '<path d="M12 3c4 2 6 6 5 11l-3 3h-4l-3-3c-1-5 1-9 5-11zM9 17l-2 4M15 17l2 4"/><circle cx="12" cy="10" r="1.500"/>',
    flame: '<path d="M12 3c1 4 5 6 5 11a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-4-1-6 1-10z"/>',
    snow: '<path d="M12 3v18M4 7.500l16 9M20 7.500l-16 9"/>',
    star: '<path d="M12 3l2.700 5.500 6 .9-4.400 4.200 1 6-5.300-2.800-5.300 2.800 1-6L3.300 9.400l6-.9z"/>',
    mushroom: '<path d="M4 12a8 8 0 0 1 16 0z"/><path d="M9 12v6a3 3 0 0 0 6 0v-6"/>',
    frog: '<circle cx="8" cy="8" r="2.500"/><circle cx="16" cy="8" r="2.500"/><path d="M4 11c0 6 3 9 8 9s8-3 8-9c-2-1-5-2-8-2s-6 1-8 2zM9 15c2 1.500 4 1.500 6 0"/>',
    duck: '<path d="M5 16c0-4 3-5 5-5V7a3 3 0 0 1 6 0v3l4 1-4 1c0 4-3 7-7 7-3 0-4-2-4-3z"/><circle cx="14" cy="7" r="0.8" fill="currentColor"/>',
    ghost: '<path d="M5 20v-9a7 7 0 0 1 14 0v9l-3.500-2.500L12 20l-3.500-2.500z"/><circle cx="9.500" cy="11" r="1" fill="currentColor"/><circle cx="14.500" cy="11" r="1" fill="currentColor"/>',
    pumpkin: '<ellipse cx="12" cy="14" rx="8" ry="6"/><path d="M12 8c0-2 1-3 3-3M9 11c-1 2-1 5 0 7M15 11c1 2 1 5 0 7"/>',
    candy: '<circle cx="12" cy="9" r="6"/><path d="M12 15v6M9 8a3 3 0 0 1 6 0"/>',
    rainbow: '<path d="M3 18a9 9 0 0 1 18 0M7 18a5 5 0 0 1 10 0"/>',
    sax: '<path d="M10 3v11a4 4 0 1 0 8 0v-2M8 3h4"/>',
    violin: '<path d="M12 3v6M9 9c-3 1-3 5-1 6-2 2-1 6 4 6s6-4 4-6c2-1 2-5-1-6z"/>',
    accordion: '<rect x="3" y="6" width="4" height="12" rx="1"/><rect x="17" y="6" width="4" height="12" rx="1"/><path d="M7 8h10M7 12h10M7 16h10"/>',
    baby: '<circle cx="12" cy="12" r="9"/><path d="M8 14c2 2.500 6 2.500 8 0"/><circle cx="9" cy="10" r="0.9" fill="currentColor"/><circle cx="15" cy="10" r="0.9" fill="currentColor"/>',
    undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
    redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h3"/>',
    pencil: '<path d="M4 20l1-4L16 5l3 3L8 19z"/><path d="M14 7l3 3"/>',
    cursor: '<path d="M5 3l14 8-6 2-2 6z"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
    trash: '<path d="M4 7h16M10 3h4M6 7l1 13h10l1-13M10 11v6M14 11v6"/>',
    search: '<circle cx="10.500" cy="10.500" r="6.500"/><path d="M15.500 15.500L21 21"/>',
    check: '<path d="M4 12.500l5 5L20 6.500"/>',
    play: '<path d="M7 4l13 8-13 8z" fill="currentColor"/>',
    pause: '<path d="M7 4v16M17 4v16" stroke-width="3.500"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="1.500" fill="currentColor"/>',
    record: '<circle cx="12" cy="12" r="7" fill="currentColor"/>',
    home: '<path d="M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10"/>',
    restart: '<path d="M4 12a8 8 0 1 0 3-6.200M4 4v5h5"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    back: '<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-4"/>',
    bulb: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.500c.700.700 1 1.500 1 2.500h6c0-1 .300-1.800 1-2.500A6 6 0 0 0 12 3z"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    volume: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16.500 8.500a5 5 0 0 1 0 7M19 6a8.500 8.500 0 0 1 0 12"/>',
    mute: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M17 9l5 6M22 9l-5 6"/>',
    folder: '<path d="M3 6a2 2 0 0 1 2-2h4l2 3h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.500" fill="currentColor"/>',
    magnet: '<path d="M5 3v8a7 7 0 0 0 14 0V3h-4v8a3 3 0 0 1-6 0V3z"/>',
    hand: '<path d="M8 13V5a1.500 1.500 0 0 1 3 0v6M11 10V3.500a1.500 1.500 0 0 1 3 0V10M14 10V5a1.500 1.500 0 0 1 3 0v9a7 7 0 0 1-7 7c-3 0-4-2-6-5l-1-2a1.500 1.500 0 0 1 2.500-1.500L8 15"/>',
    dice: '<rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="9" cy="9" r="1.200" fill="currentColor"/><circle cx="15" cy="15" r="1.200" fill="currentColor"/><circle cx="15" cy="9" r="1.200" fill="currentColor"/><circle cx="9" cy="15" r="1.200" fill="currentColor"/>',
    save: '<path d="M5 3h11l4 4v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M8 3v5h7V3M8 21v-7h8v7"/>',
    flag: '<path d="M5 21V4M5 4h12l-2 4 2 4H5"/>',
    crown: '<path d="M3 8l4.500 4L12 5l4.500 7L21 8l-2 11H5z"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    users: '<circle cx="9" cy="8" r="3.500"/><path d="M2.500 20a6.500 6.500 0 0 1 13 0M16 4.500a3.500 3.500 0 0 1 0 7M18 14.500a6.500 6.500 0 0 1 3.500 5.500"/>',
    loop: '<path d="M4 11V9a3 3 0 0 1 3-3h11M15 3l3 3-3 3M20 13v2a3 3 0 0 1-3 3H6M9 21l-3-3 3-3"/>',
    gamepad: '<rect x="2" y="7" width="20" height="11" rx="5"/><path d="M7 10.500v4M5 12.500h4"/><circle cx="16" cy="11.500" r="1" fill="currentColor"/><circle cx="18.500" cy="14" r="1" fill="currentColor"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    eyeoff: '<path d="M3 3l18 18M10 6a9 9 0 0 1 2-.200c6 0 10 7.200 10 7.200a17 17 0 0 1-3 3.800M6.500 7A17 17 0 0 0 2 12s4 7 10 7a9 9 0 0 0 4-1"/>',
    vote: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 12.500l3 3 5-6"/>',
    gear: '<path d="M19.38 10.17 L21.84 10.20 L21.84 13.80 L19.38 13.83 L18.51 15.92 L20.23 17.69 L17.69 20.23 L15.92 18.51 L13.83 19.38 L13.80 21.84 L10.20 21.84 L10.17 19.38 L8.08 18.51 L6.31 20.23 L3.77 17.69 L5.49 15.92 L4.62 13.83 L2.16 13.80 L2.16 10.20 L4.62 10.17 L5.49 8.08 L3.77 6.31 L6.31 3.77 L8.08 5.49 L10.17 4.62 L10.20 2.16 L13.80 2.16 L13.83 4.62 L15.92 5.49 L17.69 3.77 L20.23 6.31 L18.51 8.08ZM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"/>',
    hourglass: '<path d="M6 3h12M6 21h12M7 3c0 5 5 6 5 9s-5 4-5 9M17 3c0 5-5 6-5 9s5 4 5 9"/>',
    signal: '<path d="M2 9a15 15 0 0 1 20 0M5 12.500a10 10 0 0 1 14 0M8.500 16a5 5 0 0 1 7 0"/><circle cx="12" cy="19.500" r="1" fill="currentColor"/>',
    blocks: '<rect x="3" y="13" width="8" height="7" rx="1"/><rect x="13" y="13" width="8" height="7" rx="1"/><rect x="8" y="4" width="8" height="7" rx="1"/>',
    phone: '<rect x="7" y="2.500" width="10" height="19" rx="2"/><path d="M11 18.500h2"/>',
    swords: '<path d="M4 4l9 9M20 4l-9 9M9 13l-4 4M15 13l4 4M3 21l3-3M21 21l-3-3"/>',
    shuffle: '<path d="M3 7h4l10 10h4M3 17h4l3-3M14 10l3-3h4M18 4l3 3-3 3M18 14l3 3-3 3"/>',
    sliders: '<path d="M5 4v16M12 4v16M19 4v16"/><circle cx="5" cy="14" r="2" fill="var(--paper, #fff)"/><circle cx="12" cy="8" r="2" fill="var(--paper, #fff)"/><circle cx="19" cy="16" r="2" fill="var(--paper, #fff)"/>',
    edit: '<path d="M4 20l1-4L16 5l3 3L8 19z"/>',
    arrowh: '<path d="M3 12h18M7 8l-4 4 4 4M17 8l4 4-4 4"/>',
    arrowv: '<path d="M12 3v18M8 7l4-4 4 4M8 17l4 4 4-4"/>',
    music: '<path d="M9 18V5l11-2v13"/><circle cx="6.500" cy="18" r="2.500"/><circle cx="17.500" cy="16" r="2.500"/>',
    sparkle: '<path d="M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z"/>',
    warn: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.5"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    metronome: '<path d="M8 21h8l2.500-15h-13z"/><path d="M12 17L16 6"/><circle cx="16" cy="6" r="1" fill="currentColor"/><path d="M9 14h6"/>',
    tap: '<path d="M12 3a9 9 0 0 1 9 9M12 7.500a4.500 4.500 0 0 1 4.500 4.500"/><circle cx="8" cy="16" r="3.500" fill="currentColor"/>',
    grid: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18M15 3v18M3 9h18M3 15h18"/>',
    octave: '<path d="M4 9l3-4 3 4M7 5v14M14 15l3 4 3-4M17 5v14"/>',
    pin: '<path d="M9 3h6l-1 6 3 3H7l3-3z"/><path d="M12 12v9"/>',
    unknown: '<circle cx="12" cy="12" r="9"/><path d="M9.500 9.500a2.500 2.500 0 1 1 3.500 2.300c-.700.400-1 1-1 1.700M12 17v.5"/>',
  };

  // Icônes d'instruments en couleur (js/icons-instruments.js). 'knob' (icône par défaut d'un instrument créé) s'affiche comme « instrument perso ».
  const COLOR_ALIAS = { knob: 'ins-custom' };
  function colorOf(name) {
    const set = GB.iconsColor || {};
    return set[COLOR_ALIAS[name] || name] || null;
  }

  function svg(name) {
    const color = colorOf(name);
    if (color) return '<svg class="ic-svg ic-color" viewBox="' + color.vb + '" width="1em" height="1em" aria-hidden="true" focusable="false">' + color.body + '</svg>';
    const body = P[name] || P.note;
    return '<svg class="ic-svg" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + body + '</svg>';
  }

  function el(name, extraClass) {
    const span = document.createElement('span');
    span.className = 'ic' + (extraClass ? ' ' + extraClass : '');
    span.innerHTML = svg(name);
    return span;
  }

  /** Remplace le contenu d'un élément par « icône + texte » (le texte reste du texte : aucune injection HTML). */
  function set(target, name, text) {
    target.textContent = '';
    if (name) target.append(el(name));
    if (text) target.append(document.createTextNode(text));
    return target;
  }

  function hydrate(root) {
    (root || document).querySelectorAll('i[data-i]').forEach((node) => {
      if (!node.firstChild) node.innerHTML = svg(node.getAttribute('data-i'));
    });
  }

  GB.icons = { svg, el, set, hydrate, has: (name) => Object.prototype.hasOwnProperty.call(P, name) || !!colorOf(name) };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => hydrate());
  else hydrate();
})((window.GB = window.GB || {}));

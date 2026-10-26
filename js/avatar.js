/**
 * GARTIC BANDE — le personnage du joueur (couleur + chapeau).
 *
 *   GB.avatar.COLORS / HATS      les choix possibles (ajouter un chapeau = l'ajouter dans HATS + un <symbol id="key-hat-…"> dans index.html)
 *   GB.avatar.normalize(x)       rend un choix valide (jamais d'erreur : valeurs inconnues → défaut)
 *   GB.avatar.get() / set(patch) lit / enregistre le choix de CE navigateur (localStorage, « gartic-bande.avatar.v1 »)
 *   GB.avatar.markup(avatar)     le dessin du personnage (SVG) prêt à insérer dans la page
 *
 * Module sans dépendance (utilisable aussi côté serveur plus tard, pour valider un choix reçu d'un joueur).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(null);
  else {
    root.GB = root.GB || {};
    root.GB.avatar = factory(root);
  }
})(typeof self !== 'undefined' ? self : this, function (win) {
  'use strict';

  const COLORS = [
    { id: 'pink', label: 'Rose', value: '#ff4f9a' },
    { id: 'yellow', label: 'Jaune', value: '#ffd23f' },
    { id: 'red', label: 'Rouge', value: '#d4145a' },
    { id: 'green', label: 'Vert', value: '#27e0a8' },
    { id: 'blue', label: 'Bleu', value: '#35b8ff' },
    { id: 'white', label: 'Blanc', value: '#ffffff' },
    { id: 'violet', label: 'Violet', value: '#7c5cff' },
    { id: 'grey', label: 'Gris', value: '#9ea0ae' },
  ];

  /** 'none' = pas de chapeau. Tous les autres chapeaux viennent de hats/hats.js (fichiers SVG). */
  const HATS = [{ id: 'none', label: 'Aucun' }];

  function clampNumber(value, min, max, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
  }

  // Chapeaux listés dans hats/hats.js : { id, label, file, x?, y?, scale?, blink? }
  const extra = win && win.GB && Array.isArray(win.GB.HATS_EXTRA) ? win.GB.HATS_EXTRA : [];
  extra.forEach((hat) => {
    if (hat && /^[a-z0-9-]{1,24}$/.test(hat.id) && hat.id !== 'none' && (typeof hat.file === 'string' || typeof hat.markup === 'string') && !HATS.some((entry) => entry.id === hat.id)) {
      HATS.push({
        id: hat.id,
        label: String(hat.label || hat.id).slice(0, 30),
        file: hat.file,
        backFile: typeof hat.backFile === 'string' ? hat.backFile : '', // dessin placé DERRIÈRE le personnage (ex. écouteurs)
        markup: typeof hat.markup === 'string' ? hat.markup : '',
        x: clampNumber(hat.x, -540, 540, 0), // décalage vers la droite (+) / la gauche (−), en unités du canevas 1080
        y: clampNumber(hat.y, -540, 540, 0), // décalage vers le bas (+) / le haut (−)
        scale: clampNumber(hat.scale, 0.2, 3, 1), // taille (1 = tel que dessiné), autour du haut de la tête
        blink: hat.blink !== false, // false = les yeux ne clignent pas avec ce chapeau
      });
    }
  });

  const DEFAULT = { color: 'red', hat: 'none' };
  const STORAGE_KEY = 'gartic-bande.avatar.v1';

  function normalize(value) {
    const input = value && typeof value === 'object' ? value : {};
    return {
      color: COLORS.some((entry) => entry.id === input.color) ? input.color : DEFAULT.color,
      hat: HATS.some((entry) => entry.id === input.hat) ? input.hat : DEFAULT.hat,
    };
  }

  function colorValue(colorId) {
    const entry = COLORS.find((item) => item.id === colorId);
    return entry ? entry.value : COLORS[2].value;
  }

  /**
   * Version « serveur » de normalize : ne connaît pas la liste des chapeaux (elle est dans le navigateur) ;
   * accepte tout identifiant de chapeau bien formé. Sert à nettoyer un choix reçu d'un autre joueur.
   */
  function sanitize(value) {
    const input = value && typeof value === 'object' ? value : {};
    return {
      color: COLORS.some((entry) => entry.id === input.color) ? input.color : DEFAULT.color,
      hat: typeof input.hat === 'string' && /^[a-z0-9-]{1,24}$/.test(input.hat) ? input.hat : 'none',
    };
  }

  let current = null;

  function get() {
    if (!current) {
      let stored = null;
      try {
        stored = JSON.parse(win && win.localStorage ? win.localStorage.getItem(STORAGE_KEY) : 'null');
      } catch (error) {
        stored = null;
      }
      current = normalize(stored);
    }
    return Object.assign({}, current);
  }

  function set(patch) {
    current = normalize(Object.assign({}, get(), patch || {}));
    try {
      if (win && win.localStorage) win.localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
    } catch (error) {
      /* stockage bloqué (navigation privée…) : le choix reste valable jusqu'à la fermeture de la page */
    }
    return Object.assign({}, current);
  }

  /** Le dessin : le corps (couleur choisie) et, si besoin, le chapeau par-dessus. `extraClass`, `style` : réglages de la page. */
  function markup(avatar, extraClass, style) {
    const value = normalize(avatar);
    const entry = HATS.find((item) => item.id === value.hat);
    let hat = '';
    let back = '';
    if (entry && entry.backFile) {
      const moveBack = 'translate(' + entry.x + ' ' + entry.y + ') translate(540 266) scale(' + entry.scale + ') translate(-540 -266)';
      back = '<svg width="100%" height="100%" viewBox="150 -10 780 1030" overflow="visible"><g transform="' + moveBack + '"><image href="' + entry.backFile.replace(/"/g, '') + '" x="0" y="0" width="1080" height="1080"/></g></svg>';
    }
    if (entry && entry.markup) {
      // chapeau dessiné en ligne : il peut utiliser var(--c) (couleur du skin)
      const move = 'translate(' + entry.x + ' ' + entry.y + ') translate(540 266) scale(' + entry.scale + ') translate(-540 -266)';
      hat = '<svg width="100%" height="100%" viewBox="150 -10 780 1030" overflow="visible"><g transform="' + move + '">' + entry.markup + '</g></svg>';
    } else if (entry && entry.file) {
      // chapeau venu d'un fichier : même repère que le personnage (canevas 1080 x 1080)
      const move = 'translate(' + entry.x + ' ' + entry.y + ') translate(540 266) scale(' + entry.scale + ') translate(-540 -266)';
      hat = '<svg width="100%" height="100%" viewBox="150 -10 780 1030" overflow="visible"><g transform="' + move + '"><image href="' + entry.file.replace(/"/g, '') + '" x="0" y="0" width="1080" height="1080"/></g></svg>';
    } else if (value.hat !== 'none') {
      hat = '<use href="#key-hat-' + value.hat + '"/>';
    }
    const blink = entry && entry.blink === false ? '--blink-anim:none;' : '';
    return (
      '<svg class="key ' + (extraClass || '') + '" style="--c:' + colorValue(value.color) + ';' + blink + (style || '') + '" aria-hidden="true" focusable="false">' +
      back + '<use href="#key-char"/>' + hat + '</svg>'
    );
  }

  function hashOf(text) {
    let hash = 0;
    for (let i = 0; i < text.length; i += 1) hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
    return hash;
  }

  /**
   * Le personnage d'un joueur (player.skin = { color, hat }), prêt à insérer dans la page.
   * Remplace l'ancien émoji. La taille se règle en CSS avec --skin-w sur le parent ou la classe passée.
   */
  function node(player, className) {
    const span = document.createElement('span');
    span.className = 'skin-badge' + (className ? ' ' + className : '');
    const skin = player && player.skin ? player.skin : DEFAULT;
    const delay = -((hashOf(String((player && (player.id || player.name)) || '')) % 40) / 10);
    span.innerHTML = markup(skin, 'key-badge', '--d:' + delay + 's;--r:0deg;');
    span.setAttribute('aria-hidden', 'true');
    return span;
  }

  return { COLORS, HATS, DEFAULT, normalize, sanitize, colorValue, get, set, markup, node };
});

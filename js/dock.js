/**
 * GARTIC BANDE — la barre d'outils de l'éditeur (une seule, deux dispositions) + ses menus + Smart BPM + zoom à deux doigts.
 *
 *  - Ordinateur (souris) : barre HORIZONTALE en bas.   Écran tactile (téléphone, tablette) : barre VERTICALE sur le côté.
 *    La détection se fait sur le type de pointeur (tactile ou non), pas sur la largeur de l'écran : body[data-input="touch|mouse"].
 *  - Mêmes boutons, mêmes fonctions, mêmes états actifs partout (les actions elles-mêmes sont dans js/ui.js).
 *  - Épingler / désépingler : la barre se range (une petite poignée la ramène). Le choix est gardé dans « gartic-bande.dock.v1 ».
 *  - Menus : tempo, précision de la grille, zoom, octaves, instrument/difficulté. Ils s'ouvrent à côté du bouton, sans quitter la grille.
 *  - Smart BPM : fenêtre dédiée ; le calcul est dans js/bpm-tap.js ; rien n'est appliqué avant « Utiliser ce BPM ».
 */
(function (GB) {
  'use strict';

  const KEY = 'gartic-bande.dock.v1';
  const $ = (id) => document.getElementById(id);
  const CONFIG = GB.CONFIG;

  const MENUS = { bpm: 'lt-bpm', sub: 'lt-sub', zoom: 'lt-grid', oct: 'lt-oct', mode: 'lt-mode' };
  let pinned = true;
  let openMenu = null;

  try {
    const saved = JSON.parse(window.localStorage.getItem(KEY) || '{}');
    if (saved && saved.pinned === false) pinned = false;
  } catch (error) {
    /* préférence illisible : barre épinglée */
  }

  /* ------------------------------------------------------------------ */
  /*  Appareil : tactile ou souris                                       */
  /* ------------------------------------------------------------------ */

  function isTouchDevice() {
    if (typeof matchMedia !== 'function') return false;
    if (matchMedia('(pointer: coarse)').matches) return true;
    return (navigator.maxTouchPoints || 0) > 0 && !matchMedia('(any-pointer: fine)').matches;
  }

  function applyInput() {
    document.body.dataset.input = isTouchDevice() ? 'touch' : 'mouse';
    positionMenu();
  }

  /* ------------------------------------------------------------------ */
  /*  Épingler / désépingler                                             */
  /* ------------------------------------------------------------------ */

  function applyPinned() {
    const stage = $('stage');
    stage.dataset.dock = pinned ? 'pinned' : 'unpinned';
    $('dock-handle').hidden = pinned;
    const pin = $('lt-pin');
    pin.setAttribute('aria-pressed', String(pinned));
    const label = pinned ? 'Désépingler' : 'Épingler';
    pin.title = pinned ? 'Désépingler la barre d\'outils (elle se range pour libérer de la place)' : 'Épingler la barre d\'outils';
    pin.setAttribute('aria-label', label);
    const text = pin.querySelector('.lt-label');
    if (text) text.textContent = label;
    if (!pinned) closeMenu();
  }

  function setPinned(value) {
    pinned = value;
    try {
      window.localStorage.setItem(KEY, JSON.stringify({ v: 1, pinned }));
    } catch (error) {
      /* stockage indisponible : le choix vaut pour la session */
    }
    applyPinned();
    if (GB.ui && GB.ui.applyLayout) requestAnimationFrame(() => GB.ui.applyLayout());
  }

  /* ------------------------------------------------------------------ */
  /*  Menus compacts                                                     */
  /* ------------------------------------------------------------------ */

  function panelOf(name) {
    return document.querySelector('#dock-pop .pop[data-pop="' + name + '"]');
  }

  function positionMenu() {
    if (!openMenu) return;
    const pop = $('dock-pop');
    const stage = $('stage');
    const button = $(MENUS[openMenu]);
    if (!pop || pop.hidden || !button) return;
    const sr = stage.getBoundingClientRect();
    const br = button.getBoundingClientRect();
    const gap = 8;
    const touch = document.body.dataset.input === 'touch';
    const dockLeft = $('dock').getBoundingClientRect().left - sr.left;
    // tactile : le menu reste à gauche de TOUTE la barre (qui peut avoir 2 colonnes) et ne la recouvre jamais
    pop.style.maxWidth = Math.max(180, (touch ? dockLeft - 16 : sr.width - 16)) + 'px';
    pop.style.maxHeight = Math.max(120, sr.height - 16) + 'px';
    const pw = pop.offsetWidth;
    const ph = pop.offsetHeight;
    const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
    let left;
    let top;
    if (document.body.dataset.input === 'touch') {
      // barre verticale : le menu s'ouvre à gauche du bouton
      left = dockLeft - pw - gap;
      top = br.top - sr.top + br.height / 2 - ph / 2;
    } else {
      // barre horizontale : le menu s'ouvre au-dessus du bouton
      left = br.left - sr.left + br.width / 2 - pw / 2;
      top = br.top - sr.top - ph - gap;
    }
    pop.style.left = clamp(left, 8, Math.max(8, sr.width - pw - 8)) + 'px';
    pop.style.top = clamp(top, 8, Math.max(8, sr.height - ph - 8)) + 'px';
  }

  function closeMenu() {
    if (!openMenu) return;
    const button = $(MENUS[openMenu]);
    if (button) button.setAttribute('aria-pressed', 'false');
    const panel = panelOf(openMenu);
    if (panel) panel.hidden = true;
    $('dock-pop').hidden = true;
    openMenu = null;
  }

  function showMenu(name) {
    if (openMenu === name) {
      closeMenu();
      return;
    }
    closeMenu();
    openMenu = name;
    $('dock-pop').hidden = false;
    panelOf(name).hidden = false;
    $(MENUS[name]).setAttribute('aria-pressed', 'true');
    refresh();
    positionMenu();
  }

  /* ------------------------------------------------------------------ */
  /*  Tempo (BPM)                                                        */
  /* ------------------------------------------------------------------ */

  function bpmNow() {
    return GB.store.state.bpm;
  }

  function setBpm(value) {
    if (GB.ui.isGameMode()) return;
    GB.ui.changeBpm(value);
    refresh();
  }

  /** Remet à jour tout ce qui dépend de l'état (tempo, pas de grille, plage d'octaves, boutons). Appelé par ui.js. */
  function refresh() {
    if (!$('dock')) return;
    const bpm = bpmNow();
    const game = GB.ui && GB.ui.isGameMode ? GB.ui.isGameMode() : false;
    const bpmBtn = $('lt-bpm');
    const label = bpmBtn.querySelector('.lt-label');
    if (label) label.textContent = bpm + ' BPM';
    const input = $('bpm-input');
    if (document.activeElement !== input) input.value = bpm;
    input.disabled = game;
    document.querySelectorAll('#dock-pop .bpm-step[data-step]').forEach((button) => {
      const step = Number(button.dataset.step);
      button.disabled = game || (step < 0 && bpm <= CONFIG.BPM_MIN) || (step > 0 && bpm >= CONFIG.BPM_MAX);
    });
    $('bpm-note').textContent = game ? 'Le tempo de cette chanson a été choisi à la préparation : il ne change pas pendant la partie.' : 'Les notes gardent leur place sur la grille : seule la vitesse change.';
    const smart = $('lt-smart');
    smart.disabled = game;
    smart.title = game ? 'Smart BPM n\'est pas disponible pendant une partie (le tempo est fixé)' : 'Smart BPM : trouve le tempo en tapant le rythme';
    const unit = GB.store.grid.unit;
    const active = document.querySelector('#grid-units .grid-unit.active');
    const subLabel = $('lt-sub').querySelector('.lt-label');
    if (subLabel) {
      const names = { 1: '1/4', 0.5: '1/8', 0.25: '1/16', 0.125: '1/32' };
      subLabel.textContent = GB.store.grid.magnet ? names[unit] || 'Triolet' : 'Libre';
    }
    if (active) active.setAttribute('aria-pressed', 'true');
    const range = $('oct-range');
    if (range && GB.ui.visibleRangeText) range.textContent = GB.ui.visibleRangeText();
  }

  function bindBpm() {
    document.querySelectorAll('#dock-pop .bpm-step[data-step]').forEach((button) => {
      button.addEventListener('click', () => setBpm(bpmNow() + Number(button.dataset.step)));
    });
    const input = $('bpm-input');
    const commit = () => {
      const value = Math.round(Number(input.value));
      if (Number.isFinite(value) && input.value !== '') setBpm(value);
      input.value = bpmNow();
    };
    input.addEventListener('change', commit);
    input.addEventListener('keydown', (event) => {
      event.stopPropagation(); // Espace et lettres : pas de raccourcis de l'éditeur pendant la saisie
      if (event.key === 'Enter') {
        commit();
        input.blur();
      }
    });
  }

  /* ------------------------------------------------------------------ */
  /*  Smart BPM                                                          */
  /* ------------------------------------------------------------------ */

  const smart = { taps: [], chosen: null, result: null };

  function smartEstimate() {
    smart.result = GB.bpmTap.estimate(smart.taps, { min: CONFIG.BPM_MIN, max: CONFIG.BPM_MAX });
    const result = smart.result;
    const shown = smart.chosen || result.bpm;
    $('smart-bpm').textContent = shown ? String(shown) : '—';
    const count = smart.taps.length;
    $('smart-sub').textContent = count === 0 ? 'Tape le rythme' : count === 1 ? '1 appui' : count + ' appuis';
    let state = '';
    if (count === 0) state = 'Écoute ta chanson et tape à chaque temps.';
    else if (result.bpm === null) state = 'Continue de taper : il faut au moins 3 appuis.';
    else if (result.stable) state = 'Tempo stable. Tu peux l\'utiliser, ou continuer pour l\'affiner.';
    else state = 'Le tempo se précise à chaque appui…';
    $('smart-state').textContent = state;
    const alts = $('smart-alts');
    const options = [];
    if (result.bpm !== null && smart.taps.length >= 4) {
      if (result.alternatives.half) options.push({ bpm: result.alternatives.half, text: '÷ 2 · ' + result.alternatives.half });
      options.push({ bpm: result.bpm, text: 'Estimé · ' + result.bpm });
      if (result.alternatives.double) options.push({ bpm: result.alternatives.double, text: '× 2 · ' + result.alternatives.double });
    }
    alts.hidden = options.length < 2;
    alts.innerHTML = '';
    if (options.length >= 2) {
      options.forEach((option) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'smart-alt';
        button.textContent = option.text;
        button.dataset.bpm = String(option.bpm);
        const on = (smart.chosen || result.bpm) === option.bpm;
        button.setAttribute('aria-pressed', String(on));
        button.addEventListener('click', () => {
          smart.chosen = option.bpm;
          smartEstimate();
        });
        alts.append(button);
      });
    }
    const game = GB.ui.isGameMode();
    const use = $('smart-use');
    use.disabled = game || !shown;
    use.title = game ? 'Le tempo est fixé pendant une partie' : shown ? 'Utiliser ' + shown + ' BPM' : 'Tape d\'abord le rythme';
  }

  function smartTap(timeStamp) {
    const now = Number.isFinite(timeStamp) && timeStamp > 0 ? timeStamp : performance.now(); // horloge monotone
    smart.taps.push(now);
    if (smart.taps.length > 64) smart.taps.shift();
    smart.chosen = null; // une nouvelle mesure remet l'estimation à jour
    smartEstimate();
    const button = $('smart-tap');
    button.classList.remove('pulse');
    void button.offsetWidth;
    button.classList.add('pulse');
  }

  function smartReset() {
    smart.taps = [];
    smart.chosen = null;
    smartEstimate();
  }

  function openSmart() {
    if (GB.ui.isGameMode()) return;
    closeMenu();
    const dialog = $('smart-dialog');
    smartReset();
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    $('smart-tap').focus({ preventScroll: true });
  }

  function closeSmart() {
    const dialog = $('smart-dialog');
    if (typeof dialog.close === 'function') dialog.close();
    else dialog.removeAttribute('open');
    smartReset(); // fermer sans confirmer : rien n'est gardé, le tempo de la composition n'a pas bougé
  }

  function bindSmart() {
    const tap = $('smart-tap');
    tap.addEventListener('pointerdown', (event) => {
      if (event.button > 0) return;
      event.preventDefault();
      smartTap(event.timeStamp);
    });
    tap.addEventListener('keydown', (event) => {
      if ((event.key === ' ' || event.key === 'Enter') && !event.repeat) {
        event.preventDefault();
        smartTap(event.timeStamp);
      }
    });
    tap.addEventListener('click', (event) => event.preventDefault());
    $('smart-reset').addEventListener('click', smartReset);
    $('smart-close').addEventListener('click', closeSmart);
    $('smart-dialog').addEventListener('cancel', () => smartReset());
    $('smart-use').addEventListener('click', () => {
      const bpm = smart.chosen || (smart.result && smart.result.bpm);
      if (!bpm || GB.ui.isGameMode()) return;
      setBpm(bpm);
      closeSmart();
      GB.ui.showToast('Tempo réglé sur ' + bpmNow() + ' BPM');
    });
  }

  /* ------------------------------------------------------------------ */
  /*  Zoom à deux doigts (écran tactile)                                 */
  /* ------------------------------------------------------------------ */

  function bindPinch() {
    const roll = $('roll');
    let pinch = null;
    const spread = (touches) => {
      const a = touches[0];
      const b = touches[1];
      return { dx: Math.abs(a.clientX - b.clientX), dy: Math.abs(a.clientY - b.clientY), cx: (a.clientX + b.clientX) / 2, cy: (a.clientY + b.clientY) / 2 };
    };
    roll.addEventListener(
      'touchstart',
      (event) => {
        if (event.touches.length !== 2 || roll.hidden) return;
        const s = spread(event.touches);
        GB.ui.cancelGesture(); // le pincement ne pose, ne déplace et ne sélectionne rien
        pinch = { x0: GB.ui.view.zoomX, y0: GB.ui.view.zoomY, dx: Math.max(10, s.dx), dy: Math.max(10, s.dy), d: Math.max(20, Math.hypot(s.dx, s.dy)) };
        pinch.axis = pinch.dx > pinch.dy * 2 ? 'x' : pinch.dy > pinch.dx * 2 ? 'y' : 'xy';
        roll.classList.add('is-pinching');
      },
      { passive: true }
    );
    roll.addEventListener(
      'touchmove',
      (event) => {
        if (!pinch || event.touches.length !== 2) return;
        if (event.cancelable) event.preventDefault(); // pas de défilement ni de zoom de la page pendant le pincement
        const s = spread(event.touches);
        const ratio = Math.hypot(s.dx, s.dy) / pinch.d;
        const rx = pinch.axis === 'y' ? 1 : pinch.axis === 'x' ? Math.max(10, s.dx) / pinch.dx : ratio;
        const ry = pinch.axis === 'x' ? 1 : pinch.axis === 'y' ? Math.max(10, s.dy) / pinch.dy : ratio;
        GB.ui.setZoom(pinch.x0 * rx, pinch.y0 * ry, { x: s.cx, y: s.cy });
        refresh();
      },
      { passive: false }
    );
    const end = (event) => {
      if (event.touches.length < 2 && pinch) {
        pinch = null;
        roll.classList.remove('is-pinching');
      }
    };
    roll.addEventListener('touchend', end, { passive: true });
    roll.addEventListener('touchcancel', end, { passive: true });
  }

  /* ------------------------------------------------------------------ */
  /*  Branchement                                                        */
  /* ------------------------------------------------------------------ */

  function init() {
    if (!$('dock')) return;
    applyInput();
    const mq = matchMedia('(pointer: coarse)');
    if (mq.addEventListener) mq.addEventListener('change', applyInput);
    window.addEventListener('resize', positionMenu);
    window.addEventListener('orientationchange', () => setTimeout(positionMenu, 250));
    applyPinned();
    Object.keys(MENUS).forEach((name) => $(MENUS[name]).addEventListener('click', () => showMenu(name)));
    document.querySelectorAll('#dock-pop .pop-close').forEach((button) => button.addEventListener('click', closeMenu));
    $('lt-pin').addEventListener('click', () => setPinned(!pinned));
    $('dock-handle').addEventListener('click', () => setPinned(true));
    $('lt-smart').addEventListener('click', openSmart);
    // Un menu ouvert se ferme dès qu'on touche ailleurs ; au doigt, si c'est la grille, ce premier contact ne pose aucune note.
    document.addEventListener(
      'pointerdown',
      (event) => {
        if (!openMenu) return;
        if (event.target.closest('#dock-pop, #dock')) return;
        closeMenu();
        if (event.target.closest('#roll') && document.body.dataset.input === 'touch') {
          event.stopPropagation();
          event.preventDefault();
        }
      },
      true
    );
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && openMenu) {
        event.stopPropagation();
        closeMenu();
      }
    });
    // Sur écran tactile, un rappel de ce que fait l'outil (les boutons n'ont pas d'infobulle au doigt).
    [['lt-pencil', 'Crayon : touche la grille pour poser une note'], ['lt-select', 'Sélection : touche des notes ou trace une zone']].forEach(([id, text]) => {
      $(id).addEventListener('click', () => {
        if (document.body.dataset.input === 'touch') GB.ui.showToast(text);
      });
    });
    $('roll').addEventListener('scroll', () => {
      if (openMenu === 'oct') refresh();
    }, { passive: true });
    $('mode-switch').addEventListener('click', refresh);
    bindBpm();
    bindSmart();
    bindPinch();
    refresh();
  }

  GB.dock = { refresh, closeMenu, isPinned: () => pinned, setPinned, openSmart, closeSmart };
  document.addEventListener('DOMContentLoaded', init);
})((window.GB = window.GB || {}));

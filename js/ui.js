/**
 * GARTIC BANDE — interface de l'éditeur (mode libre et édition pendant une partie).
 *
 * Rôle : afficher l'état (GB.store), transformer les clics en modifications de
 * l'état, puis demander au moteur audio (GB.audio) de s'aligner dessus.
 * Le DOM est toujours reconstruit à partir de l'état : il ne contient jamais de
 * données qui n'existent pas ailleurs.
 *
 * Piano-roll : les cellules servent à poser des notes ; les notes elles-mêmes sont des
 * éléments positionnés par-dessus (colonne de départ, ligne, durée), ce qui permet de
 * les déplacer et de les allonger avec la poignée de droite.
 *
 * Les écrans et panneaux propres à la partie solo sont dans game-ui.js, qui s'appuie sur GB.ui.
 */
(function (GB) {
  'use strict';

  const { CONFIG, store, audio } = GB;

  const $ = (id) => document.getElementById(id);
  const el = {
    btnCreate: $('btn-create'),
    btnDemo: $('btn-demo'),
    btnPlay: $('btn-play'),
    btnStop: $('btn-stop'),
    btnRestart: $('btn-restart'),
    btnAddTrack: $('btn-add-track'),
    btnClear: $('btn-clear'),
    btnBpmDown: $('btn-bpm-down'),
    btnBpmUp: $('btn-bpm-up'),
    bpmSlider: $('bpm-slider'),
    bpmValue: $('bpm-value'),
    statusText: $('status-text'),
    trackList: $('track-list'),
    tracksTitle: $('tracks-title'),
    instrumentPanel: $('instrument-panel'),
    instrumentPicker: $('instrument-picker'),
    btnNewInstrument: $('btn-new-instrument'),
    instrumentFor: $('instrument-for'),
    stageChip: $('stage-chip'),
    stageName: $('stage-name'),
    stageInstrument: $('stage-instrument'),
    roll: $('roll'),
    vowelBar: $('vowel-bar'),
    vowelTitle: $('vowel-title'),
    vowelHint: $('vowel-hint'),
    vowelButtons: $('vowel-buttons'),
    btnNoteDelete: $('btn-note-delete'),
    rollLegend: $('roll-legend'),
    gridBar: $('grid-bar'),
    gridUnits: $('grid-units'),
    gridMagnet: $('grid-magnet'),
    modeSwitch: $('mode-switch'),
    scaleSwitch: $('scale-switch'),
    modeNotice: $('mode-notice'),
    posReadout: $('pos-readout'),
    zoomXVal: $('zoom-x-val'),
    zoomYVal: $('zoom-y-val'),
    followBtn: $('follow-btn'),
    workspace: document.querySelector('.workspace'),
    btnSidebar: $('btn-sidebar'),
    gridReadout: $('grid-readout'),
    tips: $('tips'),
    restartDialog: $('restart-dialog'),
    toast: $('toast'),
    fatalError: $('fatal-error'),
  };

  const FREE_TIPS =
    '💡 Clique sur la grille pour poser une note (glisse pour en poser plusieurs). Attrape une note pour la déplacer, ' +
    'tire sa poignée de droite pour l\'allonger, clique dessus pour l\'enlever. Choisis le pas de la grille ou garde <kbd>Alt</kbd> pour placer librement. ' +
    'Clique ou glisse dans la règle des temps pour placer la barre de lecture. <kbd>Espace</kbd> lance et met en pause. ' +
    'Zoom : boutons ↔ ↕, <kbd>Ctrl</kbd> + molette (temps), <kbd>Ctrl</kbd> + <kbd>Maj</kbd> + molette (hauteur). Clique le clavier pour écouter une note. ' +
    'Trois modes : 👶 Baby (une gamme), 🎹 Débutant (touches blanches), 🎼 Expert (tout).';
  const FREE_LEGEND = '';

  // Éléments du piano-roll, reconstruits par renderRoll().
  let gridEl = null;
  let notesLayerEl = null;
  let tipEl = null;
  let cellGrid = []; // cellGrid[row][step] -> élément DOM de la cellule
  let noteEls = new Map(); // noteId -> élément DOM de la note
  let beatHeaders = []; // en-têtes de colonne (numéros de temps)
  let rowLabels = []; // rowLabels[row] -> étiquette de la ligne
  let emptyHintEl = null;
  let subgridEl = null; // repères des subdivisions (demi-temps, quarts de temps)
  let hoverEl = null; // repère « ici tomberait la note »
  let scrub = null; // glissement de la barre de lecture : { pointerId, position }
  let activeColumn = -1;
  let knownTrackIds = new Set(); // pistes déjà affichées (pour n'animer que les nouvelles)

  // Geste en cours : pose de notes (glisser), déplacement ou redimensionnement d'une note.
  let gesture = null;
  let selectedNoteId = null; // piste voix robot : la note dont on règle la voyelle
  let toastTimer = null;
  const statusListeners = [];

  /* ------------------------------------------------------------------ */
  /*  Utilitaires                                                        */
  /* ------------------------------------------------------------------ */

  function showToast(message) {
    el.toast.textContent = message;
    el.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toast.classList.remove('show'), 2400);
  }

  function showScreen(name) {
    document.querySelectorAll('.screen').forEach((screen) => {
      screen.hidden = screen.dataset.screen !== name;
    });
  }

  function isGameMode() {
    return document.body.classList.contains('mode-game');
  }

  /** Bascule l'éditeur entre composition libre et partie solo (affiche/masque les boutons concernés). */
  function setMode(mode) {
    document.body.classList.toggle('mode-game', mode === 'game');
    $('mode-pill').textContent = mode === 'game' ? 'Rounds' : 'Studio solo';
    el.tracksTitle.textContent = mode === 'game' ? 'Couches de la chanson' : 'Pistes';
    el.tips.innerHTML = FREE_TIPS;
    el.rollLegend.textContent = FREE_LEGEND;
  }

  function create(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function plural(count, singular, pluralForm) {
    return count + ' ' + (count > 1 ? pluralForm : singular);
  }

  /* ------------------------------------------------------------------ */
  /*  Rendu : pistes, instruments, en-tête de scène, tempo               */
  /* ------------------------------------------------------------------ */

  function renderTracks() {
    const tracks = store.getTracks();
    const selectedId = store.state.selectedTrackId;
    const gameMode = isGameMode();
    el.trackList.innerHTML = '';

    tracks.forEach((track) => {
      const instrument = GB.INSTRUMENTS[track.instrumentId];
      const author = gameMode && track.author ? GB.game.playerById(track.author) : null;
      const row = create('li', 'track-row');
      row.dataset.trackId = track.id;
      row.style.setProperty('--track-color', track.color);
      const turn = gameMode ? GB.game.currentTurn() : null;
      const isActive = gameMode
        ? GB.game.state.phase === 'compose' && Boolean(turn) && turn.trackId === track.id
        : track.id === selectedId;
      row.classList.toggle('selected', isActive);
      row.classList.toggle('enter', !knownTrackIds.has(track.id));
      row.classList.toggle('muted', track.muted);
      row.classList.toggle('locked', track.locked);
      row.classList.toggle('is-new', gameMode && GB.game.state.newTrackId === track.id);

      const main = create('button', 'track-main');
      main.dataset.action = 'select';
      main.type = 'button';
      main.disabled = gameMode;
      main.setAttribute('aria-pressed', String(isActive));
      main.append(create('span', 'track-chip'));
      const info = create('span', 'track-info');
      const title = author ? author.avatar + ' ' + author.name : track.name;
      const content =
        instrument.kind === 'audio'
          ? track.clip
            ? 'enregistrement ' + track.clip.duration.toFixed(1).replace('.', ',') + ' s'
            : 'pas encore enregistré'
          : plural(track.notes.length, 'note', 'notes');
      const details = instrument.icon + ' ' + instrument.label + ' · ' + content + (track.locked ? ' · 🔒' : '');
      info.append(create('strong', null, title), create('small', null, details));
      main.append(info);
      row.append(main);

      if (!gameMode) {
        const mute = create('button', 'icon-btn', track.muted ? '🔇' : '🔊');
        mute.type = 'button';
        mute.dataset.action = 'mute';
        mute.title = track.muted ? 'Réactiver le son de cette piste' : 'Couper le son de cette piste';
        mute.setAttribute('aria-label', mute.title);
        mute.setAttribute('aria-pressed', String(track.muted));

        const remove = create('button', 'icon-btn danger', '🗑');
        remove.type = 'button';
        remove.dataset.action = 'delete';
        remove.disabled = !store.canRemoveTrack();
        remove.title = store.canRemoveTrack() ? 'Supprimer cette piste' : 'Il faut garder au moins une piste';
        remove.setAttribute('aria-label', remove.title);
        row.append(mute, remove);
      }
      el.trackList.append(row);
    });

    knownTrackIds = new Set(tracks.map((track) => track.id));
    el.btnAddTrack.disabled = !store.canAddTrack();
    el.btnAddTrack.title = store.canAddTrack() ? '' : 'Maximum ' + CONFIG.MAX_TRACKS + ' pistes';
  }

  function renderInstrumentPicker() {
    const track = store.getSelectedTrack();
    if (!track) return;
    el.instrumentFor.textContent = '— ' + (isGameMode() ? 'ton tour' : track.name);
    el.instrumentPicker.style.setProperty('--track-color', track.color);
    el.instrumentPicker.innerHTML = '';

    GB.instruments.pickable().forEach((instrumentId) => {
      const instrument = GB.INSTRUMENTS[instrumentId];
      const button = create('button', 'instrument-btn');
      button.type = 'button';
      button.dataset.instrument = instrumentId;
      button.disabled = track.locked;
      button.classList.toggle('active', instrumentId === track.instrumentId);
      button.setAttribute('aria-pressed', String(instrumentId === track.instrumentId));
      button.append(create('span', 'ins-icon', instrument.icon), create('span', null, instrument.label));
      el.instrumentPicker.append(button);
    });
    if (el.btnNewInstrument) el.btnNewInstrument.disabled = track.locked;
    if (GB.instrumentUI) GB.instrumentUI.renderPanel();
  }

  function renderStageHeader() {
    const track = store.getSelectedTrack();
    if (!track) return;
    const instrument = GB.INSTRUMENTS[track.instrumentId];
    const author = isGameMode() && track.author ? GB.game.playerById(track.author) : null;
    el.stageName.textContent = author ? 'Ta couche' : track.name;
    el.stageInstrument.textContent = instrument.icon + ' ' + instrument.label;
    el.stageChip.style.setProperty('--track-color', track.color);
    el.btnClear.disabled = track.locked || !store.hasContent(track.id);
    el.btnClear.textContent = instrument.kind === 'audio' ? '🧹 Effacer l\'enregistrement' : '🧹 Effacer les notes de la piste';
    if (GB.gameUI) GB.gameUI.refreshActions();
  }

  function renderTempo() {
    const bpm = store.state.bpm;
    el.bpmSlider.min = CONFIG.BPM_MIN;
    el.bpmSlider.max = CONFIG.BPM_MAX;
    el.bpmSlider.value = bpm;
    el.bpmValue.textContent = bpm;
    el.btnBpmDown.disabled = bpm <= CONFIG.BPM_MIN;
    el.btnBpmUp.disabled = bpm >= CONFIG.BPM_MAX;
  }

  function renderTransport(status) {
    document.body.classList.toggle('is-playing', status === 'playing');
    document.body.classList.toggle('is-paused', status === 'paused');
    el.roll.classList.toggle('playing', status === 'playing');
    el.roll.classList.toggle('paused', status === 'paused');

    el.btnPlay.textContent = status === 'playing' ? '⏸ Pause' : status === 'paused' ? '▶ Reprendre' : '▶ Lecture';
    el.btnPlay.setAttribute('aria-label', status === 'playing' ? 'Pause' : 'Lecture');
    el.btnStop.disabled = status === 'stopped';
    el.statusText.textContent = status === 'playing' ? 'En lecture' : status === 'paused' ? 'En pause' : "À l'arrêt";

    if (status === 'stopped') setActiveColumn(-1);
    statusListeners.forEach((listener) => listener(status));
  }

  /* ------------------------------------------------------------------ */
  /*  Piano-roll : construction                                          */
  /* ------------------------------------------------------------------ */

  /* ------------------------------------------------------------------ */
  /*  Vue du piano-roll : mode de difficulté, gamme, zoom (réglages d'affichage, jamais des données)  */
  /* ------------------------------------------------------------------ */

  const ZOOM_X_MAX = 12;
  const ZOOM_Y_MIN = 0.6;
  const ZOOM_Y_MAX = 4;
  const MIN_ROW_PX = 20; // hauteur d'une ligne au zoom 100 % (en dessous, on fait défiler plutôt que de rétrécir)
  const MAX_ROW_PX = 60;
  const VIEW_KEY = 'gartic-bande.mode.v1';

  const view = { mode: 'expert', scale: 'major', zoomX: 1, zoomY: 1, follow: true };
  try {
    const saved = JSON.parse(window.localStorage.getItem(VIEW_KEY) || 'null');
    if (saved && GB.MODES[saved.mode]) view.mode = saved.mode;
    if (saved && GB.SCALES[saved.scale]) view.scale = saved.scale;
  } catch (error) {
    /* stockage indisponible : mode Expert */
  }

  let visibleRows = []; // lignes affichées (hauteurs réelles, de la plus grave à la plus aiguë)
  let lastRenderKey = '';
  let lastPointer = null;
  let autoScrollRaf = 0;
  let noticeShown = false;
  let needCenter = false;

  function modeInfo() {
    return GB.MODES[view.mode];
  }

  function isDrumsTrack(track) {
    return Boolean(track) && GB.INSTRUMENTS[track.instrumentId].kind === 'drums';
  }

  /** La ligne est-elle proposée par le mode courant ? (la batterie n'a pas de mode) */
  function rowAllowed(track, row) {
    return isDrumsTrack(track) || GB.modeAllowsRow(view.mode, view.scale, row);
  }

  /** Lignes affichées : celles du mode + celles qui portent déjà des notes (jamais de note cachée ni supprimée). */
  function computeVisibleRows(track) {
    const count = GB.getRowCount(track.instrumentId);
    const used = new Set(track.notes.map((note) => note.row));
    const rows = [];
    for (let row = 0; row < count; row += 1) {
      if (rowAllowed(track, row) || used.has(row)) rows.push(row);
    }
    return rows;
  }

  /** Position de la ligne en partant du haut de l'écran. */
  function topIndexOf(row) {
    const index = visibleRows.indexOf(row);
    return visibleRows.length - 1 - (index < 0 ? 0 : index);
  }

  function outOfModeNotes(track) {
    return track && !isDrumsTrack(track) ? track.notes.filter((note) => !rowAllowed(track, note.row)) : [];
  }

  function bypassOf(event) {
    return Boolean(event && event.altKey) && !modeInfo().forceMagnet;
  }

  function saveView() {
    try {
      window.localStorage.setItem(VIEW_KEY, JSON.stringify({ mode: view.mode, scale: view.scale }));
    } catch (error) {
      /* réglage valable pour cette session seulement */
    }
  }

  function unitLabel(unit) {
    if (unit === 1) return ['Temps', 'Un repère par temps'];
    if (unit === 0.5) return ['½', 'Demi-temps'];
    if (unit === 0.25) return ['¼', 'Quart de temps'];
    if (unit === 0.125) return ['⅛', 'Huitième de temps (très fin)'];
    return ['⅓', 'Triolet : un temps coupé en trois'];
  }

  /** Boutons de pas de la grille : ceux du mode courant. */
  function renderGridUnits() {
    el.gridUnits.innerHTML = '';
    modeInfo().units.forEach((unit) => {
      const [text, title] = unitLabel(unit);
      const button = create('button', 'grid-unit', text);
      button.type = 'button';
      button.dataset.unit = String(unit);
      button.title = title;
      el.gridUnits.append(button);
    });
  }

  /** Le pas et l'aimant doivent exister dans le mode choisi (les notes déjà posées ne bougent pas). */
  function clampGridToMode() {
    const info = modeInfo();
    if (!info.units.includes(store.grid.unit)) {
      const coarser = info.units.filter((unit) => unit >= store.grid.unit - 1e-9);
      store.setGrid({ unit: coarser.length ? coarser[coarser.length - 1] : info.units[info.units.length - 1] });
    }
    if (info.forceMagnet && !store.grid.magnet) store.setGrid({ magnet: true });
  }

  function updateNotice() {
    const track = store.getSelectedTrack();
    const hidden = outOfModeNotes(track);
    const info = modeInfo();
    el.modeNotice.hidden = hidden.length === 0;
    noticeShown = hidden.length > 0;
    if (!hidden.length) return;
    el.modeNotice.innerHTML =
      '<b>' + info.icon + ' ' + hidden.length + (hidden.length > 1 ? ' notes de cette piste sont' : ' note de cette piste est') + ' hors du mode ' + info.label + '.</b> ' +
      (hidden.length > 1 ? 'Elles sont conservées et jouées normalement : leur ligne reste' : 'Elle est conservée et jouée normalement : sa ligne reste') + ' affichée en grisé (étiquette « hors mode »). ' +
      'Tu peux ' + (hidden.length > 1 ? 'les' : 'la') + ' déplacer ou ' + (hidden.length > 1 ? 'les' : 'la') + ' supprimer, mais pas poser de nouvelles notes sur ces lignes. Repasse en Expert pour tout retrouver.';
  }

  function applyViewControls() {
    Array.from(el.modeSwitch.children).forEach((button) => {
      const on = button.dataset.mode === view.mode;
      button.classList.toggle('active', on);
      button.setAttribute('aria-pressed', String(on));
    });
    el.scaleSwitch.hidden = view.mode !== 'baby';
    Array.from(el.scaleSwitch.children).forEach((button) => {
      const on = button.dataset.scale === view.scale;
      button.classList.toggle('active', on);
      button.setAttribute('aria-pressed', String(on));
    });
    el.followBtn.classList.toggle('active', view.follow);
    el.followBtn.setAttribute('aria-pressed', String(view.follow));
    el.zoomXVal.textContent = Math.round(view.zoomX * 100) + '%';
    el.zoomYVal.textContent = Math.round(view.zoomY * 100) + '%';
    const track = store.getSelectedTrack();
    const drums = isDrumsTrack(track);
    el.modeSwitch.classList.toggle('inactive', drums);
    el.modeSwitch.title = drums ? 'La batterie n\'a pas de notes : le mode ne change rien ici' : '';
    $('oct-up').disabled = drums;
    $('oct-down').disabled = drums;
  }

  /** Change de mode et/ou de gamme : seul l'affichage change, aucune note n'est touchée. */
  function setView(patch) {
    const before = view.mode + view.scale;
    if (patch.mode && GB.MODES[patch.mode]) view.mode = patch.mode;
    if (patch.scale && GB.SCALES[patch.scale]) view.scale = patch.scale;
    if (view.mode + view.scale === before) return;
    saveView();
    clampGridToMode();
    renderGridUnits();
    applyGridView();
    renderRoll();
    const info = modeInfo();
    let total = 0;
    store.getTracks().forEach((track) => {
      total += outOfModeNotes(track).length;
    });
    showToast(info.icon + ' Mode ' + info.label + ' — ' + info.help + (total ? ' (' + total + ' note' + (total > 1 ? 's' : '') + ' hors mode conservée' + (total > 1 ? 's' : '') + ')' : ''));
  }

  /* ----- zoom et défilement ----- */

  function rollMetrics() {
    const labels = el.roll.querySelector('.roll-labels');
    const header = el.roll.querySelector('.roll-header');
    return {
      labelW: labels ? labels.offsetWidth : 0,
      headH: header ? header.offsetHeight : 0,
    };
  }

  /** Taille d'une colonne et d'une ligne au zoom 100 % (la grille remplit la fenêtre), puis au zoom courant. */
  function layoutSizes() {
    const { labelW, headH } = rollMetrics();
    const rows = Math.max(1, visibleRows.length);
    const baseCol = Math.max(10, (el.roll.clientWidth - labelW) / CONFIG.STEP_COUNT);
    const baseRow = Math.min(MAX_ROW_PX, Math.max(MIN_ROW_PX, (el.roll.clientHeight - headH) / rows));
    return { labelW, headH, baseCol, baseRow, colW: baseCol * view.zoomX, rowH: Math.max(10, baseRow * view.zoomY), rows };
  }

  /** Applique le zoom : tailles en pixels, repères de subdivision, classes de densité. */
  function applyLayout() {
    if (!el.roll.clientWidth || el.roll.hidden) return;
    const size = layoutSizes();
    el.roll.style.setProperty('--col-w', size.colW + 'px');
    el.roll.style.setProperty('--row-px', size.rowH + 'px');
    el.roll.style.gridTemplateColumns = 'var(--label-w) ' + size.colW * CONFIG.STEP_COUNT + 'px';
    el.roll.classList.toggle('compact', size.rowH < 30);
    el.roll.classList.toggle('tiny', size.rowH < 17);
    applySubgrid(size.colW);
    applyViewControls();
    if (needCenter) {
      needCenter = false;
      el.roll.scrollLeft = 0;
      centerOnRow(focusRow(store.getSelectedTrack()));
    }
  }

  /** Traits de subdivision : celles du pas choisi, plus des repères plus fins à mesure qu'on zoome. */
  function applySubgrid(colW) {
    const info = modeInfo();
    const { unit, magnet } = store.grid;
    const layers = [];
    const sizes = [];
    const ticks = [];
    const add = (division, alpha, tickAlpha) => {
      if (colW / division < 7) return;
      const colorLine = 'linear-gradient(to right, rgba(32, 18, 63, ' + alpha + ') 1px, transparent 1px)';
      layers.push(colorLine);
      sizes.push('calc(100% / (var(--cols) * ' + division + ')) 100%');
      ticks.push('linear-gradient(to right, rgba(32, 18, 63, ' + tickAlpha + ') 2px, transparent 2px)');
    };
    const activeDivision = Math.round(1 / unit * 1000) / 1000;
    [2, 4, 8].forEach((division) => {
      if (division > info.maxDetail) return;
      const active = Math.abs(activeDivision - division) < 1e-6;
      const coarserThanActive = division < activeDivision - 1e-6;
      if (active) add(division, magnet ? 0.34 : 0.18, 0.7);
      else if (coarserThanActive) add(division, 0.22, 0.45);
      else if (colW / division >= 36) add(division, 0.12, 0.3); // zoom : les subdivisions plus fines apparaissent d'elles-mêmes
    });
    if (Math.abs(activeDivision - 3) < 1e-6) add(3, magnet ? 0.34 : 0.18, 0.7);
    else if (info.maxDetail >= 8 && colW / 3 >= 60) add(3, 0.1, 0.25);
    if (subgridEl) {
      subgridEl.style.backgroundImage = layers.join(',');
      subgridEl.style.backgroundSize = sizes.join(',');
    }
    const ticksEl = el.roll.querySelector('.header-ticks');
    if (ticksEl) {
      ticksEl.style.backgroundImage = ticks.join(',');
      ticksEl.style.backgroundSize = sizes.join(',');
      ticksEl.style.opacity = '1';
    }
  }

  function clampZoom() {
    view.zoomX = Math.min(ZOOM_X_MAX, Math.max(1, view.zoomX));
    view.zoomY = Math.min(ZOOM_Y_MAX, Math.max(ZOOM_Y_MIN, view.zoomY));
  }

  /** Zoom autour d'un point : le temps / la ligne sous ce point reste au même endroit de l'écran. */
  function setZoom(zoomX, zoomY, anchor) {
    if (el.roll.hidden) return;
    const before = layoutSizes();
    const rect = el.roll.getBoundingClientRect();
    const vx = anchor && Number.isFinite(anchor.x) ? anchor.x - rect.left - el.roll.clientLeft - before.labelW : (el.roll.clientWidth - before.labelW) / 2;
    const vy = anchor && Number.isFinite(anchor.y) ? anchor.y - rect.top - el.roll.clientTop - before.headH : (el.roll.clientHeight - before.headH) / 2;
    const cols = (el.roll.scrollLeft + vx) / before.colW;
    const rows = (el.roll.scrollTop + vy) / before.rowH;
    view.zoomX = zoomX;
    view.zoomY = zoomY;
    clampZoom();
    applyLayout();
    const after = layoutSizes();
    el.roll.scrollLeft = Math.max(0, cols * after.colW - vx);
    el.roll.scrollTop = Math.max(0, rows * after.rowH - vy);
  }

  /** Point d'ancrage des boutons : la note sélectionnée si elle est visible, sinon le centre de la grille. */
  function defaultAnchor() {
    const noteEl = selectedNoteId && noteEls.get(selectedNoteId);
    if (noteEl) {
      const box = noteEl.getBoundingClientRect();
      return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    }
    return null;
  }

  function zoomBy(axis, factor, anchor) {
    const point = anchor || defaultAnchor();
    if (axis === 'x') setZoom(view.zoomX * factor, view.zoomY, point);
    else setZoom(view.zoomX, view.zoomY * factor, point);
  }

  function centerOnRow(row) {
    const size = layoutSizes();
    const top = topIndexOf(row) * size.rowH + size.rowH / 2;
    el.roll.scrollTop = Math.max(0, top - (el.roll.clientHeight - size.headH) / 2);
  }

  /** Ligne autour de laquelle centrer : la moyenne des notes de la piste, sinon le Do4. */
  function focusRow(track) {
    if (!track || track.notes.length === 0) return GB.PREVIEW_ROW + 4;
    const rows = track.notes.map((note) => note.row).sort((a, b) => a - b);
    return rows[Math.floor(rows.length / 2)];
  }

  function resetZoom() {
    view.zoomX = 1;
    view.zoomY = 1;
    applyLayout();
    el.roll.scrollLeft = 0;
    centerOnRow(focusRow(store.getSelectedTrack()));
  }

  /** Ajuste le zoom et le défilement pour que les notes de la piste remplissent la grille. */
  function fitToNotes() {
    const track = store.getSelectedTrack();
    if (!track || track.notes.length === 0 || el.roll.hidden) {
      resetZoom();
      return;
    }
    const starts = track.notes.map((note) => note.step);
    const ends = track.notes.map((note) => note.step + store.lengthOf(track, note));
    const first = Math.max(0, Math.min(...starts) - 0.5);
    const last = Math.min(CONFIG.STEP_COUNT, Math.max(...ends) + 0.5);
    const tops = track.notes.map((note) => topIndexOf(note.row));
    const topMin = Math.max(0, Math.min(...tops) - 1);
    const topMax = Math.min(visibleRows.length - 1, Math.max(...tops) + 1);
    const rowSpan = Math.max(6, topMax - topMin + 1);
    view.zoomX = CONFIG.STEP_COUNT / Math.max(1.5, last - first);
    view.zoomY = 1;
    applyLayout();
    const base = layoutSizes();
    view.zoomY = ((el.roll.clientHeight - base.headH) / rowSpan) / base.baseRow;
    clampZoom();
    applyLayout();
    const size = layoutSizes();
    el.roll.scrollLeft = first * size.colW;
    el.roll.scrollTop = Math.max(0, topMin * size.rowH);
  }

  function octaveStep(direction) {
    const track = store.getSelectedTrack();
    if (!track || isDrumsTrack(track)) return;
    const perOctave = Math.max(1, visibleRows.filter((row) => row >= 12 && row < 24).length || GB.MODES[view.mode].octaveRows || 7);
    const size = layoutSizes();
    el.roll.scrollTop = Math.max(0, el.roll.scrollTop - direction * perOctave * size.rowH);
  }

  /** Pendant la lecture, la grille suit la barre (si l'option est active). */
  function followPlayhead(position) {
    if (!view.follow || position === null || el.roll.hidden) return;
    const size = layoutSizes();
    const x = position * size.colW;
    const viewW = el.roll.clientWidth - size.labelW;
    if (el.roll.scrollWidth - size.labelW <= viewW + 1) return; // tout est déjà visible
    if (x < el.roll.scrollLeft || x > el.roll.scrollLeft + viewW - 30) el.roll.scrollLeft = Math.max(0, x - viewW * 0.12);
  }

  /** Place (ou replace) l'élément d'une note d'après son état : départ, ligne et durée. */
  function positionNoteElement(noteEl, track, note) {
    noteEl.style.setProperty('--x', note.step);
    noteEl.style.setProperty('--w', displayLength(track, note));
    noteEl.style.setProperty('--y', topIndexOf(note.row));
    noteEl.classList.toggle('out-mode', !rowAllowed(track, note.row));
    // Voix robot : la voyelle de la note est écrite sur la note.
    if (isVowelTrack(track)) {
      noteEl.dataset.vowel = note.vowel || 'a';
      noteEl.firstChild.textContent = (note.vowel || 'a').toUpperCase();
    }
  }

  /** Largeur affichée : la batterie occupe un temps, sauf si un autre coup suit de plus près sur la même ligne. */
  function displayLength(track, note) {
    const length = store.lengthOf(track, note);
    if (GB.INSTRUMENTS[track.instrumentId].resizable) return length;
    let gap = length;
    track.notes.forEach((other) => {
      if (other !== note && other.row === note.row && other.step > note.step) gap = Math.min(gap, other.step - note.step);
    });
    return Math.max(0.25, gap);
  }

  /** Après un changement de notes : les coups de batterie voisins ajustent leur largeur. */
  function refreshDrumWidths(track) {
    if (!track || GB.INSTRUMENTS[track.instrumentId].resizable) return;
    track.notes.forEach((note) => {
      const noteEl = noteEls.get(note.id);
      if (noteEl) noteEl.style.setProperty('--w', displayLength(track, note));
    });
  }

  function isVowelTrack(track) {
    return Boolean(track) && GB.instruments.settingsEngine(track.instrumentId) === 'formant';
  }

  function selectNote(noteId) {
    selectedNoteId = noteId;
    noteEls.forEach((noteEl, id) => noteEl.classList.toggle('selected', id === noteId));
    renderVowelBar();
  }

  const VOWEL_HINTS = { a: 'comme « ah »', e: 'comme « é »', i: 'comme « i »', o: 'comme « o »', u: 'comme « u »', ou: 'comme « ou »' };

  /** Barre des voyelles : règle la voyelle de la note sélectionnée, ou celle des prochaines notes. */
  function renderVowelBar() {
    const track = store.getSelectedTrack();
    const show = isVowelTrack(track);
    el.vowelBar.hidden = !show;
    if (!show) return;
    const note = selectedNoteId ? store.getNote(track.id, selectedNoteId) : null;
    if (!note) selectedNoteId = null;
    const current = note ? note.vowel || 'a' : (track.settings && track.settings.vowel) || 'a';
    el.vowelTitle.textContent = note ? 'Voyelle de cette note' : 'Voyelle des prochaines notes';
    el.vowelHint.textContent = note ? 'Clique une autre note pour régler la sienne.' : 'Clique une note posée pour changer sa voyelle seule.';
    if (el.vowelButtons.children.length !== GB.VOWEL_IDS.length) {
      el.vowelButtons.innerHTML = '';
      GB.VOWEL_IDS.forEach((vowel) => {
        const button = create('button', 'vowel-btn', vowel.toUpperCase());
        button.type = 'button';
        button.dataset.vowel = vowel;
        button.title = VOWEL_HINTS[vowel];
        el.vowelButtons.append(button);
      });
    }
    Array.from(el.vowelButtons.children).forEach((button) => {
      button.classList.toggle('active', button.dataset.vowel === current);
      button.setAttribute('aria-pressed', String(button.dataset.vowel === current));
      button.disabled = track.locked;
    });
    el.btnNoteDelete.hidden = !note;
    el.btnNoteDelete.disabled = track.locked;
  }

  function chooseVowel(vowel) {
    const track = store.getSelectedTrack();
    if (!isVowelTrack(track) || track.locked) return;
    const note = selectedNoteId ? store.getNote(track.id, selectedNoteId) : null;
    if (note) {
      if (store.setNoteVowel(track.id, note.id, vowel)) positionNoteElement(noteEls.get(note.id), track, note);
      audio.preview(track.id, note.row, note.length, note);
    } else {
      store.setSettings(track.id, { vowel });
      audio.preview(track.id, Math.floor(GB.getRowCount(track.instrumentId) / 2), 0.6, { vowel });
    }
    renderVowelBar();
    if (GB.instrumentUI) GB.instrumentUI.renderPanel();
  }

  function deleteSelectedNote() {
    const track = store.getSelectedTrack();
    if (!track || !selectedNoteId || track.locked) return;
    const id = selectedNoteId;
    selectedNoteId = null;
    if (store.removeNote(track.id, id)) {
      removeNoteElement(id);
      refreshAfterNoteCountChange();
    }
    renderVowelBar();
  }

  function createNoteElement(track, note, isNew) {
    const noteEl = create('div', 'note');
    noteEl.dataset.noteId = note.id;
    noteEl.classList.toggle('is-new', Boolean(isNew));
    noteEl.classList.toggle('no-resize', !GB.INSTRUMENTS[track.instrumentId].resizable);
    noteEl.append(create('span', 'note-body'), create('span', 'note-handle'));
    positionNoteElement(noteEl, track, note);
    noteEls.set(note.id, noteEl);
    notesLayerEl.insertBefore(noteEl, tipEl);
    return noteEl;
  }

  function removeNoteElement(noteId) {
    const noteEl = noteEls.get(noteId);
    if (noteEl) noteEl.remove();
    noteEls.delete(noteId);
  }

  /** Reconstruit toute la grille pour la piste sélectionnée. */
  function renderRoll() {
    const track = store.getSelectedTrack();
    if (!track) {
      el.roll.innerHTML = '';
      return;
    }
    // Piste « voix micro » : pas de grille de notes, le panneau d'enregistrement prend sa place.
    const isAudio = GB.INSTRUMENTS[track.instrumentId].kind === 'audio';
    if (GB.voiceUI) GB.voiceUI.render();
    if (isAudio) {
      el.roll.innerHTML = '';
      el.roll.hidden = true;
      el.gridBar.hidden = true;
      el.modeNotice.hidden = true;
      selectedNoteId = null;
      renderVowelBar();
      return;
    }
    el.roll.hidden = false;
    el.gridBar.hidden = false;
    if (!store.getNote(track.id, selectedNoteId)) selectedNoteId = null;
    const isDrums = GB.INSTRUMENTS[track.instrumentId].kind === 'drums';
    visibleRows = computeVisibleRows(track);
    const rowCount = visibleRows.length;
    const renderKey = track.id + '|' + view.mode + '|' + view.scale + '|' + track.instrumentId;
    const keepScroll = { left: el.roll.scrollLeft, top: el.roll.scrollTop };

    el.roll.innerHTML = '';
    el.roll.classList.remove('mode-baby', 'mode-beginner', 'mode-expert');
    el.roll.classList.add('mode-' + view.mode);
    el.roll.style.setProperty('--rows', rowCount);
    el.roll.style.setProperty('--cols', CONFIG.STEP_COUNT);
    el.roll.style.setProperty('--track-color', track.color);
    el.roll.classList.toggle('drums', isDrums);
    el.roll.classList.toggle('locked', track.locked);

    // Coin + en-tête des temps
    el.roll.append(create('div', 'roll-corner'));
    const header = create('div', 'roll-header');
    const barCount = CONFIG.STEP_COUNT / CONFIG.STEPS_PER_BAR;
    for (let bar = 0; bar < barCount; bar += 1) header.append(create('div', 'roll-bar', 'Mesure ' + (bar + 1)));
    beatHeaders = [];
    for (let step = 0; step < CONFIG.STEP_COUNT; step += 1) {
      const beat = create('div', 'roll-beat', String((step % CONFIG.STEPS_PER_BAR) + 1));
      beat.classList.toggle('bar-start', step % CONFIG.STEPS_PER_BAR === 0 && step > 0);
      beatHeaders.push(beat);
      header.append(beat);
    }
    const ticks = create('div', 'header-ticks');
    const flag = create('div', 'scrub-flag');
    flag.append(create('span', 'scrub-flag-label', '▶'));
    flag.title = 'Barre de lecture : glisse-la pour choisir où la musique démarre';
    header.append(ticks, flag);
    header.classList.add('scrubbable');
    header.title = 'Clique ou glisse ici pour placer la barre de lecture';
    el.roll.append(header);

    // Étiquettes des lignes : la note la plus aiguë est en haut.
    const labels = create('div', 'roll-labels');
    rowLabels = [];
    // Clavier : touches blanches pleines, touches noires plus courtes et au premier plan (Do♯ Ré♯ | Fa♯ Sol♯ La♯).
    labels.classList.toggle('keyboard', !isDrums);
    for (let index = rowCount - 1; index >= 0; index -= 1) {
      const row = visibleRows[index];
      const allowed = rowAllowed(track, row);
      const name = GB.getRowLabel(track.instrumentId, row, track.settings);
      const label = create('div', 'roll-label', name);
      label.classList.toggle('root', GB.isRootRow(track.instrumentId, row));
      if (!isDrums && view.mode === 'baby' && allowed) label.classList.add('scale-key'); // Baby : une grosse touche par note de la gamme
      else if (GB.isBlackRow(track.instrumentId, row)) label.classList.add('black');
      else if (!isDrums) {
        label.classList.add('white');
        if (row % 12 === 5 || row % 12 === 0) label.classList.add('edge'); // Mi|Fa et Si|Do : pas de touche noire entre les deux
      }
      if (!allowed) {
        label.classList.add('out-mode');
        label.append(create('small', 'oom', 'hors mode'));
      }
      label.dataset.row = row;
      if (!isDrums) {
        label.setAttribute('role', 'button');
        label.setAttribute('aria-label', 'Écouter ' + name);
        label.title = 'Clique pour écouter cette note';
        label.addEventListener('pointerdown', (event) => {
          event.preventDefault();
          label.classList.add('pressed');
          setTimeout(() => label.classList.remove('pressed'), 220);
          const current = store.getSelectedTrack();
          if (current && !current.muted) audio.preview(current.id, row, 0.6, isVowelTrack(current) ? { vowel: (current.settings && current.settings.vowel) || 'a' } : undefined);
        });
      }
      rowLabels[row] = label;
      labels.append(label);
    }
    el.roll.append(labels);

    // Grille des cellules
    const body = create('div', 'roll-body');
    gridEl = create('div', 'roll-grid');
    gridEl.setAttribute('role', 'grid');
    gridEl.setAttribute('aria-label', 'Piano-roll de la piste ' + track.name);
    cellGrid = [];
    visibleRows.forEach((row) => {
      cellGrid[row] = [];
    });

    const otherTracks = store.getTracks().filter((other) => other.id !== track.id && !other.muted);
    for (let index = rowCount - 1; index >= 0; index -= 1) {
      const row = visibleRows[index];
      for (let step = 0; step < CONFIG.STEP_COUNT; step += 1) {
        const cell = create('div', 'cell');
        cell.dataset.step = step;
        cell.dataset.row = row;
        cell.classList.toggle('bar-start', step % CONFIG.STEPS_PER_BAR === 0 && step > 0);
        cell.classList.toggle('root', GB.isRootRow(track.instrumentId, row));
        if (GB.isBlackRow(track.instrumentId, row)) cell.classList.add('black-row');
        if (!rowAllowed(track, row)) cell.classList.add('out-mode');
        cellGrid[row][step] = cell;

        // Petits points : départ des notes des autres pistes (pour voir toute la composition d'un coup d'œil).
        const echoes = otherTracks.filter((other) => store.hasNote(other.id, step, row));
        if (echoes.length > 0) {
          const ghosts = create('span', 'ghosts');
          echoes.slice(0, 4).forEach((other) => {
            const dot = create('i', 'ghost');
            dot.style.setProperty('--c', other.color);
            ghosts.append(dot);
          });
          cell.append(ghosts);
        }
        gridEl.append(cell);
      }
    }

    // Couche des notes (au-dessus des cellules) + bulle d'information pendant les gestes
    notesLayerEl = create('div', 'notes-layer');
    tipEl = create('div', 'drag-tip');
    tipEl.hidden = true;
    notesLayerEl.append(tipEl);
    noteEls = new Map();
    track.notes.forEach((note) => createNoteElement(track, note, false));

    const playhead = create('div', 'playhead');
    playhead.append(create('span', 'playhead-knob'));
    subgridEl = create('div', 'subgrid');
    hoverEl = create('div', 'hover-marker');
    hoverEl.hidden = true;
    notesLayerEl.insertBefore(hoverEl, notesLayerEl.firstChild);
    emptyHintEl = create('div', 'empty-hint');
    emptyHintEl.append(create('span', null, '✨ Clique sur la grille pour poser ta première note !'));
    body.append(gridEl, subgridEl, notesLayerEl, playhead, emptyHintEl);
    el.roll.append(body);

    activeColumn = -1;
    applyGridView();
    if (renderKey !== lastRenderKey) {
      lastRenderKey = renderKey;
      needCenter = true; // nouvelle piste / nouveau mode : on se place sur les notes (dès que la grille est visible)
    }
    applyLayout();
    if (!needCenter) {
      el.roll.scrollLeft = keepScroll.left;
      el.roll.scrollTop = keepScroll.top;
    }
    updateNotice();
    updateEmptyHint();
    renderVowelBar();
    if (selectedNoteId && noteEls.has(selectedNoteId)) noteEls.get(selectedNoteId).classList.add('selected');
    renderTransport(audio.getStatus());
  }

  function updateEmptyHint() {
    const track = store.getSelectedTrack();
    if (emptyHintEl) emptyHintEl.hidden = !track || track.notes.length > 0;
  }

  /* ------------------------------------------------------------------ */
  /*  Piano-roll : tête de lecture                                       */
  /* ------------------------------------------------------------------ */

  function setActiveColumn(column) {
    if (column === activeColumn) return;
    if (activeColumn >= 0) toggleColumn(activeColumn, false);
    activeColumn = column;
    if (activeColumn >= 0) toggleColumn(activeColumn, true);
  }

  function toggleColumn(column, on) {
    if (beatHeaders[column]) beatHeaders[column].classList.toggle('col-active', on);
    cellGrid.forEach((rowCells) => {
      if (rowCells[column]) rowCells[column].classList.toggle('col-active', on);
    });
  }

  /** Met en valeur les notes qui sonnent à la position courante (en colonnes, fractionnaire). */
  function updateSoundingNotes(position) {
    const track = store.getSelectedTrack();
    if (!track) return;
    track.notes.forEach((note) => {
      const noteEl = noteEls.get(note.id);
      if (!noteEl) return;
      const sounding = position !== null && position >= note.step && position < note.step + store.lengthOf(track, note);
      noteEl.classList.toggle('sounding', sounding);
    });
  }

  /** Position affichée par la barre : celle qu'on est en train de glisser, sinon celle de la musique. */
  function shownPosition() {
    return scrub ? scrub.position : audio.getPlayheadPosition();
  }

  /** Boucle d'animation : déplace toutes les têtes de lecture et met en valeur la colonne jouée. */
  function animatePlayhead() {
    const position = shownPosition();
    const left = position === null ? '0%' : (position / CONFIG.STEP_COUNT) * 100 + '%';
    document.querySelectorAll('.playhead, .scrub-flag').forEach((playhead) => {
      playhead.style.left = left;
    });
    const playing = audio.getStatus() === 'playing' && !scrub;
    const shown = position === null ? 0 : position;
    const readout = 'Mesure ' + (Math.floor(shown / CONFIG.STEPS_PER_BAR) + 1) + ' · temps ' + GB.formatBeats((shown % CONFIG.STEPS_PER_BAR) + 1);
    if (el.posReadout.textContent !== readout) el.posReadout.textContent = readout;
    if (playing) followPlayhead(position);
    if (position !== null) setActiveColumn(playing ? Math.floor(position) : -1);
    updateSoundingNotes(playing ? position : null);
    requestAnimationFrame(animatePlayhead);
  }

  /* ------------------------------------------------------------------ */
  /*  Piano-roll : gestes (poser, déplacer, allonger)                    */
  /* ------------------------------------------------------------------ */

  function gridGeometry() {
    const rect = gridEl.getBoundingClientRect();
    const rowCount = visibleRows.length;
    return { rect, colWidth: rect.width / CONFIG.STEP_COUNT, rowHeight: rect.height / rowCount, rowCount };
  }

  /** Position horizontale du pointeur en colonnes (fractionnaire, entre 0 et STEP_COUNT). */
  function columnsAt(geometry, x) {
    return Math.min(CONFIG.STEP_COUNT, Math.max(0, (x - geometry.rect.left) / geometry.colWidth));
  }

  /** Position où tomberait une nouvelle note sous le pointeur (alignée sur la grille, ou libre). */
  function placementAt(geometry, x, bypass) {
    const raw = Math.min(CONFIG.STEP_COUNT - 0.001, columnsAt(geometry, x));
    return Math.min(CONFIG.STEP_COUNT - 0.05, store.gridStep(raw, bypass));
  }

  /** Aligne une position (déplacement) sur le pas de la grille le plus proche, ou la garde libre. */
  function nearestStep(raw, bypass) {
    if (store.grid.magnet && !bypass) return Math.round(raw / store.grid.unit) * store.grid.unit;
    return raw;
  }

  function isFreeNow(event) {
    return !store.grid.magnet || bypassOf(event);
  }

  /** Ligne musicale affichée sous le pointeur (hauteur réelle : 0 = Do3, la plus grave). */
  function visualRowAt(geometry, y) {
    const fromTop = Math.min(geometry.rowCount - 1, Math.max(0, Math.floor((y - geometry.rect.top) / geometry.rowHeight)));
    return visibleRows[geometry.rowCount - 1 - fromTop];
  }

  /** Ligne proposée la plus proche d'une ligne affichée (celle du dessous en cas d'égalité). */
  function nearestAllowedRow(track, row) {
    const index = visibleRows.indexOf(row);
    for (let distance = 0; distance < visibleRows.length; distance += 1) {
      const below = visibleRows[index - distance];
      if (below !== undefined && rowAllowed(track, below)) return below;
      const above = visibleRows[index + distance];
      if (above !== undefined && rowAllowed(track, above)) return above;
    }
    return row;
  }

  function refreshAfterNoteCountChange() {
    updateEmptyHint();
    renderTracks();
    renderStageHeader();
  }

  /** Bulle près de la note pendant un geste (hauteur et moment, ou durée). */
  function showTip(noteEl, text) {
    tipEl.textContent = text;
    tipEl.hidden = false;
    tipEl.style.left = noteEl.offsetLeft + 'px';
    const above = noteEl.offsetTop - tipEl.offsetHeight - 6;
    tipEl.style.top = (above >= 0 ? above : noteEl.offsetTop + noteEl.offsetHeight + 6) + 'px';
  }

  function describePosition(track, note) {
    const bar = Math.floor(note.step / CONFIG.STEPS_PER_BAR) + 1;
    const beat = GB.formatBeats((note.step % CONFIG.STEPS_PER_BAR) + 1);
    return GB.getRowLabel(track.instrumentId, note.row, track.settings) + ' · mesure ' + bar + ', temps ' + beat;
  }

  /** Surligne la ligne et les colonnes que la note occupe pendant un déplacement. */
  function highlightTarget(track, note) {
    rowLabels.forEach((label) => label.classList.remove('target'));
    beatHeaders.forEach((beat) => beat.classList.remove('target'));
    if (rowLabels[note.row]) rowLabels[note.row].classList.add('target');
    const length = store.lengthOf(track, note);
    const first = Math.floor(note.step + 1e-6);
    const last = Math.min(CONFIG.STEP_COUNT, Math.ceil(note.step + length - 1e-6));
    for (let column = first; column < last; column += 1) {
      if (beatHeaders[column]) beatHeaders[column].classList.add('target');
    }
  }

  function clearGestureVisuals() {
    el.roll.classList.remove('is-dragging');
    noteEls.forEach((noteEl) => noteEl.classList.remove('dragging'));
    rowLabels.forEach((label) => label && label.classList.remove('target'));
    beatHeaders.forEach((beat) => beat.classList.remove('target'));
    if (tipEl) tipEl.hidden = true;
    if (gesture && gesture.originEl) gesture.originEl.remove();
  }

  function pointerDownOnRoll(event) {
    if (event.button > 0) return; // seul le clic principal (ou le doigt) agit
    const track = store.getSelectedTrack();
    if (!track || !gridEl) return;
    if (event.target.closest('.scrub-flag, .playhead-knob, .roll-header')) {
      beginScrub(event);
      return;
    }
    const noteEl = event.target.closest('.note');
    const cell = event.target.closest('.cell');
    if (!noteEl && !cell) return;
    if (track.locked) {
      showToast('Cette couche est verrouillée 🔒');
      return;
    }
    audio.unlock(); // premier geste de l'utilisateur : le son est autorisé
    event.preventDefault();
    if (noteEl) beginNoteGesture(event, track, noteEl);
    else beginPaint(event, track);
  }

  /* ----- barre de lecture : cliquer ou glisser pour choisir la position (ne touche jamais aux notes) ----- */

  function scrubPositionAt(x) {
    const rect = el.roll.querySelector('.roll-header').getBoundingClientRect();
    const columns = Math.min(CONFIG.STEP_COUNT, Math.max(0, ((x - rect.left) / rect.width) * CONFIG.STEP_COUNT));
    return Math.floor(columns * 4 + 1e-6) / 4; // au quart de temps
  }

  function beginScrub(event) {
    if (GB.game && GB.game.isRevealLocked()) return;
    audio.unlock();
    event.preventDefault();
    scrub = { pointerId: event.pointerId, position: Math.min(scrubPositionAt(event.clientX), CONFIG.STEP_COUNT - 0.25) };
    el.roll.classList.add('is-scrubbing');
    // Arrêt ou pause : la position est prise tout de suite. En lecture : elle est prise au relâchement.
    if (audio.getStatus() !== 'playing') audio.seek(scrub.position);
    showReadout('Départ : ' + describeBeat(scrub.position));
  }

  function moveScrub(event) {
    scrub.position = Math.min(scrubPositionAt(event.clientX), CONFIG.STEP_COUNT - 0.25);
    if (audio.getStatus() !== 'playing') audio.seek(scrub.position);
    showReadout('Départ : ' + describeBeat(scrub.position));
  }

  function endScrub() {
    if (!scrub) return;
    const position = scrub.position;
    scrub = null;
    el.roll.classList.remove('is-scrubbing');
    audio.seek(position);
  }

  function describeBeat(position) {
    const bar = Math.floor(position / CONFIG.STEPS_PER_BAR) + 1;
    return 'mesure ' + bar + ', temps ' + GB.formatBeats((position % CONFIG.STEPS_PER_BAR) + 1);
  }

  function showReadout(text) {
    el.gridReadout.textContent = text;
  }

  const READOUT_DEFAULT = 'Maintiens Alt pour placer librement';

  /* ----- grille : pas, aimant, repères ----- */

  function applyGridView() {
    const { unit, magnet } = store.grid;
    Array.from(el.gridUnits.children).forEach((button) => {
      const active = Number(button.dataset.unit) === unit;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    el.gridMagnet.classList.toggle('active', magnet);
    el.gridMagnet.setAttribute('aria-pressed', String(magnet));
    el.gridMagnet.textContent = magnet ? '🧲 Aimant' : '🖐 Libre';
    const forced = modeInfo().forceMagnet;
    el.gridMagnet.disabled = forced;
    el.gridMagnet.title = forced ? 'Mode Baby : les notes se calent toujours sur la grille' : 'Aimant : les notes se calent sur la grille. Garde Alt enfoncée pour placer librement.';
    el.gridUnits.classList.toggle('is-free', !magnet);
    el.roll.dataset.unit = String(unit);
    el.roll.classList.toggle('free-grid', !magnet);
    if (subgridEl) subgridEl.className = 'subgrid' + (magnet ? '' : ' faint');
  }

  function chooseGrid(patch) {
    if (modeInfo().forceMagnet && patch.magnet === false) return;
    store.setGrid(patch);
    applyGridView();
    applyLayout();
  }

  /** Repère sous le pointeur : montre l'endroit exact où une note serait posée. */
  function onRollHover(event) {
    if (!hoverEl || gesture || scrub || !gridEl) return;
    const overNote = event.target.closest && event.target.closest('.note');
    const inGrid = event.target.closest && event.target.closest('.roll-body');
    if (!inGrid || overNote) {
      hoverEl.hidden = true;
      if (!overNote) showReadout(READOUT_DEFAULT);
      return;
    }
    const geometry = gridGeometry();
    const step = placementAt(geometry, event.clientX, bypassOf(event));
    hoverEl.hidden = false;
    hoverEl.style.setProperty('--x', step);
    showReadout('Ici : ' + describeBeat(step));
  }

  /* ----- poser des notes (clic ou glisser sur des cellules vides) ----- */

  function beginPaint(event, track) {
    gesture = { kind: 'paint', pointerId: event.pointerId, tried: new Set(), free: isFreeNow(event) };
    paintAt(track, event);
  }

  /** Pose une note là où est le pointeur (grille ou libre). En mode libre, un clic = une note (pas de traînée). */
  function paintAt(track, event) {
    const geometry = gridGeometry();
    const inside = event.clientX >= geometry.rect.left && event.clientX <= geometry.rect.right;
    if (!inside) return;
    const step = placementAt(geometry, event.clientX, bypassOf(event));
    const row = visualRowAt(geometry, event.clientY);
    const key = step + ':' + row;
    if (gesture.tried.has(key)) return;
    gesture.tried.add(key);
    if (!rowAllowed(track, row)) {
      if (!gesture.warned) showToast('Cette ligne est « hors mode » : elle garde ses notes, mais on n\'en pose pas de nouvelles. Change de mode pour l\'utiliser.');
      gesture.warned = true;
      return;
    }
    const note = store.addNote(track.id, step, row);
    if (!note) return;
    createNoteElement(track, note, true);
    refreshDrumWidths(track);
    refreshAfterNoteCountChange();
    audio.preview(track.id, note.row, note.length, note);
    if (selectedNoteId) selectNote(null); // poser une note repasse en mode « voyelle des prochaines notes »
  }

  /* ----- attraper une note : la déplacer, l'allonger ou (simple clic) l'enlever ----- */

  function beginNoteGesture(event, track, noteEl) {
    const note = store.getNote(track.id, noteEl.dataset.noteId);
    if (!note) return;
    const geometry = gridGeometry();
    const isResize = Boolean(event.target.closest('.note-handle')) && !noteEl.classList.contains('no-resize');
    const noteRight = geometry.rect.left + (note.step + store.lengthOf(track, note)) * geometry.colWidth;

    gesture = {
      kind: isResize ? 'resize' : 'move',
      pointerId: event.pointerId,
      trackId: track.id,
      noteId: note.id,
      noteEl,
      startX: event.clientX,
      startY: event.clientY,
      threshold: event.pointerType === 'touch' ? 10 : 4,
      moved: false,
      origin: { step: note.step, row: note.row, length: note.length },
      grabOffset: columnsAt(geometry, event.clientX) - note.step, // où on a attrapé la note (en colonnes, fractionnaire)
      handleOffset: (noteRight - event.clientX) / geometry.colWidth, // écart (en colonnes) entre le doigt et le bord droit
      lastRow: note.row,
      originEl: null,
    };
  }

  function startVisibleDrag(track, note) {
    gesture.moved = true;
    el.roll.classList.add('is-dragging');
    gesture.noteEl.classList.add('dragging');
    if (gesture.kind === 'move') {
      // Repère en pointillés à l'emplacement d'origine
      const origin = create('div', 'note-origin');
      origin.style.setProperty('--x', gesture.origin.step);
      origin.style.setProperty('--w', store.lengthOf(track, gesture.origin));
      origin.style.setProperty('--y', topIndexOf(gesture.origin.row));
      notesLayerEl.insertBefore(origin, notesLayerEl.firstChild);
      gesture.originEl = origin;
    }
  }

  function moveNoteTo(event, track, note) {
    const geometry = gridGeometry();
    const targetStep = nearestStep(columnsAt(geometry, event.clientX) - gesture.grabOffset, bypassOf(event));
    let targetRow = visualRowAt(geometry, event.clientY);
    // Une note « hors mode » reste sur sa ligne tant qu'on ne la déplace pas vers une autre ; sinon on vise une ligne proposée.
    if (targetRow !== gesture.origin.row && !rowAllowed(track, targetRow)) targetRow = nearestAllowedRow(track, targetRow);
    if (store.moveNote(track.id, note.id, targetStep, targetRow)) {
      positionNoteElement(gesture.noteEl, track, note);
      refreshDrumWidths(track);
      highlightTarget(track, note);
      if (note.row !== gesture.lastRow) {
        gesture.lastRow = note.row;
        audio.preview(track.id, note.row, note.length); // on entend la hauteur choisie
      }
    }
    showTip(gesture.noteEl, describePosition(track, note));
  }

  function resizeNoteTo(event, track, note) {
    const geometry = gridGeometry();
    const endInColumns = columnsAt(geometry, event.clientX) + gesture.handleOffset;
    // La FIN de la note se cale sur un repère de la grille (ou reste libre) : la durée suit.
    let length = nearestStep(endInColumns, bypassOf(event)) - note.step;
    if (length <= 0.0005) length = isFreeNow(event) ? 0.05 : store.grid.unit;
    if (store.resizeNote(track.id, note.id, length)) {
      positionNoteElement(gesture.noteEl, track, note);
      highlightTarget(track, note);
    }
    showTip(gesture.noteEl, GB.formatLength(note.length));
  }

  /** Pendant un geste, tenir le pointeur près du bord de la grille la fait défiler (utile quand on a zoomé). */
  function startAutoScroll() {
    if (autoScrollRaf) return;
    const tick = () => {
      autoScrollRaf = 0;
      if (!gesture || !lastPointer || el.roll.hidden) return;
      if (gesture.kind !== 'paint' && !gesture.moved) {
        autoScrollRaf = requestAnimationFrame(tick);
        return;
      }
      const rect = el.roll.getBoundingClientRect();
      const { labelW, headH } = rollMetrics();
      const edge = 32;
      const push = (distance) => Math.round(Math.min(1, Math.max(0, distance / edge)) * 18);
      let dx = 0;
      let dy = 0;
      if (lastPointer.clientX > rect.right - edge) dx = push(lastPointer.clientX - (rect.right - edge));
      else if (lastPointer.clientX < rect.left + labelW + edge) dx = -push(rect.left + labelW + edge - lastPointer.clientX);
      if (lastPointer.clientY > rect.bottom - edge) dy = push(lastPointer.clientY - (rect.bottom - edge));
      else if (lastPointer.clientY < rect.top + headH + edge) dy = -push(rect.top + headH + edge - lastPointer.clientY);
      if (dx || dy) {
        const beforeLeft = el.roll.scrollLeft;
        const beforeTop = el.roll.scrollTop;
        el.roll.scrollLeft += dx;
        el.roll.scrollTop += dy;
        if (el.roll.scrollLeft !== beforeLeft || el.roll.scrollTop !== beforeTop) onPointerMove(lastPointer);
      }
      autoScrollRaf = requestAnimationFrame(tick);
    };
    autoScrollRaf = requestAnimationFrame(tick);
  }

  function onPointerMove(event) {
    if (scrub) {
      if (event.pointerId === scrub.pointerId) moveScrub(event);
      return;
    }
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    lastPointer = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, altKey: event.altKey };
    startAutoScroll();
    if (gesture.kind === 'paint') {
      const track = store.getSelectedTrack();
      if (track && !gesture.free && !bypassOf(event)) paintAt(track, event); // glisser = plusieurs notes, seulement avec l'aimant
      return;
    }
    const track = store.getTrack(gesture.trackId);
    const note = store.getNote(gesture.trackId, gesture.noteId);
    if (!track || !note) return;

    if (!gesture.moved) {
      const distance = Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY);
      if (distance < gesture.threshold) return; // simple clic tant qu'on ne bouge pas vraiment
      startVisibleDrag(track, note);
    }
    if (gesture.kind === 'move') moveNoteTo(event, track, note);
    else resizeNoteTo(event, track, note);
  }

  function endGesture(event, cancelled) {
    if (scrub && event.pointerId === scrub.pointerId) {
      endScrub();
      return;
    }
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    const finished = gesture;
    if (finished.kind !== 'paint') {
      const track = store.getTrack(finished.trackId);
      const note = store.getNote(finished.trackId, finished.noteId);
      if (cancelled && finished.moved && track && note) {
        // Geste interrompu : la note retrouve sa place d'origine.
        note.step = finished.origin.step;
        note.row = finished.origin.row;
        note.length = finished.origin.length;
        positionNoteElement(finished.noteEl, track, note);
        refreshDrumWidths(track);
      } else if (!finished.moved && finished.kind === 'move' && !cancelled && track && note) {
        if (isVowelTrack(track) && selectedNoteId !== note.id) {
          // Voix robot : un premier clic choisit la note (pour régler sa voyelle), un second clic l'enlève.
          selectNote(note.id);
          audio.preview(track.id, note.row, note.length, note);
        } else {
          // Clic sans glisser : on enlève la note.
          if (selectedNoteId === note.id) selectedNoteId = null;
          store.removeNote(track.id, note.id);
          removeNoteElement(note.id);
          refreshDrumWidths(track);
          refreshAfterNoteCountChange();
          renderVowelBar();
        }
      }
    }
    clearGestureVisuals();
    gesture = null;
    lastPointer = null;
    // Les lignes « hors mode » n'existent que tant qu'elles portent des notes : on rafraîchit si l'ensemble a changé.
    const current = store.getSelectedTrack();
    if (current && !el.roll.hidden) {
      const wanted = computeVisibleRows(current);
      if (wanted.join() !== visibleRows.join()) renderRoll();
      else updateNotice();
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Actions                                                            */
  /* ------------------------------------------------------------------ */

  function renderAll() {
    renderTempo();
    renderTracks();
    renderInstrumentPicker();
    renderStageHeader();
    renderRoll();
  }

  /** Prépare une composition libre : quitte une éventuelle partie, remet la boucle à 4 mesures. */
  function startComposition(loader) {
    audio.stop();
    if (GB.voiceUI) GB.voiceUI.reset();
    if (GB.game.state.active) GB.game.quit();
    setMode('free');
    if (CONFIG.LOOP_BARS !== 4) GB.game.restoreFreePlayLoop();
    if (GB.gameUI) GB.gameUI.showEditorView('free');
    loader();
    audio.setBpm(store.state.bpm);
    audio.syncTracks();
    renderAll();
    showScreen('editor');
  }

  /* Studio « Composition solo » : sa composition reste en mémoire quand on retourne à l'accueil ou qu'on joue une partie. */
  const studio = { active: false, snap: null };

  function studioHasWork() {
    return store.getTracks().some((track) => track.notes.length > 0 || track.clip);
  }

  /** Avant une partie : met la composition libre de côté pour la retrouver ensuite. */
  function stashStudio() {
    if (studio.active && !isGameMode() && studioHasWork()) studio.snap = store.snapshot();
    studio.active = false;
  }

  function createMusic() {
    audio.unlock();
    studio.snap = null;
    studio.active = true;
    startComposition(() => store.reset());
    showToast('Pose ta première note sur la grille 🎶');
  }

  /** Carte « Composition solo » : reprend la composition en cours si elle existe, sinon page blanche. */
  function openStudio() {
    audio.unlock();
    if (studio.snap) {
      const snap = studio.snap;
      studio.snap = null;
      studio.active = true;
      startComposition(() => store.restore(snap));
      showToast('Ta composition est là, comme tu l\'avais laissée.');
    } else if (studio.active && !isGameMode()) {
      showScreen('editor');
    } else {
      createMusic();
    }
  }

  function goHomeFromStudio() {
    audio.stop();
    showScreen('home');
    if (studioHasWork()) showToast('Ta composition est gardée : retrouve-la avec « Composition solo ».');
  }

  function loadDemo() {
    audio.unlock();
    studio.snap = null;
    studio.active = true;
    startComposition(() => store.loadDemo());
    audio.play().catch(() => showToast('Impossible de démarrer le son : clique sur Lecture.'));
    showToast('Démo chargée — modifie-la comme tu veux !');
  }

  function restart() {
    studio.snap = null;
    studio.active = true;
    startComposition(() => store.reset());
    showToast('Nouvelle page blanche ✨');
  }

  function askRestart() {
    if (typeof el.restartDialog.showModal === 'function') {
      el.restartDialog.showModal();
    } else if (window.confirm('Recommencer à zéro ? Toutes les notes seront effacées.')) {
      restart();
    }
  }

  /** Pendant la révélation, la lecture appartient à l'hôte : aucune commande locale (pause, arrêt, barre de lecture). */
  function revealLocked() {
    if (!GB.game || !GB.game.isRevealLocked()) return false;
    showToast('🔒 La révélation est contrôlée par l\'hôte : pas de pause individuelle.');
    return true;
  }

  function togglePlayback() {
    if (revealLocked()) return;
    if (audio.getStatus() === 'playing') {
      audio.pause();
    } else {
      audio.play().catch(() => showToast('Impossible de démarrer le son : réessaie.'));
    }
  }

  function addTrack() {
    audio.unlock();
    const track = store.addTrack();
    if (!track) {
      showToast('Maximum ' + CONFIG.MAX_TRACKS + ' pistes atteint');
      return;
    }
    audio.syncTracks();
    renderAll();
    showToast(track.name + ' ajoutée — choisis son instrument !');
  }

  function removeTrack(trackId) {
    const track = store.getTrack(trackId);
    if (!track || !store.removeTrack(trackId)) return;
    audio.syncTracks();
    renderAll();
    showToast(track.name + ' supprimée');
  }

  function selectTrack(trackId) {
    if (isGameMode()) return; // en partie, seule ta couche du moment est éditable
    if (trackId === store.state.selectedTrackId || !store.selectTrack(trackId)) return;
    renderTracks();
    renderInstrumentPicker();
    renderStageHeader();
    renderRoll();
  }

  function toggleMute(trackId) {
    store.toggleMute(trackId);
    audio.syncTracks();
    renderTracks();
    renderRoll(); // les points des pistes coupées disparaissent de la grille
  }

  function changeInstrument(instrumentId) {
    audio.unlock();
    const track = store.getSelectedTrack();
    if (!track || !store.setInstrument(track.id, instrumentId)) return;
    audio.syncTracks();
    renderTracks();
    renderInstrumentPicker();
    renderStageHeader();
    renderRoll();
    // Petit aperçu pour entendre tout de suite le nouveau timbre.
    audio.preview(track.id, GB.INSTRUMENTS[instrumentId].kind === 'drums' ? 0 : GB.PREVIEW_ROW);
  }

  function clearSelectedTrack() {
    const track = store.getSelectedTrack();
    if (!track || !store.clearNotes(track.id)) return;
    renderTracks();
    renderStageHeader();
    renderRoll();
    showToast('Notes effacées');
  }

  function changeBpm(value) {
    const bpm = store.setBpm(value);
    audio.setBpm(bpm);
    renderTempo();
  }

  /* ------------------------------------------------------------------ */
  /*  Branchement des événements                                         */
  /* ------------------------------------------------------------------ */

  function bindEvents() {
    el.btnCreate.addEventListener('click', openStudio);
    $('btn-studio-home').addEventListener('click', goHomeFromStudio);
    el.btnDemo.addEventListener('click', loadDemo);
    el.btnPlay.addEventListener('click', togglePlayback);
    el.btnStop.addEventListener('click', () => {
      if (!revealLocked()) audio.stop();
    });
    el.btnRestart.addEventListener('click', askRestart);
    el.btnAddTrack.addEventListener('click', addTrack);
    el.btnClear.addEventListener('click', clearSelectedTrack);
    el.btnBpmDown.addEventListener('click', () => changeBpm(store.state.bpm - 5));
    el.btnBpmUp.addEventListener('click', () => changeBpm(store.state.bpm + 5));
    el.bpmSlider.addEventListener('input', () => changeBpm(el.bpmSlider.value));

    el.restartDialog.addEventListener('close', () => {
      if (el.restartDialog.returnValue === 'confirm') restart();
    });

    el.trackList.addEventListener('click', (event) => {
      const actionEl = event.target.closest('[data-action]');
      const rowEl = event.target.closest('.track-row');
      if (!actionEl || !rowEl) return;
      const trackId = rowEl.dataset.trackId;
      if (actionEl.dataset.action === 'select') selectTrack(trackId);
      if (actionEl.dataset.action === 'mute') toggleMute(trackId);
      if (actionEl.dataset.action === 'delete') removeTrack(trackId);
    });

    el.instrumentPicker.addEventListener('click', (event) => {
      const button = event.target.closest('[data-instrument]');
      if (button) changeInstrument(button.dataset.instrument);
    });

    el.roll.addEventListener('pointerdown', pointerDownOnRoll);
    el.roll.addEventListener('pointermove', onRollHover);
    el.roll.addEventListener('pointerleave', () => {
      if (hoverEl) hoverEl.hidden = true;
      if (!scrub) showReadout(READOUT_DEFAULT);
    });
    el.gridUnits.addEventListener('click', (event) => {
      const button = event.target.closest('.grid-unit');
      if (button) chooseGrid({ unit: Number(button.dataset.unit) });
    });
    el.gridMagnet.addEventListener('click', () => chooseGrid({ magnet: !store.grid.magnet }));
    el.modeSwitch.addEventListener('click', (event) => {
      const button = event.target.closest('.mode-btn');
      if (button) setView({ mode: button.dataset.mode });
    });
    el.scaleSwitch.addEventListener('click', (event) => {
      const button = event.target.closest('.scale-btn');
      if (button) setView({ scale: button.dataset.scale });
    });
    $('zoom-x-in').addEventListener('click', () => zoomBy('x', 1.25));
    $('zoom-x-out').addEventListener('click', () => zoomBy('x', 1 / 1.25));
    $('zoom-y-in').addEventListener('click', () => zoomBy('y', 1.2));
    $('zoom-y-out').addEventListener('click', () => zoomBy('y', 1 / 1.2));
    $('zoom-fit').addEventListener('click', fitToNotes);
    $('zoom-reset').addEventListener('click', resetZoom);
    $('oct-up').addEventListener('click', () => octaveStep(1));
    $('oct-down').addEventListener('click', () => octaveStep(-1));
    el.followBtn.addEventListener('click', () => {
      view.follow = !view.follow;
      applyViewControls();
    });
    el.btnSidebar.addEventListener('click', () => {
      const collapsed = el.workspace.classList.toggle('sidebar-collapsed');
      el.btnSidebar.setAttribute('aria-pressed', String(!collapsed));
    });
    // Ctrl + molette : zoom horizontal autour du curseur ; Ctrl + Maj + molette : zoom vertical. (Le pincement du pavé tactile arrive en Ctrl + molette.)
    el.roll.addEventListener(
      'wheel',
      (event) => {
        if (!(event.ctrlKey || event.metaKey)) return;
        event.preventDefault();
        const delta = event.deltaY || event.deltaX;
        const factor = Math.exp(-delta * (event.deltaMode === 1 ? 0.05 : 0.0022));
        zoomBy(event.shiftKey ? 'y' : 'x', factor, { x: event.clientX, y: event.clientY });
      },
      { passive: false }
    );
    if (typeof ResizeObserver === 'function') new ResizeObserver(() => applyLayout()).observe(el.roll);
    window.addEventListener('resize', applyLayout);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', (event) => endGesture(event, false));
    window.addEventListener('pointercancel', (event) => endGesture(event, true));

    el.vowelButtons.addEventListener('click', (event) => {
      const button = event.target.closest('.vowel-btn');
      if (button) chooseVowel(button.dataset.vowel);
    });
    el.btnNoteDelete.addEventListener('click', deleteSelectedNote);
    window.addEventListener('keydown', (event) => {
      if ($('screen-editor').hidden || document.querySelector('dialog[open]') || event.target.closest('input, textarea, select') || event.ctrlKey || event.metaKey || event.altKey) return;
      const track = store.getSelectedTrack();
      if (!isVowelTrack(track) || !selectedNoteId) return;
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        deleteSelectedNote();
      } else if (['a', 'e', 'i', 'o', 'u'].includes(event.key.toLowerCase())) {
        event.preventDefault();
        chooseVowel(event.key.toLowerCase());
      }
    });

    // Espace = lecture / pause. Une seule pression = une seule action :
    //  - on ignore les répétitions de la touche maintenue (event.repeat) et on attend son relâchement (spaceDown) ;
    //  - un battement minimum de 120 ms entre deux bascules (imperceptible pour un humain, bloque la mitraillette) ;
    //  - seuls les VRAIS champs de saisie gardent la barre espace pour eux (texte, nombre, zone de texte, liste) :
    //    un curseur (tempo), une case ou un bouton qui a le focus ne bloquent plus la lecture (c'était le bug du tempo) ;
    //  - keydown ET keyup sont neutralisés : le bouton qui a le focus ne reçoit pas de « clic » en plus.
    const TYPING = 'textarea, select, [contenteditable=""], [contenteditable="true"], input:not([type="range"]):not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]):not([type="file"])';
    let spaceDown = false;
    let lastToggleAt = 0;
    const spaceIsOurs = (event) => event.code === 'Space' && !$('screen-editor').hidden && !document.querySelector('dialog[open]') && !(event.target.closest && event.target.closest(TYPING));
    window.addEventListener('keydown', (event) => {
      if (!spaceIsOurs(event)) return;
      event.preventDefault();
      if (event.repeat || spaceDown) return;
      spaceDown = true;
      const now = performance.now();
      if (now - lastToggleAt < 120) return;
      lastToggleAt = now;
      togglePlayback();
    });
    window.addEventListener('keyup', (event) => {
      if (event.code !== 'Space') return;
      spaceDown = false;
      if (spaceIsOurs(event)) event.preventDefault();
    });
    window.addEventListener('blur', () => {
      spaceDown = false;
    });

    // Après un clic souris, on retire le focus des boutons : sinon Espace les « re-cliquerait ».
    document.addEventListener('click', (event) => {
      const button = event.target.closest('button');
      if (button && event.detail > 0) button.blur();
    });
  }

  /* ------------------------------------------------------------------ */
  /*  Démarrage                                                          */
  /* ------------------------------------------------------------------ */

  function showFatalError(message) {
    el.fatalError.textContent = message;
    el.fatalError.hidden = false;
  }

  function init() {
    if (typeof Tone === 'undefined') {
      showFatalError('Tone.js est introuvable : vérifie que le fichier vendor/Tone.js est bien présent.');
      return;
    }
    GB.instruments.load(); // instruments personnalisés sauvegardés dans ce navigateur
    store.reset();
    audio.init({ onStatusChange: renderTransport });
    setMode('free');
    clampGridToMode();
    renderGridUnits();
    bindEvents();
    renderAll();
    if (GB.gameUI) GB.gameUI.init();
    if (GB.soundsUI) GB.soundsUI.init(); // sons importés ajoutés aux instruments lors d'une visite précédente
    requestAnimationFrame(animatePlayhead);
    showScreen('home');
  }

  /** Fonctions partagées avec game-ui.js. */
  GB.ui = {
    el,
    renderVowelBar,
    showToast,
    showScreen,
    stashStudio,
    setMode,
    isGameMode,
    renderAll,
    renderTracks,
    renderInstrumentPicker,
    renderStageHeader,
    renderTempo,
    renderRoll,
    view,
    setView,
    zoomBy,
    setZoom,
    resetZoom,
    fitToNotes,
    octaveStep,
    applyLayout,
    changeBpm,
    togglePlayback,
    addStatusListener(listener) {
      statusListeners.push(listener);
    },
  };

  document.addEventListener('DOMContentLoaded', init);
})((window.GB = window.GB || {}));

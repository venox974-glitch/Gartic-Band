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
    quickInstrument: $('quick-instrument'),
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
    'Clique sur la grille pour poser UNE note (un clic = une note, même si tu maintiens). Attrape une note pour la déplacer, ' +
    'tire sa poignée de droite pour l\'allonger, clique dessus sans bouger pour l\'enlever. Choisis le pas de la grille ou garde <kbd>Alt</kbd> pour placer librement. ' +
    'Clique ou glisse dans la règle des temps pour placer la barre de lecture. <kbd>Espace</kbd> lance et met en pause. ' +
    'Zoom : boutons de zoom, <kbd>Ctrl</kbd> + molette (temps), <kbd>Ctrl</kbd> + <kbd>Maj</kbd> + molette (hauteur). Clique le clavier pour écouter une note. ' +
    'Trois modes : Baby (une gamme), Débutant (touches blanches), Expert (tout).';
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
  let clipboard = null; // copier-coller : notes copiées, positions relatives à la première
  let mouseOnRoll = null; // dernière position de la souris au-dessus de la grille (pour coller)
  let multi = { trackId: null, ids: new Set() }; // sélection de plusieurs notes (glisser une boîte, Maj + clic)
  let tool = 'pencil'; // outil actif : 'pencil' (poser / allonger) ou 'select' (sélectionner / déplacer)
  let selBarEl = null; // barre d'actions sous la sélection (reconstruite avec la grille)
  let selBarRaf = 0;
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
      const title = author ? author.name : track.name;
      const content =
        instrument.kind === 'audio'
          ? track.clip
            ? 'enregistrement ' + track.clip.duration.toFixed(1).replace('.', ',') + ' s'
            : 'pas encore enregistré'
          : plural(track.notes.length, 'note', 'notes');
      const details = instrument.label + ' · ' + content + (track.locked ? ' · verrouillée' : '');
      info.append(create('strong', null, title), create('small', null, details));
      main.append(info);
      row.append(main);

      if (!gameMode) {
        const mute = GB.icons.set(create('button', 'icon-btn'), track.muted ? 'mute' : 'volume');
        mute.type = 'button';
        mute.dataset.action = 'mute';
        mute.title = track.muted ? 'Réactiver le son de cette piste' : 'Couper le son de cette piste';
        mute.setAttribute('aria-label', mute.title);
        mute.setAttribute('aria-pressed', String(track.muted));

        const remove = GB.icons.set(create('button', 'icon-btn danger'), 'trash');
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

    const pickIds = GB.instruments.pickable();
    if (!pickIds.includes(track.instrumentId) && GB.INSTRUMENTS[track.instrumentId]) pickIds.push(track.instrumentId); // son déséquipé mais déjà utilisé par cette piste
    pickIds.forEach((instrumentId) => {
      const instrument = GB.INSTRUMENTS[instrumentId];
      const button = create('button', 'instrument-btn');
      button.type = 'button';
      button.dataset.instrument = instrumentId;
      button.disabled = track.locked;
      button.classList.toggle('active', instrumentId === track.instrumentId);
      button.setAttribute('aria-pressed', String(instrumentId === track.instrumentId));
      button.append(GB.icons.el(instrument.icon, 'ins-icon'), create('span', null, instrument.label));
      el.instrumentPicker.append(button);
    });
    if (GB.instrumentUI) GB.instrumentUI.renderPanel();
    renderQuickInstrument();
  }

  /** Sélecteur compact d'instrument (au-dessus du piano-roll) : change le timbre de la couche sans toucher aux notes. */
  function renderQuickInstrument() {
    const select = el.quickInstrument;
    if (!select) return;
    const track = store.getSelectedTrack();
    select.innerHTML = '';
    const ids = GB.instruments.pickable();
    const addGroup = (label, list) => {
      if (!list.length) return;
      const group = create('optgroup');
      group.label = label;
      list.forEach((id) => {
        const option = create('option', null, GB.INSTRUMENTS[id].label);
        option.value = id;
        group.append(option);
      });
      select.append(group);
    };
    addGroup('Instruments', ids.filter((id) => !GB.INSTRUMENTS[id].sample && !GB.INSTRUMENTS[id].custom));
    addGroup('Mes instruments', ids.filter((id) => GB.INSTRUMENTS[id].custom));
    addGroup('Mes sons', ids.filter((id) => GB.INSTRUMENTS[id].sample));
    if (track && !ids.includes(track.instrumentId) && GB.INSTRUMENTS[track.instrumentId]) {
      const extra = create('option', null, GB.INSTRUMENTS[track.instrumentId].label);
      extra.value = track.instrumentId;
      select.append(extra);
    }
    const make = create('option', null, 'Créer / modifier mes instruments…');
    make.value = '__synth';
    select.append(make);
    const more = create('option', null, 'Importer / gérer mes sons…');
    more.value = '__sounds';
    select.append(more);
    if (track) select.value = track.instrumentId;
    const inGame = isGameMode();
    select.disabled = !track || track.locked || (inGame && GB.game.state.phase !== 'compose');
  }

  function renderStageHeader() {
    const track = store.getSelectedTrack();
    if (!track) return;
    const instrument = GB.INSTRUMENTS[track.instrumentId];
    const author = isGameMode() && track.author ? GB.game.playerById(track.author) : null;
    el.stageName.textContent = author ? 'Ta couche' : track.name;
    GB.icons.set(el.stageInstrument, instrument.icon, instrument.label);
    el.stageChip.style.setProperty('--track-color', track.color);
    el.btnClear.disabled = track.locked || !store.hasContent(track.id);
    GB.icons.set(el.btnClear, 'trash', instrument.kind === 'audio' ? 'Effacer l\'enregistrement' : 'Effacer les notes');
    el.btnClear.title = instrument.kind === 'audio' ? 'Efface l\'enregistrement de cette piste' : 'Efface toutes les notes de ta couche';
    if (GB.gameUI) GB.gameUI.refreshActions();
  }

  function renderTempo() {
    const bpm = store.state.bpm;
    el.bpmSlider.min = CONFIG.BPM_MIN;
    el.bpmSlider.max = CONFIG.BPM_MAX;
    el.bpmSlider.value = bpm;
    el.bpmValue.textContent = bpm;
    // En partie, le tempo est celui de la chanson (choisi par son créateur à la préparation) : on ne le change plus.
    const fixed = isGameMode();
    el.bpmSlider.disabled = fixed;
    el.btnBpmDown.disabled = fixed || bpm <= CONFIG.BPM_MIN;
    el.btnBpmUp.disabled = fixed || bpm >= CONFIG.BPM_MAX;
    el.bpmSlider.title = fixed ? 'Le tempo de cette chanson a été choisi à la préparation' : '';
    if (GB.dock) GB.dock.refresh();
  }

  function renderTransport(status) {
    document.body.classList.toggle('is-playing', status === 'playing');
    document.body.classList.toggle('is-paused', status === 'paused');
    el.roll.classList.toggle('playing', status === 'playing');
    el.roll.classList.toggle('paused', status === 'paused');

    GB.icons.set(el.btnPlay, status === 'playing' ? 'pause' : 'play', status === 'playing' ? 'Pause' : status === 'paused' ? 'Reprendre' : 'Lecture');
    el.btnPlay.setAttribute('aria-label', status === 'playing' ? 'Pause' : 'Lecture');
    const mobilePause = $('lt-play');
    if (mobilePause) {
      const label = status === 'playing' ? 'Pause' : status === 'paused' ? 'Reprendre' : 'Lecture';
      mobilePause.innerHTML = GB.icons.svg(status === 'playing' ? 'pause' : 'play') + '<span class="lt-label">' + label + '</span>';
      mobilePause.setAttribute('aria-label', label);
      mobilePause.title = label;
      mobilePause.classList.toggle('is-on', status === 'playing');
    }
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

  /** Pas de la grille, nommé en valeurs de notes : 1/4 = un temps, 1/8 = un demi-temps, 1/16 = un quart de temps, 1/32 = un huitième de temps. */
  function unitLabel(unit) {
    if (unit === 1) return ['1/4', '1/4 : un repère par temps'];
    if (unit === 0.5) return ['1/8', '1/8 : un demi-temps'];
    if (unit === 0.25) return ['1/16', '1/16 : un quart de temps'];
    if (unit === 0.125) return ['1/32', '1/32 : un huitième de temps (très fin)'];
    return ['Triolet', 'Triolet : un temps coupé en trois'];
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
      '<b>' + GB.icons.svg(info.icon) + ' ' + hidden.length + (hidden.length > 1 ? ' notes de cette piste sont' : ' note de cette piste est') + ' hors du mode ' + info.label + '.</b> ' +
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
  const difficultyListeners = [];

  function setView(patch, silent) {
    const before = view.mode + view.scale;
    const beforeMode = view.mode;
    if (patch.mode && GB.MODES[patch.mode]) view.mode = patch.mode;
    if (patch.scale && GB.SCALES[patch.scale]) view.scale = patch.scale;
    if (view.mode + view.scale === before) return;
    if (view.mode !== beforeMode) difficultyListeners.forEach((listener) => listener(view.mode));
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
    if (!silent) showToast('Mode ' + info.label + ' — ' + info.help + (total ? ' (' + total + ' note' + (total > 1 ? 's' : '') + ' hors mode conservée' + (total > 1 ? 's' : '') + ')' : ''));
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
    updateSelectionBar();
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

  /** Texte de la plage de notes visible (ex. « Do3 – Si4 »), pour le menu Octaves. */
  function visibleRangeText() {
    const track = store.getSelectedTrack();
    if (!track || el.roll.hidden || !visibleRows.length || isDrumsTrack(track)) return '—';
    const size = layoutSizes();
    const bodyH = Math.max(1, el.roll.clientHeight - size.headH);
    const topIdx = Math.min(visibleRows.length - 1, Math.max(0, Math.floor(el.roll.scrollTop / size.rowH)));
    const botIdx = Math.min(visibleRows.length - 1, Math.max(topIdx, Math.ceil((el.roll.scrollTop + bodyH) / size.rowH) - 1));
    const name = (index) => GB.getRowLabel(track.instrumentId, visibleRows[visibleRows.length - 1 - index], track.settings);
    return name(botIdx) + ' – ' + name(topIdx);
  }

  /** Abandonne le geste en cours sans rien poser ni déplacer (ex. un 2e doigt arrive pour pincer). */
  function cancelGesture() {
    if (gesture && (gesture.kind === 'tap' || gesture.kind === 'box')) {
      clearGestureVisuals();
      gesture = null;
    }
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
    noteEl.classList.toggle('multi', multi.trackId === track.id && multi.ids.has(note.id));
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
      $('stage').classList.add('no-roll'); // piste voix : les outils de notes n'ont pas de sens
      el.modeNotice.hidden = true;
      selectedNoteId = null;
      renderVowelBar();
      return;
    }
    el.roll.hidden = false;
    $('stage').classList.remove('no-roll');
    if (!store.getNote(track.id, selectedNoteId)) selectedNoteId = null;
    if (multi.trackId !== track.id) multi = { trackId: track.id, ids: new Set() };
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
    flag.append(GB.icons.el('play', 'scrub-flag-label'));
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
    // Notes fantômes (en partie) : les notes des contributions déjà enregistrées, de la même famille de lignes (mélodie / batterie),
    // dessinées discrètement sous les notes de la couche en cours. Elles ne se touchent pas et ne sont jamais modifiées.
    const ghostTracks = isGameMode()
      ? otherTracks.filter(
          (other) =>
            GB.INSTRUMENTS[other.instrumentId].kind !== 'audio' &&
            GB.getRowCount(other.instrumentId) === GB.getRowCount(track.instrumentId) &&
            isDrumsTrack(other) === isDrumsTrack(track)
        )
      : [];
    const ghostedIds = new Set(ghostTracks.map((other) => other.id));
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
        const echoes = otherTracks.filter((other) => !ghostedIds.has(other.id) && store.hasNote(other.id, step, row));
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
    selBarEl = buildSelectionBar();
    notesLayerEl.append(selBarEl);
    noteEls = new Map();
    track.notes.forEach((note) => createNoteElement(track, note, false));

    const playhead = create('div', 'playhead');
    playhead.append(create('span', 'playhead-knob'));
    subgridEl = create('div', 'subgrid');
    hoverEl = create('div', 'hover-marker');
    hoverEl.hidden = true;
    notesLayerEl.insertBefore(hoverEl, notesLayerEl.firstChild);
    emptyHintEl = create('div', 'empty-hint');
    emptyHintEl.append(create('span', null, 'Clique sur la grille pour poser ta première note !'));
    const ghostLayer = create('div', 'ghost-layer');
    ghostLayer.setAttribute('aria-hidden', 'true');
    ghostTracks.forEach((other) => {
      other.notes.forEach((note) => {
        if (visibleRows.indexOf(note.row) < 0) return; // ligne non affichée : on ne la fait pas apparaître pour un fantôme
        const ghost = create('i', 'ghost-note');
        ghost.style.setProperty('--c', other.color);
        ghost.style.setProperty('--x', note.step);
        ghost.style.setProperty('--w', displayLength(other, note));
        ghost.style.setProperty('--y', topIndexOf(note.row));
        ghostLayer.append(ghost);
      });
    });
    body.append(gridEl, subgridEl, ghostLayer, notesLayerEl, playhead, emptyHintEl);
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
    updateSelectionBar();
    updateHistoryButtons();
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
    if (gesture && gesture.originEls) gesture.originEls.forEach((marker) => marker.remove());
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
      showToast('Cette couche est verrouillée');
      return;
    }
    audio.unlock(); // premier geste de l'utilisateur : le son est autorisé
    event.preventDefault();
    if (event.pointerType === 'touch' && !event.isPrimary) return; // un 2e doigt ne déclenche rien de plus
    if (tool === 'select') {
      beginSelectTool(event, track, noteEl);
      return;
    }
    if (noteEl && event.shiftKey && event.pointerType !== 'touch') {
      // Maj + clic sur une note : l'ajoute à la sélection (ou l'en retire), sans l'effacer ni la déplacer.
      toggleMulti(track, noteEl.dataset.noteId);
      return;
    }
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

  const TOUCH_UI = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const READOUT_DEFAULT = TOUCH_UI ? 'Touche pour poser une note · glisse pour défiler' : 'Maintiens Alt pour placer librement';

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
    GB.icons.set(el.gridMagnet, magnet ? 'magnet' : 'hand', magnet ? 'Aimant' : 'Libre');
    const forced = modeInfo().forceMagnet;
    el.gridMagnet.disabled = forced;
    el.gridMagnet.title = forced ? 'Mode Baby : les notes se calent toujours sur la grille' : 'Aimant : les notes se calent sur la grille. Garde Alt enfoncée pour placer librement.';
    el.gridUnits.classList.toggle('is-free', !magnet);
    el.roll.dataset.unit = String(unit);
    el.roll.classList.toggle('free-grid', !magnet);
    if (subgridEl) subgridEl.className = 'subgrid' + (magnet ? '' : ' faint');
    if (GB.dock) GB.dock.refresh();
  }

  function chooseGrid(patch) {
    if (modeInfo().forceMagnet && patch.magnet === false) return;
    store.setGrid(patch);
    applyGridView();
    applyLayout();
  }

  /** Repère sous le pointeur : une case de la TAILLE DE LA GRILLE CHOISIE (temps, demi, quart…) montre où la note serait posée. */
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
    const bypass = bypassOf(event);
    const step = placementAt(geometry, event.clientX, bypass);
    const row = visualRowAt(geometry, event.clientY);
    const track = store.getSelectedTrack();
    const snapped = store.grid.magnet && !bypass;
    hoverEl.hidden = false;
    hoverEl.classList.toggle('blocked', Boolean(track) && !rowAllowed(track, row));
    hoverEl.classList.toggle('free', !snapped);
    hoverEl.style.setProperty('--x', step);
    hoverEl.style.setProperty('--w', snapped ? Math.min(store.grid.unit, CONFIG.STEP_COUNT - step) : 0.1);
    hoverEl.style.setProperty('--y', topIndexOf(row));
    showReadout('Ici : ' + describeBeat(step));
  }

  /* ----- poser des notes (clic ou glisser sur des cellules vides) ----- */

  function beginPaint(event, track) {
    if (event.pointerType === 'touch') {
      // Au doigt : un TAP pose la note, mais un glissement fait défiler la grille (comportement natif du téléphone).
      // On attend donc le relâchement pour savoir lequel des deux c'est.
      gesture = {
        kind: 'tap',
        pointerId: event.pointerId,
        trackId: track.id,
        startX: event.clientX,
        startY: event.clientY,
        startAt: performance.now(),
        down: { clientX: event.clientX, clientY: event.clientY, altKey: false, pointerId: event.pointerId },
      };
      return;
    }
    // Souris / stylet : un clic = UNE note (posée au relâchement). Si on glisse avant de relâcher : une boîte de sélection.
    // Avec Maj, la boîte s'ajoute à la sélection existante et un simple clic ne pose rien.
    if (hoverEl) hoverEl.hidden = true;
    gesture = {
      kind: 'box',
      pointerId: event.pointerId,
      trackId: track.id,
      startX: event.clientX,
      startY: event.clientY,
      shift: event.shiftKey,
      moved: false,
      base: new Set(event.shiftKey && multi.trackId === track.id ? multi.ids : []),
      boxEl: null,
      down: { clientX: event.clientX, clientY: event.clientY, altKey: event.altKey, pointerId: event.pointerId },
    };
  }

  /* ----- Annuler / Rétablir (notes de la piste affichée) ----- */

  const HISTORY_MAX = 60;
  let history = new Map(); // id de piste -> { undo: [], redo: [], cur: { notes, inst }, sig }

  const notesSignature = (track) => JSON.stringify(track.notes.map((note) => [note.id, note.step, note.row, note.length, note.vowel || '']));
  const notesSnapshot = (track) => ({ notes: track.notes.map((note) => Object.assign({}, note)), inst: track.instrumentId });

  function historyOf(track) {
    let entry = history.get(track.id);
    if (!entry) {
      entry = { undo: [], redo: [], cur: notesSnapshot(track), sig: notesSignature(track) };
      history.set(track.id, entry);
    }
    return entry;
  }

  function resetHistory() {
    history = new Map();
    updateHistoryButtons();
  }

  function updateHistoryButtons() {
    const track = store.getSelectedTrack();
    const entry = track ? history.get(track.id) : null;
    const canUndo = Boolean(entry && entry.undo.length) && !track.locked;
    const canRedo = Boolean(entry && entry.redo.length) && !track.locked;
    [['lt-undo', canUndo], ['lt-redo', canRedo]].forEach(([id, on]) => {
      const button = $(id);
      if (button) button.disabled = !on;
    });
  }

  /** Après chaque geste ou clic : si les notes de la piste ont changé, l'état d'avant devient un pas d'« Annuler ». */
  function recordHistory() {
    const track = store.getSelectedTrack();
    if (!track || el.roll.hidden) return;
    const entry = historyOf(track);
    if (entry.cur.inst !== track.instrumentId) {
      // Autre instrument : les lignes ne correspondent plus, on repart d'un historique propre.
      history.delete(track.id);
      historyOf(track);
      updateHistoryButtons();
      return;
    }
    const sig = notesSignature(track);
    if (sig === entry.sig) {
      updateHistoryButtons();
      return;
    }
    entry.undo.push(entry.cur);
    if (entry.undo.length > HISTORY_MAX) entry.undo.shift();
    entry.redo = [];
    entry.cur = notesSnapshot(track);
    entry.sig = sig;
    updateHistoryButtons();
  }

  function stepHistory(direction) {
    const track = store.getSelectedTrack();
    if (!track || track.locked || el.roll.hidden || gesture) return;
    recordHistory();
    const entry = historyOf(track);
    const from = direction < 0 ? entry.undo : entry.redo;
    const to = direction < 0 ? entry.redo : entry.undo;
    if (!from.length) return;
    const target = from[from.length - 1];
    if (target.inst !== track.instrumentId) {
      resetHistory();
      return;
    }
    from.pop();
    to.push(entry.cur);
    entry.cur = target;
    track.notes.length = 0; // même tableau (l'audio le relit tel quel)
    target.notes.forEach((note) => track.notes.push(Object.assign({}, note)));
    entry.sig = notesSignature(track);
    selectedNoteId = null;
    multi = { trackId: track.id, ids: new Set() };
    renderRoll();
    refreshAfterNoteCountChange();
    renderVowelBar();
    updateHistoryButtons();
    showReadout(direction < 0 ? 'Annulé' : 'Rétabli');
  }

  /* ----- outils : Crayon / Sélection ----- */

  /**
   * Outil Sélection (souris ET doigt) :
   *  - sur une note : la sélectionne (au doigt, un tap ajoute / retire la note de la sélection) ; la glisser déplace la sélection ;
   *  - sur le vide : tracer une zone de sélection ; un simple tap / clic défait la sélection (aucune note n'est posée).
   * La poignée de droite allonge / raccourcit toujours la note, comme avec le Crayon.
   */
  function beginSelectTool(event, track, noteEl) {
    if (!noteEl) {
      if (hoverEl) hoverEl.hidden = true;
      gesture = {
        kind: 'box',
        pointerId: event.pointerId,
        trackId: track.id,
        startX: event.clientX,
        startY: event.clientY,
        shift: event.shiftKey,
        selectTool: true,
        moved: false,
        base: new Set(event.shiftKey && multi.trackId === track.id ? multi.ids : []),
        boxEl: null,
        down: { clientX: event.clientX, clientY: event.clientY, altKey: false, pointerId: event.pointerId },
      };
      return;
    }
    const id = noteEl.dataset.noteId;
    const touch = event.pointerType === 'touch';
    const wasSelected = multi.trackId === track.id && multi.ids.has(id);
    if (!wasSelected) { // toucher la poignée sélectionne aussi la note (sur téléphone, les notes sont étroites)
      const keep = event.shiftKey || touch;
      const ids = new Set(keep && multi.trackId === track.id ? multi.ids : []);
      ids.add(id);
      setMulti(track, ids);
    }
    beginNoteGesture(event, track, noteEl);
    if (gesture) Object.assign(gesture, { selectTool: true, touch, wasSelected });
  }

  function setTool(name) {
    tool = name === 'select' ? 'select' : 'pencil';
    el.roll.classList.toggle('tool-select', tool === 'select');
    [['lt-pencil', 'pencil'], ['lt-select', 'select']].forEach(([id, value]) => {
      const button = $(id);
      if (!button) return;
      button.classList.toggle('active', tool === value);
      button.setAttribute('aria-pressed', String(tool === value));
    });
    const hint = $('tool-hint');
    if (hint) {
      hint.textContent = tool === 'select'
        ? 'Touche une note ou trace une zone pour sélectionner · glisse la sélection pour la déplacer'
        : 'Touche la grille pour poser une note · tire la poignée de droite pour l\'allonger';
    }
  }

  /* ----- barre d'actions sous la sélection ----- */

  function buildSelectionBar() {
    const bar = create('div', 'sel-bar');
    bar.hidden = true;
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', 'Actions sur la sélection');
    const del = GB.icons.set(create('button', 'sel-btn sel-del'), 'trash', 'Supprimer');
    del.type = 'button';
    del.addEventListener('click', () => deleteMulti());
    const dup = GB.icons.set(create('button', 'sel-btn sel-dup'), 'copy', 'Copier / Coller');
    dup.type = 'button';
    dup.title = 'Duplique la sélection juste après sa dernière note';
    dup.addEventListener('click', () => duplicateMulti());
    bar.append(del, dup);
    bar.addEventListener('pointerdown', (event) => event.stopPropagation());
    return bar;
  }

  /** Place la barre sous la sélection (au-dessus si le bas est trop proche), toujours dans la zone visible de la grille. */
  function updateSelectionBar() {
    const count = multiCount();
    const ltTrack = store.getSelectedTrack();
    ['lt-dup', 'lt-del'].forEach((id) => {
      const button = $(id);
      if (button) button.disabled = count === 0 || !ltTrack || ltTrack.locked;
    });
    if (!selBarEl) return;
    const track = store.getSelectedTrack();
    const ids = track && multi.trackId === track.id ? Array.from(multi.ids).filter((id) => noteEls.has(id)) : [];
    if (!ids.length || track.locked || (gesture && gesture.kind === 'box' && gesture.moved) || el.roll.hidden) {
      selBarEl.hidden = true;
      return;
    }
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    ids.forEach((id) => {
      const node = noteEls.get(id);
      left = Math.min(left, node.offsetLeft);
      top = Math.min(top, node.offsetTop);
      right = Math.max(right, node.offsetLeft + node.offsetWidth);
      bottom = Math.max(bottom, node.offsetTop + node.offsetHeight);
    });
    selBarEl.hidden = false;
    const { labelW, headH } = rollMetrics();
    const visLeft = el.roll.scrollLeft;
    const visRight = visLeft + el.roll.clientWidth - labelW;
    selBarEl.classList.remove('stack');
    if (selBarEl.offsetWidth > visRight - visLeft - 8) selBarEl.classList.add('stack'); // écran étroit : les deux boutons s'empilent
    const width = selBarEl.offsetWidth;
    const height = selBarEl.offsetHeight;
    const visTop = el.roll.scrollTop;
    const visBottom = visTop + el.roll.clientHeight - headH;
    let x = (left + right) / 2 - width / 2;
    x = Math.max(visLeft + 4, Math.min(x, visRight - width - 4));
    let y = bottom + 6;
    if (y + height > visBottom - 2) y = top - height - 6;
    if (y < visTop + 2) y = Math.max(visTop + 2, visBottom - height - 4);
    selBarEl.style.left = Math.round(x) + 'px';
    selBarEl.style.top = Math.round(y) + 'px';
  }

  function scheduleSelectionBar() {
    if (selBarRaf) return;
    selBarRaf = requestAnimationFrame(() => {
      selBarRaf = 0;
      updateSelectionBar();
    });
  }

  /**
   * « Copier / Coller » : crée de NOUVELLES notes, copies de la sélection, juste après sa dernière note (sur la grille choisie),
   * avec les mêmes hauteurs, durées et écarts. Si la place est prise, tout le groupe glisse vers la droite d'un pas de grille
   * jusqu'à tenir sans rien écraser ni raccourcir. Les copies deviennent la sélection ; les originales ne bougent pas.
   */
  function duplicateMulti() {
    const track = store.getSelectedTrack();
    if (!track || track.locked || multi.trackId !== track.id) return false;
    const notes = track.notes.filter((note) => multi.ids.has(note.id)).sort((a, b) => a.step - b.step || a.row - b.row);
    if (notes.length === 0) return false;
    const resizable = GB.INSTRUMENTS[track.instrumentId].resizable;
    const firstStep = notes[0].step;
    const lastEnd = Math.max(...notes.map((note) => note.step + store.lengthOf(track, note)));
    const span = lastEnd - firstStep;
    const grid = store.grid.magnet ? store.grid.unit : 0.25;
    const anchor = store.grid.magnet ? Math.ceil(lastEnd / grid - 1e-6) * grid : lastEnd;
    let copies = null;
    for (let start = anchor; start + span <= CONFIG.STEP_COUNT + 1e-6; start += grid) {
      const delta = start - firstStep;
      const added = [];
      let fits = true;
      for (const note of notes) {
        const copy = store.addNote(track.id, note.step + delta, note.row, note.length, note.vowel);
        if (copy) added.push(copy);
        if (!copy || (resizable && Math.abs(copy.length - note.length) > 1e-6)) {
          fits = false;
          break;
        }
      }
      if (fits) {
        copies = added;
        break;
      }
      added.forEach((copy) => store.removeNote(track.id, copy.id)); // pas assez de place ici : on annule et on essaie un cran plus loin
    }
    if (!copies) {
      showToast('Pas de place après la sélection : déplace-la ou raccourcis-la d\'abord.');
      return false;
    }
    copies.forEach((copy) => createNoteElement(track, copy, true));
    refreshDrumWidths(track);
    refreshAfterNoteCountChange();
    renderVowelBar();
    audio.preview(track.id, copies[0].row, copies[0].length, copies[0]);
    setMulti(track, copies.map((copy) => copy.id)); // la copie est sélectionnée : on peut la glisser tout de suite
    const { labelW } = rollMetrics();
    const right = Math.max(...copies.map((copy) => noteEls.get(copy.id).offsetLeft + noteEls.get(copy.id).offsetWidth));
    const left = Math.min(...copies.map((copy) => noteEls.get(copy.id).offsetLeft));
    const visibleWidth = el.roll.clientWidth - labelW;
    if (right > el.roll.scrollLeft + visibleWidth - 8) el.roll.scrollLeft = Math.max(0, Math.min(left - 24, right - visibleWidth + 24));
    updateSelectionBar();
    showReadout(copies.length + (copies.length > 1 ? ' notes copiées' : ' note copiée') + ' · glisse-les où tu veux');
    return true;
  }

  /* ----- sélection de plusieurs notes ----- */

  function multiCount() {
    return multi.trackId === (store.getSelectedTrack() || {}).id ? Array.from(multi.ids).filter((id) => noteEls.has(id)).length : 0;
  }

  function refreshMulti(announce) {
    noteEls.forEach((noteEl, id) => noteEl.classList.toggle('multi', multi.ids.has(id)));
    updateSelectionBar();
    if (announce) {
      const count = multiCount();
      showReadout(count > 0 ? count + (count > 1 ? ' notes sélectionnées' : ' note sélectionnée') + ' · Suppr pour effacer · Échap pour désélectionner' : READOUT_DEFAULT);
    }
  }

  function clearMulti(announce) {
    if (multi.ids.size === 0) return;
    multi = { trackId: multi.trackId, ids: new Set() };
    refreshMulti(announce);
  }

  function setMulti(track, ids) {
    multi = { trackId: track.id, ids: new Set(ids) };
    refreshMulti(true);
  }

  function toggleMulti(track, noteId) {
    const ids = new Set(multi.trackId === track.id ? multi.ids : []);
    if (ids.has(noteId)) ids.delete(noteId);
    else ids.add(noteId);
    setMulti(track, ids);
  }

  function deleteMulti() {
    const track = store.getSelectedTrack();
    if (!track || track.locked || multi.trackId !== track.id || multi.ids.size === 0) return;
    Array.from(multi.ids).forEach((id) => {
      if (store.removeNote(track.id, id)) removeNoteElement(id);
    });
    if (selectedNoteId && !store.getNote(track.id, selectedNoteId)) selectedNoteId = null;
    multi = { trackId: track.id, ids: new Set() };
    refreshDrumWidths(track);
    refreshAfterNoteCountChange();
    renderVowelBar();
    updateSelectionBar();
    showReadout(READOUT_DEFAULT);
  }

  /** Ctrl + C : mémorise les notes sélectionnées (hauteur, durée, voyelle) et leur écart de temps avec la première (la plus à gauche). */
  function copyMulti() {
    const track = store.getSelectedTrack();
    if (!track || multi.trackId !== track.id) return false;
    const notes = track.notes.filter((note) => multi.ids.has(note.id));
    if (notes.length === 0) return false;
    const firstStep = Math.min(...notes.map((note) => note.step));
    clipboard = { notes: notes.map((note) => ({ dStep: note.step - firstStep, row: note.row, length: note.length, vowel: note.vowel })) };
    showReadout(notes.length + (notes.length > 1 ? ' notes copiées' : ' note copiée') + ' · Ctrl + V pour coller à l\'endroit de la souris');
    return true;
  }

  /** Ctrl + V : colle les mêmes notes (même hauteur, même durée) ; seule la position horizontale suit la souris : la première note tombe sous la souris. */
  function pasteClipboard() {
    const track = store.getSelectedTrack();
    if (!clipboard || !track || track.locked || el.roll.hidden) return false;
    const geometry = gridGeometry();
    const inside = mouseOnRoll && gridEl && mouseOnRoll.clientX >= geometry.rect.left && mouseOnRoll.clientX <= geometry.rect.right;
    if (!inside) {
      showToast('Place la souris sur la grille, puis Ctrl + V.');
      return false;
    }
    const anchorStep = placementAt(geometry, mouseOnRoll.clientX, bypassOf(mouseOnRoll));
    const added = [];
    let skipped = 0;
    clipboard.notes.forEach((item) => {
      const note = rowAllowed(track, item.row) ? store.addNote(track.id, anchorStep + item.dStep, item.row, item.length, item.vowel) : null;
      if (note) {
        createNoteElement(track, note, true);
        added.push(note);
      } else {
        skipped += 1;
      }
    });
    if (added.length === 0) {
      showToast('Rien n\'a pu être collé ici (place occupée ou hors de la grille).');
      return false;
    }
    refreshDrumWidths(track);
    refreshAfterNoteCountChange();
    renderVowelBar();
    audio.preview(track.id, added[0].row, added[0].length, added[0]);
    setMulti(track, added.map((note) => note.id)); // les notes collées deviennent la sélection
    showReadout(added.length + (added.length > 1 ? ' notes collées' : ' note collée') + (skipped ? ' · ' + skipped + ' sans place' : ''));
    return true;
  }

  /** Dessine / met à jour la boîte de sélection et choisit les notes qu'elle touche. */
  function updateBox(event) {
    const geometry = gridGeometry();
    const x1 = Math.max(geometry.rect.left, Math.min(gesture.startX, event.clientX));
    const x2 = Math.min(geometry.rect.right, Math.max(gesture.startX, event.clientX));
    const y1 = Math.max(geometry.rect.top, Math.min(gesture.startY, event.clientY));
    const y2 = Math.min(geometry.rect.bottom, Math.max(gesture.startY, event.clientY));
    if (!gesture.boxEl) {
      gesture.boxEl = create('div', 'selection-box');
      notesLayerEl.append(gesture.boxEl);
    }
    Object.assign(gesture.boxEl.style, { left: x1 - geometry.rect.left + 'px', top: y1 - geometry.rect.top + 'px', width: Math.max(0, x2 - x1) + 'px', height: Math.max(0, y2 - y1) + 'px' });
    const ids = new Set(gesture.base);
    noteEls.forEach((noteEl, id) => {
      const r = noteEl.getBoundingClientRect();
      if (r.left < x2 && r.right > x1 && r.top < y2 && r.bottom > y1) ids.add(id);
    });
    const track = store.getTrack(gesture.trackId);
    if (track) setMulti(track, ids);
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
      group: null, // si la note attrapée fait partie d'une sélection : toutes les notes choisies bougent ensemble
    };
    if (!isResize && multi.trackId === track.id && multi.ids.has(note.id)) {
      const members = track.notes.filter((candidate) => multi.ids.has(candidate.id) && noteEls.has(candidate.id));
      if (members.length > 1) {
        gesture.group = members.map((member) => ({ id: member.id, step: member.step, row: member.row }));
        gesture.originEls = [];
      }
    }
  }

  function startVisibleDrag(track, note) {
    gesture.moved = true;
    el.roll.classList.add('is-dragging');
    gesture.noteEl.classList.add('dragging');
    if (gesture.kind === 'move' && gesture.group) {
      // Sélection : un repère en pointillés par note, et toutes les notes choisies passent « en vol »
      gesture.group.forEach((member) => {
        const memberEl = noteEls.get(member.id);
        const memberNote = store.getNote(track.id, member.id);
        if (!memberEl || !memberNote) return;
        memberEl.classList.add('dragging');
        const marker = create('div', 'note-origin');
        marker.style.setProperty('--x', member.step);
        marker.style.setProperty('--w', store.lengthOf(track, memberNote));
        marker.style.setProperty('--y', topIndexOf(member.row));
        notesLayerEl.insertBefore(marker, notesLayerEl.firstChild);
        gesture.originEls.push(marker);
      });
    } else if (gesture.kind === 'move') {
      // Repère en pointillés à l'emplacement d'origine
      const origin = create('div', 'note-origin');
      origin.style.setProperty('--x', gesture.origin.step);
      origin.style.setProperty('--w', store.lengthOf(track, gesture.origin));
      origin.style.setProperty('--y', topIndexOf(gesture.origin.row));
      notesLayerEl.insertBefore(origin, notesLayerEl.firstChild);
      gesture.originEl = origin;
    }
  }

  /**
   * Lignes de destination d'une sélection glissée. `targetRow` = ligne visée pour la note attrapée.
   * Les notes dans le mode se déplacent d'autant de lignes DU MODE que la note attrapée ; celles déjà hors mode
   * gardent l'écart brut. L'écart est réduit si une note sortirait des lignes. Renvoie [{ id, row }].
   */
  function groupTargets(track, grabbed, targetRow) {
    const count = GB.getRowCount(track.instrumentId);
    const allowed = [];
    for (let row = 0; row < count; row += 1) if (rowAllowed(track, row)) allowed.push(row);
    const members = gesture.group.map((member) => store.getNote(track.id, member.id)).filter(Boolean);
    const grabbedIndex = allowed.indexOf(grabbed.row);
    const targetIndex = allowed.indexOf(targetRow);
    const modeSteps = grabbedIndex >= 0 && targetIndex >= 0;
    let shift = modeSteps ? targetIndex - grabbedIndex : targetRow - grabbed.row;
    const rowsFor = (amount) => {
      const grabbedTo = modeSteps ? allowed[grabbedIndex + amount] : grabbed.row + amount;
      return members.map((member) => {
        const index = allowed.indexOf(member.row);
        let row;
        if (modeSteps && index >= 0) row = allowed[index + amount];
        else row = grabbedTo === undefined ? undefined : member.row + (grabbedTo - grabbed.row);
        return { id: member.id, row };
      });
    };
    let rows = rowsFor(shift);
    while (shift !== 0 && rows.some((entry) => entry.row === undefined || entry.row < 0 || entry.row >= count)) {
      shift += shift > 0 ? -1 : 1;
      rows = rowsFor(shift);
    }
    return rows.every((entry) => entry.row !== undefined) ? rows : null;
  }

  function moveNoteTo(event, track, note) {
    const geometry = gridGeometry();
    const targetStep = nearestStep(columnsAt(geometry, event.clientX) - gesture.grabOffset, bypassOf(event));
    let targetRow = visualRowAt(geometry, event.clientY);
    // Une note « hors mode » reste sur sa ligne tant qu'on ne la déplace pas vers une autre ; sinon on vise une ligne proposée.
    if (targetRow !== gesture.origin.row && !rowAllowed(track, targetRow)) targetRow = nearestAllowedRow(track, targetRow);
    if (gesture.group) {
      // Sélection : la note attrapée mène. Les notes du mode descendent du même nombre de lignes DU MODE
      // (les lignes « hors mode » ne comptent pas) ; les notes déjà hors mode gardent le même écart brut.
      const moves = groupTargets(track, note, targetRow);
      if (moves && store.moveNotes(track.id, moves, targetStep - note.step)) {
        gesture.group.forEach((member) => {
          const memberNote = store.getNote(track.id, member.id);
          const memberEl = noteEls.get(member.id);
          if (memberNote && memberEl) positionNoteElement(memberEl, track, memberNote);
        });
        refreshDrumWidths(track);
        highlightTarget(track, note);
        updateSelectionBar();
        if (note.row !== gesture.lastRow) {
          gesture.lastRow = note.row;
          audio.preview(track.id, note.row, note.length);
        }
      }
      showTip(gesture.noteEl, describePosition(track, note));
      return;
    }
    if (store.moveNote(track.id, note.id, targetStep, targetRow)) {
      positionNoteElement(gesture.noteEl, track, note);
      refreshDrumWidths(track);
      highlightTarget(track, note);
      updateSelectionBar();
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
      updateSelectionBar();
    }
    showTip(gesture.noteEl, GB.formatLength(note.length));
  }

  /** Pendant un geste, tenir le pointeur près du bord de la grille la fait défiler (utile quand on a zoomé). */
  function startAutoScroll() {
    if (autoScrollRaf) return;
    const tick = () => {
      autoScrollRaf = 0;
      if (!gesture || !lastPointer || el.roll.hidden) return;
      if (!gesture.moved) {
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
    if (gesture.kind === 'tap') {
      // Le doigt a bougé : ce n'est plus un tap, c'est un défilement.
      if (Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY) > 10) gesture = null;
      return;
    }
    if (gesture.kind === 'placed') return; // la note est déjà posée : rester appuyé ne pose rien de plus
    if (gesture.kind === 'box') {
      if (!gesture.moved && Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY) < 4) return;
      gesture.moved = true;
      updateBox(event);
      return;
    }
    lastPointer = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, altKey: event.altKey };
    startAutoScroll();
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
    if (finished.kind === 'tap') {
      const track = store.getTrack(finished.trackId);
      gesture = null;
      // Un doigt posé sans bouger = UNE note au relâchement, quelle que soit la durée de l'appui.
      if (!cancelled && track) {
        gesture = { kind: 'placed', pointerId: finished.pointerId, tried: new Set() };
        paintAt(track, finished.down);
        gesture = null;
      }
      return;
    }
    if (finished.kind === 'placed') {
      gesture = null;
      return;
    }
    if (finished.kind === 'box') {
      gesture = null;
      if (finished.boxEl) finished.boxEl.remove();
      if (finished.moved || cancelled) {
        updateSelectionBar();
        return; // la sélection reste telle que dessinée
      }
      const track = store.getTrack(finished.trackId);
      if (!track || finished.shift) {
        updateSelectionBar();
        return; // Maj + simple clic sur le vide : on ne pose rien
      }
      clearMulti(true);
      if (finished.selectTool) return; // outil Sélection : un tap dans le vide défait la sélection, sans poser de note
      gesture = { kind: 'placed', pointerId: finished.pointerId, tried: new Set() };
      paintAt(track, finished.down);
      gesture = null;
      return;
    }
    {
      const track = store.getTrack(finished.trackId);
      const note = store.getNote(finished.trackId, finished.noteId);
      if (cancelled && finished.moved && track && note && finished.group) {
        // Geste interrompu : toutes les notes de la sélection retrouvent leur place d'origine.
        finished.group.forEach((member) => {
          const memberNote = store.getNote(track.id, member.id);
          const memberEl = noteEls.get(member.id);
          if (!memberNote) return;
          memberNote.step = member.step;
          memberNote.row = member.row;
          if (memberEl) positionNoteElement(memberEl, track, memberNote);
        });
        refreshDrumWidths(track);
      } else if (!finished.moved && finished.kind === 'move' && !cancelled && finished.group) {
        // Simple clic sur une note d'une sélection : on ne l'efface pas (on glisse la sélection ; un clic dans le vide la défait).
        // Outil Sélection au doigt : un tap sur une note déjà choisie la retire de la sélection.
        if (finished.selectTool && finished.touch && finished.wasSelected) {
          multi.ids.delete(finished.noteId);
          refreshMulti(true);
        }
      } else if (!finished.moved && finished.kind === 'move' && !cancelled && finished.selectTool) {
        // Outil Sélection : toucher une note la sélectionne, ne l'efface jamais.
        if (finished.touch && finished.wasSelected) {
          multi.ids.delete(finished.noteId);
          refreshMulti(true);
        }
      } else if (cancelled && finished.moved && track && note) {
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
          multi.ids.delete(note.id);
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
    resetHistory();
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
    showToast('Pose ta première note sur la grille');
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
    showToast('Nouvelle page blanche');
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
    showToast('La révélation est contrôlée par l\'hôte : pas de pause individuelle.');
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
    if (!track || track.locked || !GB.INSTRUMENTS[instrumentId]) return;
    if (isGameMode()) {
      if (!GB.game.changeInstrument(instrumentId)) return renderQuickInstrument();
    } else if (!store.setInstrument(track.id, instrumentId)) return renderQuickInstrument();
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

    if (el.quickInstrument) {
      el.quickInstrument.addEventListener('change', () => {
        const value = el.quickInstrument.value;
        if (value === '__synth') {
          renderQuickInstrument();
          const current = store.getSelectedTrack();
          if (GB.synthUI) GB.synthUI.open(current && GB.INSTRUMENTS[current.instrumentId] && GB.INSTRUMENTS[current.instrumentId].custom ? current.instrumentId : null);
          return;
        }
        if (value === '__sounds') {
          renderQuickInstrument();
          if (GB.soundsUI) GB.soundsUI.open();
          return;
        }
        changeInstrument(value);
      });
    }
    el.instrumentPicker.addEventListener('click', (event) => {
      const button = event.target.closest('[data-instrument]');
      if (button) changeInstrument(button.dataset.instrument);
    });

    el.roll.addEventListener('pointerdown', pointerDownOnRoll);
    $('lt-undo').addEventListener('click', () => stepHistory(-1));
    $('lt-redo').addEventListener('click', () => stepHistory(1));
    $('lt-pencil').addEventListener('click', () => setTool('pencil'));
    $('lt-select').addEventListener('click', () => setTool('select'));
    $('lt-dup').addEventListener('click', () => duplicateMulti());
    $('lt-del').addEventListener('click', () => deleteMulti());
    const validate = $('btn-validate');
    const ready = $('lt-ready');
    ready.addEventListener('click', () => validate.click());
    const mirrorReady = () => {
      ready.hidden = validate.hidden;
      ready.disabled = validate.disabled;
      ready.title = ready.ariaLabel = validate.textContent.trim() || 'Prêt';
    };
    new MutationObserver(mirrorReady).observe(validate, { attributes: true, childList: true, characterData: true, subtree: true });
    mirrorReady();
    // Annuler / Rétablir : on regarde si les notes ont changé après chaque geste ou clic.
    const afterAction = () => setTimeout(recordHistory, 0);
    window.addEventListener('pointerup', afterAction);
    window.addEventListener('click', afterAction);
    window.addEventListener('keyup', afterAction);
    window.addEventListener('keydown', (event) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || $('screen-editor').hidden || document.querySelector('dialog[open]') || event.target.closest('input, textarea, select')) return;
      const key = event.key.toLowerCase();
      if (key !== 'z' && key !== 'y') return;
      event.preventDefault();
      stepHistory(key === 'y' || event.shiftKey ? 1 : -1);
    });
    setTool('pencil');
    el.roll.addEventListener('scroll', scheduleSelectionBar, { passive: true });
    const dockPlay = $('lt-play');
    if (dockPlay) dockPlay.addEventListener('click', togglePlayback); // même lecture / pause que le bouton principal et la barre espace
    if (el.gridReadout) el.gridReadout.textContent = READOUT_DEFAULT;
    el.roll.addEventListener('pointermove', onRollHover);
    el.roll.addEventListener('pointerleave', () => {
      mouseOnRoll = null;
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
    // Téléphone en paysage : le panneau des pistes est replié au départ pour donner toute la place à la grille (bouton ☰ pour l'ouvrir).
    if (window.matchMedia('(max-width: 1100px), (max-height: 520px)').matches) {
      el.workspace.classList.add('sidebar-collapsed');
      el.btnSidebar.setAttribute('aria-pressed', 'false');
    }
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
    el.roll.addEventListener('pointermove', (event) => {
      mouseOnRoll = { clientX: event.clientX, clientY: event.clientY, altKey: event.altKey };
    });
    // Ctrl + C / Ctrl + V (Cmd sur Mac) : copier les notes sélectionnées, les coller sous la souris.
    window.addEventListener('keydown', (event) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
      const key = event.key.toLowerCase();
      if ((key !== 'c' && key !== 'v') || $('screen-editor').hidden || document.querySelector('dialog[open]') || event.target.closest('input, textarea, select')) return;
      const handled = key === 'c' ? copyMulti() : pasteClipboard();
      if (handled) event.preventDefault();
    });
    window.addEventListener('keydown', (event) => {
      if ($('screen-editor').hidden || document.querySelector('dialog[open]') || event.target.closest('input, textarea, select') || event.ctrlKey || event.metaKey || event.altKey) return;
      if (multiCount() > 0) {
        if (event.key === 'Escape') {
          event.preventDefault();
          clearMulti(true);
          return;
        }
        if (event.key === 'Delete' || event.key === 'Backspace') {
          event.preventDefault();
          deleteMulti();
          return;
        }
      }
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
    const spaceIsOurs = (event) => event.code === 'Space' && !$('screen-editor').hidden && !document.querySelector('dialog[open]') && !document.body.classList.contains('stn-active') && !(event.target.closest && event.target.closest(TYPING));
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
    /** Sélection de plusieurs notes (pour un futur copier-coller) : { trackId, noteIds }. */
    getSelection: () => ({ trackId: multi.trackId, noteIds: Array.from(multi.ids).filter((id) => noteEls.has(id)) }),
    clearSelection: () => clearMulti(true),
    renderVowelBar,
    showToast,
    showScreen,
    stashStudio,
    startComposition,
    setMode,
    isGameMode,
    renderAll,
    renderTracks,
    renderInstrumentPicker,
    renderQuickInstrument,
    changeInstrument,
    getDifficulty: () => view.mode,
    setDifficulty(mode) {
      setView({ mode }, true);
    },
    onDifficulty(listener) {
      difficultyListeners.push(listener);
    },
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
    visibleRangeText,
    cancelGesture,
    setTool,
    getTool: () => tool,
    /** Notes ajoutées EN DIRECT (Speech to Note) : la note existe déjà dans le store, on ne fait que l'afficher / la mettre à jour. */
    liveNote: {
      add(track, note) {
        createNoteElement(track, note, true);
        updateEmptyHint();
      },
      update(track, note) {
        const noteEl = noteEls.get(note.id);
        if (noteEl) positionNoteElement(noteEl, track, note);
      },
      remove: removeNoteElement,
      finish() {
        refreshAfterNoteCountChange();
        recordHistory();
      },
    },
    stepHistory,
    isGameMode,
    applyLayout,
    changeBpm,
    togglePlayback,
    addStatusListener(listener) {
      statusListeners.push(listener);
    },
  };

  document.addEventListener('DOMContentLoaded', init);
})((window.GB = window.GB || {}));

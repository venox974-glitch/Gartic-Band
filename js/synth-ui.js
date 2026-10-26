/**
 * GARTIC BANDE — l'éditeur d'instruments personnalisés (« Mes instruments »).
 *
 *   GB.synthUI.open(instrumentId?)   ouvre la fenêtre : créer un instrument, ou modifier / dupliquer / supprimer l'un des tiens
 *
 * La liste des réglages vient de js/synth.js (GB.synth.FIELDS / GROUPS) : en ajouter un là le fait apparaître ici.
 * Un instrument est enregistré dans ce navigateur (localStorage) ; en ligne, il part avec les contributions
 * (les autres joueurs l'entendent comme toi, sans rien installer).
 */
(function (GB) {
  'use strict';

  const { store, audio, synth } = GB;
  const ui = GB.ui;

  function create(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  const MELODY = [0, 4, 7, 4, 9, 7].map((offset) => GB.PREVIEW_ROW + offset);

  const state = { editingId: null, values: null, icon: 'knob' };
  let dlg = null;
  const ui_ = {}; // éléments de la fenêtre
  let groupWidgets = []; // { update(values) } de chaque section de curseurs
  let previewTimer = 0;

  /* ------------------------------------------------------------------ */
  /*  Forme d'onde : dessin et barres d'harmoniques                      */
  /* ------------------------------------------------------------------ */

  /** Une période de l'onde (échantillons entre -1 et 1) pour l'affichage. */
  function waveSamples(values, count) {
    const out = [];
    for (let i = 0; i < count; i += 1) {
      const t = i / count;
      let v = 0;
      switch (values.wave) {
        case 'sine':
          v = Math.sin(2 * Math.PI * t);
          break;
        case 'triangle':
          v = 1 - 4 * Math.abs(Math.round(t - 0.25) - (t - 0.25));
          break;
        case 'square':
          v = t < 0.5 ? 1 : -1;
          break;
        case 'sawtooth':
          v = 2 * (t - Math.floor(t + 0.5));
          break;
        default:
          values.harmonics.forEach((amplitude, index) => {
            v += amplitude * Math.sin(2 * Math.PI * (index + 1) * t);
          });
      }
      out.push(v);
    }
    const peak = Math.max(0.0001, ...out.map(Math.abs));
    return out.map((v) => v / peak);
  }

  function drawScope() {
    const canvas = ui_.scope;
    const context = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    context.clearRect(0, 0, width, height);
    context.fillStyle = '#f3efff';
    context.fillRect(0, 0, width, height);
    context.strokeStyle = 'rgba(32, 18, 63, 0.18)';
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(0, height / 2);
    context.lineTo(width, height / 2);
    context.stroke();
    const samples = waveSamples(state.values, width);
    context.strokeStyle = '#20123f';
    context.lineWidth = 3;
    context.lineJoin = 'round';
    context.beginPath();
    samples.forEach((v, index) => {
      const y = height / 2 - v * (height / 2 - 6);
      if (index === 0) context.moveTo(index, y);
      else context.lineTo(index, y);
    });
    context.stroke();
  }

  function refreshHarmonics() {
    const drawn = state.values.wave === 'drawn';
    ui_.harmonics.classList.toggle('is-off', !drawn);
    ui_.harmonicsHint.textContent = drawn
      ? 'Tire les barres vers le haut ou le bas : chaque barre est une harmonique (1 = le son de base, 2 = une octave plus haut, 3 = une quinte au-dessus…).'
      : 'Choisis « Dessinée » comme forme d\'onde (ou un modèle ci-dessous) pour dessiner ton propre timbre.';
    ui_.bars.forEach((bar, index) => {
      const value = state.values.harmonics[index];
      bar.style.setProperty('--v', value);
      bar.setAttribute('aria-valuenow', String(Math.round(value * 100)));
    });
  }

  const PRESETS = [
    { label: 'Sinus', make: () => [1] },
    { label: 'Scie', make: (i) => 1 / (i + 1) },
    { label: 'Carré', make: (i) => ((i + 1) % 2 ? 1 / (i + 1) : 0) },
    { label: 'Triangle', make: (i) => ((i + 1) % 2 ? 1 / ((i + 1) * (i + 1)) : 0) },
    { label: 'Orgue', make: (i) => [1, 0.75, 0, 0.55, 0, 0, 0, 0.35][i] || 0 },
    { label: 'Nasal', make: (i) => (i === 0 ? 0.5 : i >= 2 && i <= 4 ? 1 : i <= 8 ? 0.35 : 0) },
    { label: 'Cloche', make: (i) => [1, 0, 0, 0.7, 0, 0.5, 0, 0, 0.4, 0, 0, 0.3, 0, 0, 0.2, 0][i] || 0 },
    { label: 'Hasard', make: () => Math.random() ** 1.5 },
  ];

  function applyPreset(preset) {
    state.values.harmonics = synth.normalize({ harmonics: Array.from({ length: synth.HARMONICS }, (unused, i) => preset.make(i) || 0) }).harmonics;
    state.values.wave = 'drawn';
    refreshAll(true);
    changed();
  }

  function buildHarmonics() {
    const box = create('div', 'harm');
    const bars = create('div', 'harm-bars');
    bars.setAttribute('role', 'group');
    bars.setAttribute('aria-label', 'Harmoniques');
    ui_.bars = [];
    for (let index = 0; index < synth.HARMONICS; index += 1) {
      const bar = create('div', 'harm-bar');
      bar.setAttribute('role', 'slider');
      bar.setAttribute('aria-label', 'Harmonique ' + (index + 1));
      bar.setAttribute('aria-valuemin', '0');
      bar.setAttribute('aria-valuemax', '100');
      bar.tabIndex = 0;
      bar.append(create('span', 'harm-fill'), create('small', 'harm-n', String(index + 1)));
      bar.addEventListener('keydown', (event) => {
        const delta = event.key === 'ArrowUp' || event.key === 'ArrowRight' ? 0.05 : event.key === 'ArrowDown' || event.key === 'ArrowLeft' ? -0.05 : 0;
        if (!delta) return;
        event.preventDefault();
        setHarmonic(index, state.values.harmonics[index] + delta, true);
      });
      ui_.bars.push(bar);
      bars.append(bar);
    }
    let dragging = false;
    const setFromPointer = (event) => {
      const rect = bars.getBoundingClientRect();
      const index = Math.min(synth.HARMONICS - 1, Math.max(0, Math.floor(((event.clientX - rect.left) / rect.width) * synth.HARMONICS)));
      const value = 1 - (event.clientY - rect.top) / (rect.height - 18); // les 18 px du bas portent le numéro
      setHarmonic(index, value, false);
    };
    bars.addEventListener('pointerdown', (event) => {
      dragging = true;
      bars.setPointerCapture(event.pointerId);
      event.preventDefault();
      setFromPointer(event);
    });
    bars.addEventListener('pointermove', (event) => {
      if (dragging) setFromPointer(event);
    });
    const stop = () => {
      if (!dragging) return;
      dragging = false;
      changed();
    };
    bars.addEventListener('pointerup', stop);
    bars.addEventListener('pointercancel', stop);

    const presets = create('div', 'harm-presets');
    PRESETS.forEach((preset) => {
      const button = create('button', 'chip', preset.label);
      button.type = 'button';
      button.addEventListener('click', () => applyPreset(preset));
      presets.append(button);
    });
    ui_.harmonicsHint = create('p', 'synth-help');
    box.append(ui_.harmonicsHint, bars, presets);
    ui_.harmonics = box;
    return box;
  }

  function setHarmonic(index, value, announce) {
    const next = Math.min(1, Math.max(0, Math.round(value * 100) / 100));
    const list = state.values.harmonics.slice();
    list[index] = next;
    if (list.every((entry) => entry === 0)) list[0] = 1;
    state.values.harmonics = list;
    if (state.values.wave !== 'drawn') {
      state.values.wave = 'drawn'; // toucher une barre = vouloir une forme dessinée
      groupWidgets.forEach((widget) => widget.update(state.values));
    }
    refreshHarmonics();
    drawScope();
    if (announce) changed();
  }

  /* ------------------------------------------------------------------ */
  /*  Fenêtre                                                            */
  /* ------------------------------------------------------------------ */

  function refreshAll(refreshSliders) {
    if (refreshSliders) groupWidgets.forEach((widget) => widget.update(state.values));
    refreshHarmonics();
    drawScope();
    renderIcons();
  }

  function changed() {
    drawScope();
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => previewNote(), 140);
  }

  function currentSettings() {
    return Object.assign({}, state.values, { label: ui_.name.value, icon: state.icon });
  }

  function previewNote() {
    return audio.previewCustom(currentSettings(), [GB.PREVIEW_ROW], 0.7).catch(() => false);
  }

  function previewMelody() {
    return audio.previewCustom(currentSettings(), MELODY, 0.34).catch(() => false);
  }

  function renderIcons() {
    ui_.icons.innerHTML = '';
    synth.ICONS.forEach((icon) => {
      const button = create('button', 'icon-choice');
      button.append(GB.icons.el(icon));
      button.type = 'button';
      button.setAttribute('aria-label', 'Icône ' + icon);
      button.classList.toggle('active', icon === state.icon);
      button.setAttribute('aria-pressed', String(icon === state.icon));
      button.addEventListener('click', () => {
        state.icon = icon;
        renderIcons();
      });
      ui_.icons.append(button);
    });
  }

  function showError(message) {
    ui_.error.textContent = message || '';
  }

  function pick(list) {
    return list[Math.floor(Math.random() * list.length)];
  }

  function between(min, max, step) {
    return Math.round((min + Math.random() * (max - min)) / step) * step;
  }

  /** « Au hasard » : un instrument aléatoire mais plaisant (jamais de réglage extrême). */
  function randomize() {
    const wave = pick(['sine', 'triangle', 'square', 'sawtooth', 'drawn']);
    const filtered = Math.random() < 0.6;
    state.values = synth.normalize({
      wave,
      harmonics: Array.from({ length: synth.HARMONICS }, (unused, i) => (Math.random() < 0.45 ? 0 : Math.random()) / (1 + i * 0.3)),
      wave2: Math.random() < 0.5 ? pick(['sine', 'triangle', 'square', 'sawtooth']) : 'none',
      mix2: between(0.2, 0.8, 0.05),
      octave2: pick([-1, 0, 0, 1]),
      detune2: between(-15, 15, 1),
      unison: pick([1, 1, 2, 3, 4]),
      spread: between(8, 40, 1),
      octave: 0,
      detune: 0,
      attack: pick([0.005, 0.02, 0.08, 0.25]),
      decay: between(0.1, 0.8, 0.02),
      sustain: between(0.2, 1, 0.05),
      release: between(0.1, 1.2, 0.02),
      filterType: filtered ? pick(['lowpass', 'lowpass', 'highpass', 'bandpass']) : 'none',
      cutoff: between(35, 90, 1),
      resonance: between(0, 0.6, 0.05),
      sweep: filtered && Math.random() < 0.5 ? between(1, 3, 0.1) : 0,
      vibrato: Math.random() < 0.3 ? between(0.1, 0.5, 0.05) : 0,
      vibratoRate: between(3, 8, 0.5),
      tremolo: Math.random() < 0.2 ? between(0.2, 0.6, 0.05) : 0,
      tremoloRate: between(3, 9, 0.5),
      chorus: Math.random() < 0.4 ? between(0.3, 0.7, 0.05) : 0,
      distortion: Math.random() < 0.15 ? between(0.2, 0.5, 0.05) : 0,
      echo: Math.random() < 0.3 ? between(0.2, 0.5, 0.05) : 0,
      reverb: Math.random() < 0.4 ? between(0.2, 0.5, 0.05) : 0,
      volume: 0,
    });
    refreshAll(true);
    previewMelody();
  }

  function build() {
    dlg = create('dialog', 'dialog dialog-synth');
    dlg.id = 'synth-dialog';
    dlg.setAttribute('aria-labelledby', 'synth-title');
    const wrap = create('div', 'synth-dialog');

    ui_.title = create('h3', null, 'Créer un instrument');
    ui_.title.id = 'synth-title';
    wrap.append(ui_.title, create('p', 'synth-intro', 'Règle un synthé à ta façon, puis enregistre-le : il apparaît dans « Mes instruments » et se joue comme les autres. En ligne, les autres joueurs l\'entendent aussi.'));

    // Nom + icône
    const identity = create('div', 'synth-identity');
    const nameLabel = create('label', 'setting-label', 'Nom');
    ui_.name = create('input', 'text-input');
    ui_.name.type = 'text';
    ui_.name.maxLength = synth.LABEL_MAX;
    ui_.name.placeholder = 'Ex. : Mon synthé';
    ui_.name.autocomplete = 'off';
    nameLabel.htmlFor = 'synth-name';
    ui_.name.id = 'synth-name';
    ui_.name.addEventListener('input', () => showError(''));
    ui_.name.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        save();
      }
    });
    ui_.icons = create('div', 'icon-grid');
    ui_.icons.setAttribute('role', 'group');
    ui_.icons.setAttribute('aria-label', 'Icône');
    identity.append(nameLabel, ui_.name, create('span', 'setting-label', 'Icône'), ui_.icons);
    wrap.append(identity);

    // Écoute + dessin de l'onde
    const listen = create('div', 'synth-listen');
    ui_.scope = create('canvas', 'synth-scope');
    ui_.scope.width = 260;
    ui_.scope.height = 70;
    ui_.scope.setAttribute('aria-label', 'Forme de l\'onde');
    const buttons = create('div', 'synth-listen-buttons');
    const note = GB.icons.set(create('button', 'btn btn-secondary btn-small'), 'play', 'Une note');
    note.type = 'button';
    note.addEventListener('click', previewNote);
    const melody = GB.icons.set(create('button', 'btn btn-secondary btn-small'), 'play', 'Une mélodie');
    melody.type = 'button';
    melody.addEventListener('click', previewMelody);
    const dice = GB.icons.set(create('button', 'btn btn-ghost btn-small'), 'dice', 'Au hasard');
    dice.type = 'button';
    dice.title = 'Invente un instrument au hasard (tu peux ensuite le retoucher)';
    dice.addEventListener('click', randomize);
    buttons.append(note, melody, dice);
    listen.append(ui_.scope, buttons);
    wrap.append(listen);

    // Sections de réglages
    const groups = create('div', 'synth-groups');
    groupWidgets = [];
    synth.GROUPS.forEach((group) => {
      const fields = synth.FIELDS.filter((field) => field.group === group.id);
      const details = create('details', 'synth-group');
      details.open = group.id === 'source' || group.id === 'envelope';
      details.append(create('summary', null, group.label));
      if (group.help) details.append(create('p', 'synth-help', group.help));
      const body = create('div', 'settings-grid');
      details.append(body);
      groupWidgets.push({
        body,
        fields,
        build() {
          const widget = GB.settingsUI.build(body, 'custom', state.values, {
            fields,
            onInput(key, value) {
              state.values[key] = value;
              if (key === 'wave') refreshHarmonics();
              drawScope();
            },
            onChange() {
              changed();
            },
          });
          this.update = (values) => widget.update(values);
        },
        update() {},
      });
      if (group.id === 'source') details.append(buildHarmonics());
      groups.append(details);
    });
    wrap.append(groups);

    ui_.error = create('p', 'form-error');
    ui_.error.setAttribute('role', 'alert');
    wrap.append(ui_.error);

    const actions = create('div', 'dialog-actions synth-actions');
    ui_.btnDelete = GB.icons.set(create('button', 'btn btn-ghost'), 'trash', 'Supprimer');
    ui_.btnDelete.type = 'button';
    ui_.btnDelete.addEventListener('click', remove);
    ui_.btnCopy = GB.icons.set(create('button', 'btn btn-ghost'), 'copy', 'Dupliquer');
    ui_.btnCopy.type = 'button';
    ui_.btnCopy.title = 'Garde cet instrument et crée-en un autre à partir de lui';
    ui_.btnCopy.addEventListener('click', duplicate);
    const cancel = create('button', 'btn btn-ghost', 'Annuler');
    cancel.type = 'button';
    cancel.addEventListener('click', close);
    ui_.btnSave = GB.icons.set(create('button', 'btn btn-primary'), 'save', 'Enregistrer');
    ui_.btnSave.type = 'button';
    ui_.btnSave.addEventListener('click', save);
    actions.append(ui_.btnDelete, ui_.btnCopy, cancel, ui_.btnSave);
    wrap.append(actions);

    dlg.append(wrap);
    document.body.append(dlg);
    dlg.addEventListener('close', () => clearTimeout(previewTimer));
  }

  function open(instrumentId) {
    if (!dlg) build();
    audio.unlock();
    const meta = instrumentId ? GB.INSTRUMENTS[instrumentId] : null;
    const editing = Boolean(meta && meta.custom);
    state.editingId = editing ? meta.id : null;
    state.values = synth.normalize(editing ? meta.settings : {});
    state.icon = synth.normalize({ icon: state.values.icon }).icon;
    ui_.title.textContent = editing ? 'Modifier l\'instrument' : 'Créer un instrument';
    ui_.name.value = editing ? meta.label : '';
    ui_.btnDelete.hidden = !editing;
    ui_.btnCopy.hidden = !editing;
    showError('');
    groupWidgets.forEach((widget) => widget.build());
    refreshAll(false);
    if (typeof dlg.showModal === 'function') dlg.showModal();
    else dlg.setAttribute('open', '');
    ui_.name.focus();
  }

  function close() {
    if (dlg.open && typeof dlg.close === 'function') dlg.close();
    else dlg.removeAttribute('open');
  }

  function refreshEverywhere() {
    ui.renderInstrumentPicker();
    GB.instrumentUI.notifyChanged();
    if (GB.pregameUI) GB.pregameUI.soundsChanged();
  }

  function save() {
    const previousId = state.editingId;
    const result = GB.instruments.saveCustom(currentSettings(), previousId);
    if (!result.ok) {
      showError(result.error);
      ui_.name.focus();
      return;
    }
    close();
    ui.showToast(result.saved ? '« ' + result.meta.label + ' » est enregistré' : '« ' + result.meta.label + ' » est prêt (enregistrement impossible dans ce navigateur : il disparaîtra à la fermeture)');
    // Pendant la composition : la couche en cours prend le nouvel instrument (si elle est modifiable).
    const track = store.getSelectedTrack();
    const editorOpen = !document.getElementById('screen-editor').hidden;
    if (editorOpen && track && !track.locked && (!ui.isGameMode() || GB.game.state.phase === 'compose') && (!previousId || track.instrumentId === previousId)) {
      ui.changeInstrument(result.meta.id);
    }
    // Pendant la préparation : l'instrument enregistré est choisi tout de suite.
    if (GB.pregameUI) GB.pregameUI.chooseSound(result.meta.id);
    refreshEverywhere();
  }

  function duplicate() {
    state.editingId = null;
    ui_.name.value = (ui_.name.value + ' (copie)').slice(0, synth.LABEL_MAX);
    ui_.title.textContent = 'Créer un instrument';
    ui_.btnDelete.hidden = true;
    ui_.btnCopy.hidden = true;
    showError('');
    ui_.name.focus();
    ui_.name.select();
  }

  function remove() {
    const id = state.editingId;
    const meta = id && GB.INSTRUMENTS[id];
    if (!meta) return;
    if (!window.confirm('Supprimer l\'instrument « ' + meta.label + ' » ? Les couches qui l\'utilisent déjà gardent leur son.')) return;
    GB.instruments.deleteCustom(id);
    close();
    ui.showToast('« ' + meta.label + ' » supprimé');
    refreshEverywhere();
  }

  GB.synthUI = { open, close };
})((window.GB = window.GB || {}));

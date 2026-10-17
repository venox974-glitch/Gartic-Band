/**
 * GARTIC BANDE — interface des réglages d'instruments.
 *
 *   GB.settingsUI.build()     fabrique des curseurs / boutons à partir de GB.instruments.SCHEMAS
 *   panneau « Réglages »      sous la liste des instruments : voix robot et instruments personnalisés
 *   fenêtre de création       nom, icône, forme d'onde, octave, enveloppe, écho, réverbération, écoute, sauvegarde
 */
(function (GB) {
  'use strict';

  const { store, audio } = GB;
  const ui = GB.ui;
  const $ = (id) => document.getElementById(id);

  const el = {
    panel: $('instrument-settings'),
    btnNew: $('btn-new-instrument'),
    dialog: $('instrument-dialog'),
    title: $('inst-dialog-title'),
    name: $('inst-name'),
    icons: $('inst-icons'),
    settings: $('inst-settings'),
    error: $('inst-error'),
    btnNote: $('btn-inst-note'),
    btnMelody: $('btn-inst-melody'),
    btnDelete: $('btn-inst-delete'),
    btnCancel: $('btn-inst-cancel'),
    btnSave: $('btn-inst-save'),
  };

  const listeners = { saved: [] };

  function create(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  /* ------------------------------------------------------------------ */
  /*  Fabrique de réglages                                               */
  /* ------------------------------------------------------------------ */

  let uid = 0;

  /**
   * Construit les réglages d'un moteur dans `container`.
   * `onInput(clé, valeur)` : pendant qu'on déplace un curseur ; `onChange(clé, valeur)` : une fois relâché.
   */
  const settingsUI = {
    build(container, engine, values, { onInput, onChange, disabled } = {}) {
      container.innerHTML = '';
      const widgets = {};
      (GB.instruments.SCHEMAS[engine] || []).forEach((field) => {
        uid += 1;
        const row = create('div', 'setting');
        row.dataset.key = field.key;
        if (field.type === 'choice') {
          const label = create('span', 'setting-label', field.label);
          const group = create('div', 'segmented setting-choice');
          group.setAttribute('role', 'group');
          group.setAttribute('aria-label', field.label);
          field.options.forEach((option) => {
            const button = create('button', 'segmented-btn', option.label);
            button.type = 'button';
            button.dataset.value = option.value;
            button.disabled = Boolean(disabled);
            button.addEventListener('click', () => {
              update({ [field.key]: option.value });
              if (onInput) onInput(field.key, option.value);
              if (onChange) onChange(field.key, option.value);
            });
            group.append(button);
          });
          row.append(label, group);
          widgets[field.key] = {
            set(value) {
              group.querySelectorAll('button').forEach((button) => {
                const on = button.dataset.value === String(value);
                button.classList.toggle('active', on);
                button.setAttribute('aria-pressed', String(on));
              });
            },
          };
        } else {
          const id = 'setting-' + uid;
          const label = create('label', 'setting-label', field.label);
          label.htmlFor = id;
          const input = create('input', 'setting-range');
          input.type = 'range';
          input.id = id;
          input.min = field.min;
          input.max = field.max;
          input.step = field.step;
          input.disabled = Boolean(disabled);
          const output = create('output', 'setting-value');
          input.addEventListener('input', () => {
            const value = Number(input.value);
            output.textContent = GB.instruments.formatValue(field, value);
            if (onInput) onInput(field.key, value);
          });
          input.addEventListener('change', () => {
            if (onChange) onChange(field.key, Number(input.value));
          });
          row.append(label, input, output);
          widgets[field.key] = {
            set(value) {
              input.value = value;
              output.textContent = GB.instruments.formatValue(field, Number(value));
            },
          };
        }
        container.append(row);
      });

      function update(values) {
        Object.keys(values || {}).forEach((key) => widgets[key] && widgets[key].set(values[key]));
      }
      update(values);
      return { update };
    },
  };

  /* ------------------------------------------------------------------ */
  /*  Panneau « Réglages » de la piste sélectionnée                      */
  /* ------------------------------------------------------------------ */

  let panelTrackId = null;

  function renderPanel() {
    const track = store.getSelectedTrack();
    const engine = track ? GB.instruments.settingsEngine(track.instrumentId) : null;
    el.panel.hidden = !engine;
    if (!engine) {
      el.panel.innerHTML = '';
      panelTrackId = null;
      return;
    }
    const meta = GB.INSTRUMENTS[track.instrumentId];
    panelTrackId = track.id;
    el.panel.innerHTML = '';
    el.panel.style.setProperty('--track-color', track.color);

    const head = create('div', 'settings-head');
    head.append(create('strong', null, meta.icon + ' Réglages · ' + meta.label));
    if (meta.custom) {
      const edit = create('button', 'btn btn-ghost btn-small', '✏️ Modifier');
      edit.type = 'button';
      edit.title = 'Ouvrir la fenêtre de l\'instrument pour le renommer ou changer ses réglages';
      edit.addEventListener('click', () => openDialog(meta.id));
      head.append(edit);
    }
    el.panel.append(head);
    if (meta.sample) {
      const ref = track.settings && track.settings.sample;
      const duration = ref ? ref.duration : 0;
      const beats = duration * (store.state.bpm / 60);
      const note = create('p', 'settings-note sample-info');
      note.textContent =
        'Son importé de ' + duration.toFixed(1).replace('.', ',') + ' s (≈ ' + GB.formatBeats(Math.round(beats * 4) / 4) + ' temps à ' + store.state.bpm + ' BPM). ' +
        'Do4 = hauteur d\'origine ; plus la note est aiguë, plus le son est rapide et court. ' +
        (track.settings && track.settings.mode === 'fit' ? 'Il s\'arrête avec la note.' : 'Il est joué en entier, même si la note est courte.');
      el.panel.append(note);
      if (ref && ref.hash && !GB.sounds.peekBuffer(ref.hash)) {
        el.panel.append(create('p', 'settings-note sample-warn', '⏳ Le fichier de ce son se charge… S\'il reste muet, il manque dans ce navigateur.'));
      }
    }
    if (track.locked) el.panel.append(create('p', 'settings-note', 'Cette couche est verrouillée 🔒'));

    const body = create('div', 'settings-grid');
    el.panel.append(body);
    settingsUI.build(body, engine, track.settings, {
      disabled: track.locked,
      onInput(key, value) {
        if (!store.setSettings(track.id, { [key]: value })) return;
        audio.syncTracks();
      },
      onChange(key) {
        if (key === 'vowel') ui.renderVowelBar();
        if (meta.sample) renderPanel(); // le texte d'explication dépend du mode choisi
        audio.preview(track.id, GB.PREVIEW_ROW);
        if (key === 'octave') {
          ui.renderRoll(); // les noms de notes changent avec l'octave
          ui.renderStageHeader();
        }
      },
    });
  }

  /* ------------------------------------------------------------------ */
  /*  Fenêtre de création / modification                                 */
  /* ------------------------------------------------------------------ */

  const dialogState = { editingId: null, icon: '🎛', values: null };

  function renderIcons() {
    el.icons.innerHTML = '';
    GB.instruments.ICONS.forEach((icon) => {
      const button = create('button', 'icon-choice', icon);
      button.type = 'button';
      button.dataset.icon = icon;
      button.setAttribute('aria-label', 'Icône ' + icon);
      button.classList.toggle('active', icon === dialogState.icon);
      button.setAttribute('aria-pressed', String(icon === dialogState.icon));
      button.addEventListener('click', () => {
        dialogState.icon = icon;
        renderIcons();
      });
      el.icons.append(button);
    });
  }

  function showError(message) {
    el.error.textContent = message || '';
  }

  function openDialog(instrumentId) {
    audio.unlock();
    const meta = instrumentId ? GB.INSTRUMENTS[instrumentId] : null;
    const editing = Boolean(meta && meta.custom);
    dialogState.editingId = editing ? meta.id : null;
    dialogState.icon = editing ? meta.icon : GB.instruments.ICONS[0];
    dialogState.values = editing ? Object.assign({}, meta.settings) : GB.instruments.engineDefaults('custom');
    el.title.textContent = editing ? 'Modifier l\'instrument' : 'Créer un instrument';
    el.name.value = editing ? meta.label : '';
    el.btnDelete.hidden = !editing;
    showError('');
    renderIcons();
    settingsUI.build(el.settings, 'custom', dialogState.values, {
      onInput(key, value) {
        dialogState.values[key] = value;
      },
      onChange() {
        previewNote();
      },
    });
    if (typeof el.dialog.showModal === 'function') el.dialog.showModal();
    else el.dialog.setAttribute('open', '');
    el.name.focus();
  }

  function previewNote() {
    return audio.previewEngine('custom', dialogState.values, [GB.legacyRow(6)], 0.6);
  }

  function previewMelody() {
    return audio.previewEngine('custom', dialogState.values, [5, 7, 9, 8, 6, 10].map(GB.legacyRow), 0.32);
  }

  function closeDialog() {
    if (el.dialog.open && typeof el.dialog.close === 'function') el.dialog.close();
    else el.dialog.removeAttribute('open');
  }

  function save() {
    const result = GB.instruments.saveCustom({
      id: dialogState.editingId,
      label: el.name.value,
      icon: dialogState.icon,
      settings: dialogState.values,
    });
    if (!result.ok) {
      showError(result.error);
      el.name.focus();
      return;
    }
    closeDialog();
    ui.showToast(
      result.saved
        ? '« ' + result.meta.label + ' » est sauvegardé 💾'
        : '« ' + result.meta.label + ' » est prêt (sauvegarde impossible dans ce navigateur : il disparaîtra à la fermeture)'
    );
    // L'instrument créé ou modifié est tout de suite appliqué à la couche en cours (si elle est modifiable).
    const track = store.getSelectedTrack();
    const canApply = track && !track.locked && (!ui.isGameMode() || GB.game.state.phase === 'compose');
    if (canApply) {
      if (!dialogState.editingId) store.setInstrument(track.id, result.meta.id);
      else if (track.instrumentId === result.meta.id) store.resetSettings(track.id);
      audio.syncTracks();
      ui.renderAll();
      audio.preview(track.id, GB.PREVIEW_ROW);
    }
    listeners.saved.forEach((listener) => listener(result.meta, !dialogState.editingId));
    renderPicker();
  }

  function remove() {
    const id = dialogState.editingId;
    const meta = id && GB.INSTRUMENTS[id];
    if (!meta) return;
    if (!window.confirm('Supprimer l\'instrument « ' + meta.label + ' » ? Les couches qui l\'utilisent déjà gardent leur son.')) return;
    GB.instruments.deleteCustom(id);
    closeDialog();
    ui.showToast('« ' + meta.label + ' » supprimé');
    listeners.saved.forEach((listener) => listener(null, false));
    renderPicker();
  }

  function renderPicker() {
    ui.renderInstrumentPicker();
    renderPanel();
  }

  function bind() {
    el.btnNew.addEventListener('click', () => openDialog(null));
    el.btnCancel.addEventListener('click', closeDialog);
    el.btnSave.addEventListener('click', save);
    el.btnDelete.addEventListener('click', remove);
    el.btnNote.addEventListener('click', previewNote);
    el.btnMelody.addEventListener('click', previewMelody);
    el.name.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        save();
      }
    });
    el.name.addEventListener('input', () => showError(''));
  }

  GB.settingsUI = settingsUI;
  GB.instrumentUI = {
    openDialog,
    renderPanel,
    onSaved(listener) {
      listeners.saved.push(listener);
    },
    getPanelTrackId: () => panelTrackId,
    /** Prévient les écrans qui affichent la liste des instruments (la liste a changé ailleurs, ex. « Mes sons »). */
    notifyChanged() {
      listeners.saved.forEach((listener) => listener(null, false));
    },
  };
  bind();
})((window.GB = window.GB || {}));

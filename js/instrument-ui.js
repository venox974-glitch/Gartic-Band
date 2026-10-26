/**
 * GARTIC BANDE — interface des réglages d'instruments.
 *
 *   GB.settingsUI.build()     fabrique des curseurs / boutons à partir de GB.instruments.SCHEMAS
 *   panneau « Réglages »      voix robot, trompette, flûte, sons importés
 *
 * (L'éditeur d'instruments personnalisés est dans js/synth-ui.js.)
 */
(function (GB) {
  'use strict';

  const { store, audio } = GB;
  const ui = GB.ui;
  const $ = (id) => document.getElementById(id);

  const el = {
    panel: $('instrument-settings'),
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
    build(container, engine, values, { onInput, onChange, disabled, fields } = {}) {
      container.innerHTML = '';
      const widgets = {};
      (fields || GB.instruments.SCHEMAS[engine] || []).filter((field) => !field.hidden).forEach((field) => {
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
    head.append(GB.icons.el(meta.icon, 'ins-icon'), create('strong', null, 'Réglages · ' + meta.label));
    if (meta.custom) {
      const edit = GB.icons.set(create('button', 'btn btn-ghost btn-small'), 'knob', 'Modifier cet instrument');
      edit.type = 'button';
      edit.title = 'Ouvre l\'éditeur : tu peux changer le son, le renommer ou l\'enregistrer sous un autre nom';
      edit.addEventListener('click', () => GB.synthUI.open(meta.id));
      head.append(edit);
    }
    el.panel.append(head);
    if (meta.custom) {
      el.panel.append(create('p', 'settings-note', 'Instrument personnalisé : ses réglages se modifient dans l\'éditeur. Les notes de la couche sont conservées.'));
      if (track.locked) el.panel.append(create('p', 'settings-note', 'Cette couche est verrouillée'));
      return;
    }
    if (meta.sample) {
      const ref = track.settings && track.settings.sample;
      const duration = ref ? ref.duration : 0;
      const beats = duration * (store.state.bpm / 60);
      const note = create('p', 'settings-note sample-info');
      note.textContent =
        'Son importé de ' + duration.toFixed(1).replace('.', ',') + ' s (≈ ' + GB.formatBeats(Math.round(beats * 4) / 4) + ' temps à ' + store.state.bpm + ' BPM). ' +
        'Do4 = hauteur d\'origine ; les autres notes changent la hauteur du son, jamais sa vitesse ni sa durée. ' +
        (track.settings && track.settings.mode === 'fit' ? 'Il s\'arrête avec la note.' : 'Il est joué en entier, même si la note est courte.');
      el.panel.append(note);
      if (ref && ref.hash && !GB.sounds.peekBuffer(ref.hash)) {
        el.panel.append(create('p', 'settings-note sample-warn', 'Le fichier de ce son se charge… S\'il reste muet, il manque dans ce navigateur.'));
      }
    }
    if (track.locked) el.panel.append(create('p', 'settings-note', 'Cette couche est verrouillée'));

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

  GB.settingsUI = settingsUI;
  GB.instrumentUI = {
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
})((window.GB = window.GB || {}));

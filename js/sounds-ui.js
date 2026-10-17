/**
 * GARTIC BANDE — fenêtre « Mes sons » : importer, écouter, renommer, régler le volume, supprimer,
 * et utiliser un son importé comme instrument du piano-roll.
 */
(function (GB) {
  'use strict';

  const { sounds, store, audio } = GB;
  const ui = GB.ui;
  const $ = (id) => document.getElementById(id);

  const el = {
    dialog: $('sounds-dialog'),
    intro: $('sounds-intro'),
    drop: $('sounds-drop'),
    file: $('sounds-file'),
    btnImport: $('btn-sounds-import'),
    limit: $('sounds-limit'),
    usage: $('sounds-usage'),
    msg: $('sounds-msg'),
    list: $('sounds-list'),
    btnClose: $('btn-sounds-close'),
    btnOpen: $('btn-my-sounds'),
  };

  let preview = null; // { id, src, gain }
  let message = '';
  let busy = 0;

  function create(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function say(text, kind) {
    message = text || '';
    el.msg.textContent = message;
    el.msg.dataset.kind = kind || 'error';
  }

  function seconds(value) {
    return value < 10 ? value.toFixed(1).replace('.', ',') + ' s' : Math.round(value) + ' s';
  }

  /* ------------------------------------------------------------------ */
  /*  Écoute                                                             */
  /* ------------------------------------------------------------------ */

  function stopPreview() {
    if (!preview) return;
    const current = preview;
    preview = null;
    try {
      current.src.onended = null;
      current.src.stop();
      current.src.disconnect();
      current.gain.disconnect();
    } catch (error) {
      /* déjà arrêté */
    }
    render();
  }

  async function play(entry) {
    if (preview && preview.id === entry.id) return stopPreview();
    stopPreview();
    await audio.unlock();
    const tone = await sounds.ensure(entry.hash);
    if (!tone) return say('Le fichier de « ' + entry.name + ' » est introuvable dans ce navigateur.');
    const context = Tone.getContext();
    const src = context.createBufferSource();
    const gain = context.createGain();
    src.buffer = tone.get();
    gain.gain.value = Math.pow(10, entry.volumeDb / 20);
    src.connect(gain);
    Tone.connect(gain, Tone.getDestination());
    const current = { id: entry.id, src, gain };
    src.onended = () => {
      if (preview === current) {
        preview = null;
        render();
      }
    };
    preview = current;
    src.start();
    render();
  }

  /* ------------------------------------------------------------------ */
  /*  Import                                                             */
  /* ------------------------------------------------------------------ */

  async function importFiles(files) {
    const picked = Array.from(files || []);
    if (!picked.length) return;
    busy += 1;
    renderIntro();
    const notes = [];
    const errors = [];
    for (const file of picked) {
      const result = await sounds.add(file);
      if (!result.ok) errors.push(result.error);
      else notes.push(result.duplicate ? '« ' + result.sound.name + ' » est déjà dans ta bibliothèque.' : '« ' + result.sound.name + ' » ajouté ✅');
    }
    busy -= 1;
    if (errors.length) say(errors.join(' '), 'error');
    else say(notes.join(' '), 'ok');
    el.file.value = '';
    render();
  }

  /* ------------------------------------------------------------------ */
  /*  Utiliser comme instrument                                          */
  /* ------------------------------------------------------------------ */

  function registerEntry(entry) {
    return GB.instruments.registerSample({
      hash: entry.hash,
      name: entry.name,
      duration: entry.duration,
      settings: { volume: entry.volumeDb },
    });
  }

  async function useAsInstrument(entry) {
    const meta = registerEntry(entry);
    sounds.markUsed(entry.hash);
    await sounds.update(entry.id, { instrument: true });
    const inGame = ui.isGameMode();
    const track = store.getSelectedTrack();
    let applied = false;
    if (inGame) {
      if (GB.game.state.phase === 'pick') applied = Boolean(GB.game.pickInstrument(meta.id));
    } else if (track && !track.locked) {
      store.setInstrument(track.id, meta.id);
      applied = true;
    }
    audio.syncTracks();
    ui.renderAll();
    GB.instrumentUI.notifyChanged();
    if (applied) {
      closeDialog();
      ui.showToast('« ' + entry.name + ' » est ton instrument 🎧 — pose des notes, la hauteur change la vitesse du son');
      const now = store.getSelectedTrack();
      if (now) audio.preview(now.id, GB.PREVIEW_ROW);
    } else {
      say('« ' + entry.name + ' » est ajouté à la liste des instruments.', 'ok');
      render();
    }
  }

  async function removeEntry(entry) {
    if (!window.confirm('Supprimer « ' + entry.name + ' » de ta bibliothèque ? Les couches qui l\'utilisent déjà gardent leur son.')) return;
    if (preview && preview.id === entry.id) stopPreview();
    const result = await sounds.remove(entry.id);
    if (!result.ok) return say(result.error);
    GB.instruments.hideSample(GB.instruments.sampleIdOf(entry.hash));
    say('« ' + entry.name + ' » supprimé.', 'ok');
    GB.instrumentUI.notifyChanged();
    ui.renderInstrumentPicker();
    render();
  }

  /* ------------------------------------------------------------------ */
  /*  Affichage                                                          */
  /* ------------------------------------------------------------------ */

  function renderIntro() {
    const formats = sounds.supportedFormats();
    const names = ['WAV'].concat(formats.mp3 ? ['MP3'] : [], formats.ogg ? ['OGG'] : []);
    const limits = sounds.limits();
    el.intro.textContent =
      'Importe tes propres sons (' + names.join(', ') + ') et joue-les comme un instrument. Jusqu\'à ' + limits.MAX_COUNT + ' sons de ' +
      limits.MAX_SECONDS + ' s au plus. ' +
      (sounds.isPersistent()
        ? 'Ils sont gardés dans ce navigateur, sur cet ordinateur seulement : un autre ordinateur ne les aura pas.'
        : '⚠️ Ce navigateur ne permet pas de sauvegarder : tes sons disparaîtront à la fermeture de la page.');
    el.btnImport.disabled = busy > 0;
    el.btnImport.textContent = busy > 0 ? 'Import en cours…' : '📂 Importer un son';
  }

  function renderLimit() {
    el.limit.innerHTML = '';
    const choices = GB.CONFIG.SOUNDS.FILE_BYTES_CHOICES.map((mb) => mb * 1024 * 1024);
    const current = sounds.fileLimit();
    if (!choices.includes(current)) choices.push(current);
    choices.sort((a, b) => a - b).forEach((bytes) => {
      const option = create('option', null, sounds.megabytes(bytes));
      option.value = String(bytes);
      option.selected = bytes === current;
      el.limit.append(option);
    });
    el.usage.textContent = sounds.count() + '/' + GB.CONFIG.SOUNDS.MAX_COUNT + ' sons · ' + sounds.megabytes(sounds.totalBytes()) + ' utilisés sur ' + sounds.megabytes(GB.CONFIG.SOUNDS.MAX_TOTAL_BYTES);
  }

  function render() {
    renderIntro();
    renderLimit();
    el.msg.textContent = message;
    const entries = sounds.list();
    el.list.innerHTML = '';
    if (!entries.length) {
      el.list.append(create('li', 'sounds-empty', 'Aucun son pour l\'instant. Glisse un fichier ici ou clique sur « Importer un son ».'));
      return;
    }
    entries.forEach((entry) => {
      const item = create('li', 'sound-item');
      item.dataset.soundId = entry.id;

      const wave = create('div', 'sound-wave');
      wave.setAttribute('aria-hidden', 'true');
      (entry.peaks || []).forEach((peak) => {
        const bar = create('span');
        bar.style.height = Math.max(6, Math.round(peak * 100)) + '%';
        wave.append(bar);
      });

      const name = create('input', 'text-input sound-name');
      name.type = 'text';
      name.value = entry.name;
      name.maxLength = GB.CONFIG.SOUNDS.NAME_MAX;
      name.setAttribute('aria-label', 'Nom du son');
      const commit = async () => {
        if (name.value === entry.name) return;
        const result = await sounds.rename(entry.id, name.value);
        if (!result.ok) {
          say(result.error);
          name.value = entry.name;
        } else {
          registerEntryIfListed(result.sound);
          GB.instrumentUI.notifyChanged();
          ui.renderInstrumentPicker();
        }
      };
      name.addEventListener('change', commit);
      name.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          name.blur();
        }
      });

      const meta = create('small', 'sound-meta', seconds(entry.duration) + ' · ' + (entry.format || '').toUpperCase() + ' · ' + sounds.megabytes(entry.bytes));

      const volume = create('input', 'setting-range sound-volume');
      volume.type = 'range';
      volume.min = -24;
      volume.max = 6;
      volume.step = 1;
      volume.value = entry.volumeDb;
      volume.setAttribute('aria-label', 'Volume de ' + entry.name);
      const volumeText = create('output', 'setting-value', (entry.volumeDb > 0 ? '+' : '') + entry.volumeDb + ' dB');
      volume.addEventListener('input', () => {
        volumeText.textContent = (Number(volume.value) > 0 ? '+' : '') + volume.value + ' dB';
      });
      volume.addEventListener('change', async () => {
        const result = await sounds.update(entry.id, { volumeDb: Number(volume.value) });
        if (result.ok) registerEntryIfListed(result.sound);
      });

      const listen = create('button', 'btn btn-small', preview && preview.id === entry.id ? '⏹ Stop' : '▶ Écouter');
      listen.type = 'button';
      listen.dataset.action = 'play';
      listen.addEventListener('click', () => play(entry));

      const use = create('button', 'btn btn-primary btn-small', '🎹 Utiliser comme instrument');
      use.type = 'button';
      use.dataset.action = 'use';
      use.addEventListener('click', () => useAsInstrument(entry));

      const remove = create('button', 'icon-btn danger', '🗑');
      remove.type = 'button';
      remove.dataset.action = 'delete';
      remove.title = 'Supprimer ce son';
      remove.setAttribute('aria-label', 'Supprimer ' + entry.name);
      remove.addEventListener('click', () => removeEntry(entry));

      const top = create('div', 'sound-top');
      top.append(name, remove);
      const mid = create('div', 'sound-mid');
      mid.append(wave, meta);
      const volumeRow = create('div', 'sound-volume-row');
      volumeRow.append(create('span', 'setting-label', 'Volume'), volume, volumeText);
      const actions = create('div', 'sound-actions');
      actions.append(listen, use);
      item.append(top, mid, volumeRow, actions);
      el.list.append(item);
    });
  }

  /** Le nom ou le volume d'un son qui est dans la liste des instruments : on met à jour ce que proposent les NOUVELLES couches. */
  function registerEntryIfListed(entry) {
    if (entry && entry.instrument) registerEntry(entry);
  }

  /* ------------------------------------------------------------------ */
  /*  Fenêtre                                                            */
  /* ------------------------------------------------------------------ */

  function openDialog() {
    audio.unlock();
    sounds.init().then(() => {
      render();
    });
    say('');
    render();
    if (typeof el.dialog.showModal === 'function') {
      if (!el.dialog.open) el.dialog.showModal();
    } else el.dialog.setAttribute('open', '');
  }

  function closeDialog() {
    stopPreview();
    if (el.dialog.open && typeof el.dialog.close === 'function') el.dialog.close();
    else el.dialog.removeAttribute('open');
  }

  function bind() {
    el.btnImport.addEventListener('click', () => el.file.click());
    el.file.addEventListener('change', () => importFiles(el.file.files));
    el.btnClose.addEventListener('click', closeDialog);
    el.dialog.addEventListener('close', stopPreview);
    el.limit.addEventListener('change', () => {
      sounds.setFileLimit(Number(el.limit.value));
      say('Limite par fichier : ' + sounds.megabytes(sounds.fileLimit()) + '.', 'ok');
    });
    if (el.btnOpen) el.btnOpen.addEventListener('click', openDialog);

    // Glisser-déposer : sur toute la fenêtre.
    ['dragenter', 'dragover'].forEach((type) =>
      el.dialog.addEventListener(type, (event) => {
        event.preventDefault();
        el.drop.classList.add('over');
      })
    );
    ['dragleave', 'drop'].forEach((type) =>
      el.dialog.addEventListener(type, (event) => {
        event.preventDefault();
        if (type === 'dragleave' && el.dialog.contains(event.relatedTarget)) return;
        el.drop.classList.remove('over');
      })
    );
    el.dialog.addEventListener('drop', (event) => {
      const files = event.dataTransfer && event.dataTransfer.files;
      if (files && files.length) importFiles(files);
    });
    // Un fichier lâché à côté de la fenêtre ne doit pas faire quitter la page.
    window.addEventListener('dragover', (event) => {
      if (event.dataTransfer && Array.from(event.dataTransfer.types || []).includes('Files')) event.preventDefault();
    });
    window.addEventListener('drop', (event) => {
      if (event.dataTransfer && Array.from(event.dataTransfer.types || []).includes('Files') && !el.dialog.contains(event.target)) event.preventDefault();
    });
  }

  GB.soundsUI = {
    open: openDialog,
    close: closeDialog,
    /** Au démarrage : remet dans la liste des instruments les sons que le joueur y avait ajoutés. */
    async init() {
      await sounds.init();
      sounds.list().forEach((entry) => {
        if (entry.instrument) registerEntry(entry);
      });
      ui.renderInstrumentPicker();
      GB.instrumentUI.notifyChanged();
    },
  };
  bind();
})((window.GB = window.GB || {}));

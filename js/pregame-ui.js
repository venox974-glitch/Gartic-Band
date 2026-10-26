/**
 * GARTIC BANDE — pages d'avant-composition : PROPOSITION → VOTE → PRÉPARATION.
 *
 * Chaque phase est sa propre page, avec son chrono (durée MAXIMALE), ses consignes et sa condition de fin.
 * Les règles (une idée par joueur, pas de vote pour soi, égalité, tirage au sort, valeurs par défaut) sont dans
 * js/themes.js et js/phases.js, partagées avec le serveur : ce fichier ne fait qu'AFFICHER l'état et envoyer les actions.
 *
 * Deux « contrôleurs » alimentent la même page :
 *   - local  : une partie de test avec des personnages (le navigateur joue le rôle de l'arbitre) ;
 *   - en ligne : le SERVEUR est l'arbitre (chrono, validation, tirage au sort, passage de page) — voir online.js.
 *
 * Interface d'un contrôleur :
 *   youId, online, defaultBpm
 *   view()           → vue de la phase (voir Phases.view), avec `remainingMs` à jour
 *   players()        → [{ id, name, avatar, color, connected }]
 *   send(cmd, arg)   → 'propose' {text} · 'vote' {id} · 'prep' {bpm, instrumentId, mode, settings} → { ok, error? }
 *   quit()
 */
(function (GB) {
  'use strict';

  const { audio, store } = GB;
  const Phases = GB.phases;
  const Themes = GB.themes;
  const ui = GB.ui;
  const $ = (id) => document.getElementById(id);

  const el = {
    steps: $('pre-steps'),
    clock: $('pre-clock'),
    fill: $('pre-fill'),
    title: $('pre-title'),
    instructions: $('pre-instructions'),
    theme: $('pre-theme'),
    body: $('pre-body'),
    status: $('pre-status'),
    quit: $('btn-pre-quit'),
    progress: document.querySelector('#screen-pre .rb-progress'),
  };

  const MODE_INFO = {
    baby: { icon: 'baby', label: 'Baby', help: 'Une seule gamme, rythme simple : impossible de jouer faux.' },
    beginner: { icon: 'piano', label: 'Débutant', help: 'Les 7 notes blanches, toutes libres.' },
    expert: { icon: 'note', label: 'Expert', help: 'Toutes les notes, rythme très fin.' },
  };

  const BLURBS = {
    piano: 'Notes claires et courtes',
    synth: 'Nappes douces qui durent',
    bass: 'Les graves qui portent le groove',
    lead: 'Mélodies pétillantes 8-bit',
    drums: 'Le rythme : un son par ligne',
    trumpet: 'Cuivre brillant et éclatant',
    flute: 'Souffle doux et aérien',
    vox: 'Voix électronique réglable',
    mic: 'Ta vraie voix, au micro',
  };

  const timings = { botMinMs: 900, botMaxMs: 3200 }; // les personnages simulés agissent après ce délai (réglable par les tests)

  let ctl = null;
  let clockTimer = null;
  let builtKey = '';
  let sending = ''; // commande envoyée en attente de confirmation du serveur
  let draft = null; // choix en cours (idée, vote visé, préparation)
  let onSoundsChanged = null;

  /* ------------------------------------------------------------------ */
  /*  Utilitaires                                                        */
  /* ------------------------------------------------------------------ */

  function create(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function formatClock(ms) {
    const total = Math.max(0, Math.ceil(ms / 1000));
    return Math.floor(total / 60) + ':' + String(total % 60).padStart(2, '0');
  }

  function plural(count, singular, pluralForm) {
    return count + ' ' + (count > 1 ? pluralForm : singular);
  }

  function playerOf(id) {
    return ctl.players().find((player) => player.id === id) || { id, name: '?', avatar: '', color: '#888' };
  }

  function presentPlayers() {
    return ctl.players().filter((player) => player.connected !== false);
  }

  /* ------------------------------------------------------------------ */
  /*  Cadre commun : étapes, chrono                                      */
  /* ------------------------------------------------------------------ */

  const STEPS = [
    { id: 'propose', label: 'Idées' },
    { id: 'vote', label: 'Vote' },
    { id: 'prep', label: 'Préparation' },
    { id: 'compose', label: 'Composition' },
  ];

  function renderSteps(stage) {
    el.steps.innerHTML = '';
    const current = STEPS.findIndex((step) => step.id === stage);
    STEPS.forEach((step, index) => {
      const item = create('li', 'pre-step');
      item.dataset.step = step.id;
      item.classList.toggle('done', index < current);
      item.classList.toggle('current', index === current);
      if (index === current) item.setAttribute('aria-current', 'step');
      item.append((index < current ? GB.icons.set(create('span', 'pre-step-n'), 'check') : create('span', 'pre-step-n', String(index + 1))), create('span', 'pre-step-label', step.label));
      el.steps.append(item);
    });
  }

  function updateClock(view) {
    const remaining = view.remainingMs;
    const total = Math.max(1, view.durationMs);
    el.clock.textContent = formatClock(remaining);
    const fraction = Math.max(0, Math.min(1, remaining / total));
    el.fill.style.transform = 'scaleX(' + fraction.toFixed(4) + ')';
    el.progress.setAttribute('aria-valuenow', String(Math.round((1 - fraction) * 100)));
    const urgency = remaining <= 5000 ? 'danger' : fraction <= 0.25 ? 'warn' : 'ok';
    el.clock.dataset.urgency = urgency;
    el.progress.dataset.urgency = urgency;
  }

  /* ------------------------------------------------------------------ */
  /*  Page 1 — PROPOSITION                                               */
  /* ------------------------------------------------------------------ */

  function buildPropose() {
    const label = create('label', 'pre-label', 'Ton idée de thème — une seule, et elle sera définitive');
    label.htmlFor = 'pre-idea';
    const input = create('textarea', 'text-input pre-idea');
    input.id = 'pre-idea';
    input.rows = 2;
    input.maxLength = Themes.LIMITS.textMax;
    input.placeholder = 'Ex. Une poursuite dans un château hanté';
    input.value = draft.text;
    const counter = create('div', 'pre-counter');
    counter.id = 'pre-counter';
    const send = create('button', 'btn btn-primary btn-big', 'Envoyer mon idée');
    send.id = 'pre-send';
    send.type = 'button';
    const sent = create('div', 'pre-sent');
    sent.id = 'pre-sent';
    sent.hidden = true;
    const error = create('p', 'form-error');
    error.id = 'pre-error';
    error.setAttribute('role', 'alert');
    const people = create('ul', 'pre-people');
    people.id = 'pre-people';

    input.addEventListener('input', () => {
      draft.text = input.value;
      updatePropose();
    });
    send.addEventListener('click', () => {
      const text = input.value.replace(/\s+/g, ' ').trim();
      if (!text) {
        error.textContent = 'Écris une idée avant de l\'envoyer.';
        return;
      }
      error.textContent = '';
      sending = 'propose';
      send.disabled = true;
      const result = ctl.send('propose', { text });
      if (result && result.ok === false) {
        sending = '';
        error.textContent = result.error || 'Idée refusée.';
      }
      updatePropose();
    });
    el.body.append(label, input, counter, send, sent, error, people);
  }

  function updatePropose() {
    const view = ctl.view();
    const mine = view.book.themes.find((theme) => theme.authorId === ctl.youId);
    const input = $('pre-idea');
    if (!input) return;
    const clean = input.value.replace(/\s+/g, ' ').trim();
    $('pre-counter').textContent = input.value.length + '/' + Themes.LIMITS.textMax;
    const sendButton = $('pre-send');
    const sent = $('pre-sent');
    if (mine) {
      sending = '';
      input.disabled = true;
      input.value = mine.text;
      sendButton.disabled = true;
      sendButton.textContent = 'Idée envoyée';
      sent.hidden = false;
      sent.textContent = 'Idée enregistrée : « ' + mine.text + ' ». Elle ne peut plus être modifiée.';
    } else {
      input.disabled = Boolean(sending);
      sendButton.disabled = !clean || Boolean(sending);
      sendButton.textContent = sending ? 'Envoi…' : 'Envoyer mon idée';
      sent.hidden = true;
    }
    const people = $('pre-people');
    people.innerHTML = '';
    presentPlayers().forEach((player) => {
      const done = view.book.proposedBy.includes(player.id);
      const item = create('li', 'pre-person');
      item.classList.toggle('done', done);
      item.style.setProperty('--c', player.color);
      item.dataset.playerId = player.id;
      item.append(GB.avatar.node(player, 'sb-pre'), create('span', 'pre-person-name', player.name + (player.id === ctl.youId ? ' (toi)' : '')), create('small', 'pre-person-state', done ? 'a proposé' : 'réfléchit…'));
      people.append(item);
    });
    const count = presentPlayers().filter((player) => view.book.proposedBy.includes(player.id)).length;
    el.status.textContent = count + '/' + presentPlayers().length + ' ont proposé une idée' + (count < presentPlayers().length ? ' · la phase se termine dès que tout le monde a proposé, ou à la fin du chrono.' : ' · passage au vote…');
  }

  /* ------------------------------------------------------------------ */
  /*  Page 2 — VOTE                                                      */
  /* ------------------------------------------------------------------ */

  function buildVote() {
    const view = ctl.view();
    const box = create('div', 'vote-box');
    box.id = 'vote-box';
    if (view.voteDraw) {
      const draw = create('div', 'vote-draw');
      draw.id = 'vote-draw';
      box.append(draw);
    } else {
      const list = create('div', 'vote-cards');
      list.id = 'vote-cards';
      list.setAttribute('role', 'radiogroup');
      list.setAttribute('aria-label', 'Les idées des autres joueurs');
      const send = create('button', 'btn btn-primary btn-big', 'Voter pour cette idée');
      send.id = 'vote-send';
      send.type = 'button';
      send.addEventListener('click', () => {
        if (!draft.picked || sending) return;
        sending = 'vote';
        const result = ctl.send('vote', { id: draft.picked });
        if (result && result.ok === false) {
          sending = '';
          $('pre-error').textContent = result.error || 'Vote refusé.';
        }
        updateVote();
      });
      const error = create('p', 'form-error');
      error.id = 'pre-error';
      error.setAttribute('role', 'alert');
      box.append(list, send, error);
    }
    el.body.append(box);
  }

  function updateVote() {
    const view = ctl.view();
    const options = view.book.themes.filter((theme) => theme.authorId !== ctl.youId); // jamais sa propre idée
    const voters = presentPlayers().filter((player) => view.book.themes.some((theme) => theme.authorId !== player.id));
    const voted = voters.filter((player) => view.book.voted.includes(player.id)).length;
    if (view.voteDraw) {
      const draw = $('vote-draw');
      const theme = view.book.theme;
      draw.innerHTML = '';
      draw.append(GB.icons.el('dice', 'draw-dice'));
      if (theme) {
        draw.append(create('p', 'draw-label', 'Le sort a choisi :'), create('blockquote', 'draw-theme', '« ' + theme.text + ' »'), create('small', null, 'Idée de ' + (theme.authorName || '?')));
      } else {
        draw.append(create('p', 'draw-label', 'Tirage au sort…'));
      }
      el.status.textContent = 'À deux joueurs il n\'y a pas de vote : le thème est tiré au sort entre les deux idées. La préparation commence dans un instant.';
      return;
    }
    const iVoted = view.book.voted.includes(ctl.youId);
    if (iVoted) sending = '';
    const list = $('vote-cards');
    const sendButton = $('vote-send');
    list.innerHTML = '';
    if (options.length === 0) {
      list.append(create('p', 'pre-empty', 'Aucune idée des autres joueurs à voter : tu n\'as pas de vote à donner. Patiente jusqu\'à la fin de la phase.'));
    }
    options.forEach((theme) => {
      const card = create('button', 'vote-card');
      card.type = 'button';
      card.dataset.themeId = theme.id;
      card.setAttribute('role', 'radio');
      const chosen = draft.picked === theme.id;
      card.classList.toggle('picked', chosen);
      card.setAttribute('aria-checked', String(chosen));
      card.disabled = iVoted;
      card.append(create('span', 'vote-card-text', theme.text), create('small', 'vote-card-tag', iVoted && chosen ? 'Ton vote' : chosen ? 'Sélectionné' : ''));
      card.addEventListener('click', () => {
        if (iVoted) return;
        draft.picked = theme.id;
        updateVote();
      });
      list.append(card);
    });
    sendButton.hidden = options.length === 0;
    sendButton.disabled = iVoted || !draft.picked || Boolean(sending);
    sendButton.textContent = iVoted ? 'Vote enregistré' : sending ? 'Envoi…' : 'Voter pour cette idée';
    el.status.textContent = voted + '/' + voters.length + ' ont voté' + (iVoted ? ' · ton vote est définitif.' : ' · ton vote est définitif et anonyme.');
  }

  /* ------------------------------------------------------------------ */
  /*  Page 3 — PRÉPARATION (tempo, instrument, difficulté)               */
  /* ------------------------------------------------------------------ */

  function prepInstruments() {
    return GB.instruments.pickable();
  }

  function buildPrep() {
    const view = ctl.view();
    const wrap = create('div', 'prep');
    wrap.id = 'prep';

    // Tempo
    const tempo = create('section', 'prep-section');
    tempo.append(create('h3', 'prep-h', 'Tempo de ta chanson'));
    const presets = create('div', 'bpm-presets');
    presets.id = 'bpm-presets';
    Phases.BPM.presets.forEach((value) => {
      const chip = create('button', 'chip', String(value));
      chip.type = 'button';
      chip.dataset.bpm = String(value);
      chip.addEventListener('click', () => setBpm(value));
      presets.append(chip);
    });
    const custom = create('div', 'bpm-custom');
    const down = create('button', 'icon-btn', '−');
    down.type = 'button';
    down.id = 'prep-bpm-down';
    down.setAttribute('aria-label', 'Ralentir');
    const input = create('input', 'text-input bpm-input');
    input.id = 'prep-bpm';
    input.type = 'number';
    input.inputMode = 'numeric';
    input.min = String(Phases.BPM.min);
    input.max = String(Phases.BPM.max);
    input.setAttribute('aria-label', 'Tempo en BPM (entre ' + Phases.BPM.min + ' et ' + Phases.BPM.max + ')');
    const up = create('button', 'icon-btn', '+');
    up.type = 'button';
    up.id = 'prep-bpm-up';
    up.setAttribute('aria-label', 'Accélérer');
    custom.append(down, input, up, create('span', 'bpm-unit', 'BPM (' + Phases.BPM.min + '–' + Phases.BPM.max + ')'));
    down.addEventListener('click', () => setBpm(draft.bpm - 1));
    up.addEventListener('click', () => setBpm(draft.bpm + 1));
    input.addEventListener('input', () => {
      const value = Number(input.value);
      if (Number.isFinite(value) && input.value !== '') {
        draft.bpm = Phases.clampBpm(value, draft.bpm);
        updatePrepBpmChips();
      }
    });
    input.addEventListener('change', () => setBpm(Number(input.value)));
    tempo.append(presets, custom, create('small', 'prep-hint', 'C\'est le tempo de TA chanson : les autres joueurs la compléteront à ce rythme.'));

    // Instrument
    const inst = create('section', 'prep-section');
    inst.append(create('h3', 'prep-h', 'Ton instrument'));
    const grid = create('div', 'prep-insts');
    grid.id = 'prep-insts';
    grid.setAttribute('role', 'radiogroup');
    grid.setAttribute('aria-label', 'Instrument');
    const mine = create('div', 'prep-mine');
    const make = GB.icons.set(create('button', 'btn btn-ghost btn-small'), 'knob', 'Créer mon instrument');
    make.type = 'button';
    make.id = 'btn-prep-synth';
    make.addEventListener('click', () => GB.synthUI.open(GB.INSTRUMENTS[draft.instrumentId] && GB.INSTRUMENTS[draft.instrumentId].custom ? draft.instrumentId : null));
    const manage = GB.icons.set(create('button', 'btn btn-ghost btn-small'), 'headphones', 'Mes sons : importer, écouter, renommer');
    manage.type = 'button';
    manage.id = 'btn-prep-sounds';
    manage.addEventListener('click', () => GB.soundsUI.open());
    mine.append(make, manage, create('small', 'prep-hint', 'Mon instrument : un synthé que tu règles toi-même (forme d\'onde dessinée, filtre, effets…). Un son importé : WAV, MP3 ou OGG. Un son importé se joue comme un instrument, et sa hauteur change sans changer sa vitesse.'));
    inst.append(grid, mine);

    // Difficulté
    const diff = create('section', 'prep-section');
    diff.append(create('h3', 'prep-h', 'Difficulté du piano-roll'));
    const modes = create('div', 'prep-modes');
    modes.id = 'prep-modes';
    modes.setAttribute('role', 'radiogroup');
    modes.setAttribute('aria-label', 'Difficulté');
    Phases.MODES.forEach((modeId) => {
      const info = MODE_INFO[modeId];
      const card = create('button', 'prep-mode');
      card.type = 'button';
      card.dataset.mode = modeId;
      card.setAttribute('role', 'radio');
      card.append(GB.icons.el(info.icon, 'prep-mode-icon'), create('strong', null, info.label), create('small', null, info.help));
      card.addEventListener('click', () => {
        if (view_locked()) return;
        draft.mode = modeId;
        draft.modeTouched = true;
        updatePrep();
      });
      modes.append(card);
    });
    diff.append(modes, create('small', 'prep-hint', 'Tu pourras en changer pendant la composition : tes notes sont toujours conservées.'));

    const ok = GB.icons.set(create('button', 'btn btn-primary btn-big'), 'check', 'Valider mes choix');
    ok.id = 'prep-ok';
    ok.type = 'button';
    ok.addEventListener('click', () => {
      if (view_locked() || sending) return;
      sending = 'prep';
      $('pre-error').textContent = '';
      Promise.resolve(ctl.send('prep', { bpm: draft.bpm, instrumentId: draft.instrumentId, mode: draft.mode, settings: draft.settings })).then((result) => {
        if (result && result.ok === false) {
          sending = '';
          $('pre-error').textContent = result.error || 'Choix refusés.';
          updatePrep();
        }
      });
      updatePrep();
    });
    const error = create('p', 'form-error');
    error.id = 'pre-error';
    error.setAttribute('role', 'alert');
    wrap.append(tempo, inst, diff, ok, error);
    el.body.append(wrap);

    onSoundsChanged = () => {
      if (ctl && builtKey.startsWith('prep')) renderInstrumentGrid();
    };
  }

  function view_locked() {
    const view = ctl.view();
    return view.ready.includes(ctl.youId) || Boolean(view.prep);
  }

  function setBpm(value) {
    if (view_locked()) return;
    draft.bpm = Phases.clampBpm(value, draft.bpm);
    updatePrep();
  }

  function updatePrepBpmChips() {
    document.querySelectorAll('#bpm-presets .chip').forEach((chip) => {
      const on = Number(chip.dataset.bpm) === draft.bpm;
      chip.classList.toggle('active', on);
      chip.setAttribute('aria-pressed', String(on));
    });
  }

  function chooseInstrument(instrumentId) {
    if (view_locked()) return;
    draft.instrumentId = instrumentId;
    draft.settings = GB.INSTRUMENTS[instrumentId] && (GB.INSTRUMENTS[instrumentId].sample || GB.INSTRUMENTS[instrumentId].custom) ? GB.instruments.defaultSettings(instrumentId) : null;
    updatePrep();
    if (GB.INSTRUMENTS[instrumentId].kind !== 'audio') audio.previewInstrument(instrumentId, draft.settings).catch(() => {});
  }

  function renderInstrumentGrid() {
    const grid = $('prep-insts');
    if (!grid) return;
    const ids = prepInstruments();
    if (!ids.includes(draft.instrumentId)) {
      draft.instrumentId = ids.includes('piano') ? 'piano' : ids[0];
      draft.settings = null;
    }
    grid.innerHTML = '';
    const locked = view_locked();
    ids.forEach((instrumentId) => {
      const meta = GB.INSTRUMENTS[instrumentId];
      const card = create('div', 'prep-inst');
      card.classList.toggle('mine', Boolean(meta.sample || meta.custom));
      card.classList.toggle('active', instrumentId === draft.instrumentId);
      card.dataset.instrument = instrumentId;
      const pick = create('button', 'prep-inst-pick');
      pick.type = 'button';
      pick.disabled = locked;
      pick.setAttribute('role', 'radio');
      pick.setAttribute('aria-checked', String(instrumentId === draft.instrumentId));
      pick.append(GB.icons.el(meta.icon, 'ins-icon'), create('strong', null, meta.label), create('small', null, meta.sample ? 'Mon son importé' : meta.custom ? 'Mon instrument' : BLURBS[instrumentId] || ''));
      pick.addEventListener('click', () => chooseInstrument(instrumentId));
      card.append(pick);
      if (meta.kind !== 'audio') {
        const play = GB.icons.set(create('button', 'icon-btn prep-inst-play'), 'play');
        play.type = 'button';
        play.title = 'Écouter ' + meta.label;
        play.setAttribute('aria-label', 'Écouter ' + meta.label);
        play.addEventListener('click', () => {
          audio.previewInstrument(instrumentId, meta.sample || meta.custom ? GB.instruments.defaultSettings(instrumentId) : null, meta.kind === 'drums' ? [0, 2, 4] : [GB.PREVIEW_ROW, GB.PREVIEW_ROW + 4, GB.PREVIEW_ROW + 7]).catch(() => {});
        });
        card.append(play);
      }
      if (meta.custom) {
        const edit = GB.icons.set(create('button', 'icon-btn prep-inst-edit'), 'pencil');
        edit.type = 'button';
        edit.disabled = locked;
        edit.title = 'Modifier ' + meta.label;
        edit.setAttribute('aria-label', 'Modifier ' + meta.label);
        edit.addEventListener('click', () => GB.synthUI.open(instrumentId));
        card.append(edit);
      }
      grid.append(card);
    });
  }

  function updatePrep() {
    const view = ctl.view();
    const locked = view.ready.includes(ctl.youId) || Boolean(view.prep);
    if (locked) sending = '';
    const input = $('prep-bpm');
    if (!input) return;
    if (document.activeElement !== input) input.value = String(draft.bpm);
    input.disabled = locked;
    $('prep-bpm-down').disabled = locked || draft.bpm <= Phases.BPM.min;
    $('prep-bpm-up').disabled = locked || draft.bpm >= Phases.BPM.max;
    document.querySelectorAll('#bpm-presets .chip').forEach((chip) => (chip.disabled = locked));
    updatePrepBpmChips();
    renderInstrumentGrid();
    document.querySelectorAll('#prep-modes .prep-mode').forEach((card) => {
      const on = card.dataset.mode === draft.mode;
      card.classList.toggle('active', on);
      card.setAttribute('aria-checked', String(on));
      card.disabled = locked;
    });
    const ok = $('prep-ok');
    ok.disabled = locked || Boolean(sending);
    if (locked || sending) ok.textContent = locked ? 'Choix validés' : 'Envoi…';
    else GB.icons.set(ok, 'check', 'Valider mes choix');
    const total = presentPlayers().length;
    const ready = presentPlayers().filter((player) => view.ready.includes(player.id)).length;
    el.status.textContent = locked
      ? 'Tu es prêt. ' + (ready < total ? 'En attente de ' + plural(total - ready, 'joueur', 'joueurs') + '…' : 'Tout le monde est prêt : on y va !')
      : ready + '/' + total + ' prêts · à la fin du chrono, ceux qui n\'ont pas validé reçoivent des choix par défaut (piano, Débutant, 110 BPM).';
  }

  /* ------------------------------------------------------------------ */
  /*  Rendu principal                                                    */
  /* ------------------------------------------------------------------ */

  const TITLES = {
    propose: ['Propose une idée de thème', 'Chaque joueur propose UNE SEULE idée pour la musique de la partie. Elle ne pourra pas être modifiée. La phase se termine dès que tout le monde a proposé, ou quand le chrono arrive à zéro.'],
    vote: ['Vote pour un thème', 'Tu vois seulement les idées des AUTRES joueurs. Un seul vote, définitif et anonyme. Égalité : le sort décide. La phase se termine dès que tout le monde a voté, ou à la fin du chrono.'],
    prep: ['Prépare ta chanson', 'Choisis le tempo de ta chanson, ton instrument et ta difficulté avant d\'entrer dans l\'éditeur. Tout le monde passe à la composition en même temps.'],
  };

  function renderTheme(view) {
    const theme = view.book.theme;
    el.theme.hidden = !theme || view.stage === 'propose' || (view.stage === 'vote' && view.voteDraw && false);
    if (el.theme.hidden) return;
    if (view.stage === 'vote') {
      el.theme.hidden = true;
      return;
    }
    el.theme.innerHTML = '';
    el.theme.append(create('span', 'pre-theme-label', 'Thème de la partie'), create('strong', 'pre-theme-text', '« ' + theme.text + ' »'), create('small', 'pre-theme-src', (theme.authorName ? 'Idée de ' + theme.authorName + ' · ' : '') + Themes.sourceLabel(theme)));
  }

  function render() {
    if (!ctl) return;
    const view = ctl.view();
    if (view.stage === 'done') return;
    const key = view.stage + ':' + view.seq;
    if (key !== builtKey) {
      builtKey = key;
      sending = '';
      el.body.innerHTML = '';
      el.status.textContent = '';
      renderSteps(view.stage);
      el.title.textContent = TITLES[view.stage][0];
      el.instructions.textContent = TITLES[view.stage][1];
      if (view.stage === 'propose') buildPropose();
      else if (view.stage === 'vote') buildVote();
      else if (view.stage === 'prep') {
        buildPrep();
        if (ui.getDifficulty && !draft.modeTouched) draft.mode = ui.getDifficulty();
      }
      document.body.dataset.preStage = view.stage;
    }
    renderTheme(view);
    if (view.stage === 'propose') updatePropose();
    else if (view.stage === 'vote') updateVote();
    else if (view.stage === 'prep') updatePrep();
    updateClock(view);
  }

  function startClock() {
    clearInterval(clockTimer);
    clockTimer = setInterval(() => {
      if (!ctl) return;
      try {
        updateClock(ctl.view());
      } catch (error) {
        /* la phase vient de changer : le prochain rendu complet réparera l'affichage */
      }
    }, 200);
  }

  /* ------------------------------------------------------------------ */
  /*  API                                                                */
  /* ------------------------------------------------------------------ */

  function open(controller) {
    ctl = controller;
    builtKey = '';
    sending = '';
    draft = { text: '', picked: null, bpm: Phases.clampBpm(controller.defaultBpm, Phases.BPM.default), instrumentId: 'piano', settings: null, mode: Phases.DEFAULT_MODE, modeTouched: false };
    ui.showScreen('pre');
    startClock();
    render();
  }

  function close() {
    clearInterval(clockTimer);
    clockTimer = null;
    ctl = null;
    builtKey = '';
    onSoundsChanged = null;
    delete document.body.dataset.preStage;
  }

  /* ------------------------------------------------------------------ */
  /*  Contrôleur LOCAL : partie de test avec des personnages             */
  /* ------------------------------------------------------------------ */

  const BOT_THEMES = [
    'Une musique de boss final',
    'La bande-son d\'un jeu sous-marin',
    'Une musique qui fait peur à un fantôme',
    'Une musique qui donne envie de danser',
    'La fin du monde',
    'Un rêve étrange',
    'Un dimanche pluvieux au marché',
    'Une poursuite à dos de dragon',
  ];

  /** `options` : { players, seconds: {propose, vote, prep}, onDone(result), rand?, drawMs? } */
  function createLocalController(options) {
    const players = options.players;
    const ids = players.map((player) => player.id);
    const rand = options.rand || Math.random;
    const you = players.find((player) => player.isHuman) || players[0];
    const defaultBpm = options.defaultBpm || Phases.BPM.default;
    const pre = Phases.create(ids, performance.now(), options.seconds, options.drawMs !== undefined ? { drawMs: options.drawMs } : undefined);
    const botTimers = [];
    let ticker = null;
    let finished = false;

    const context = () => ({ now: performance.now(), present: ids, rand, defaultBpm });
    const delay = () => timings.botMinMs + rand() * (timings.botMaxMs - timings.botMinMs);
    const bots = players.filter((player) => player.id !== you.id);
    const themeStart = Math.floor(rand() * BOT_THEMES.length); // idées différentes pour chaque personnage

    function botAct(stage) {
      bots.forEach((bot, index) => {
        const timer = setTimeout(() => {
          if (finished || pre.stage !== stage) return;
          if (stage === 'propose') {
            // Un personnage « lent » peut ne rien proposer si le chrono tombe avant : on ne fabrique jamais d'idée à sa place.
            Phases.propose(pre, context(), bot, BOT_THEMES[(themeStart + index) % BOT_THEMES.length]);
          } else if (stage === 'vote') {
            const options = Themes.optionsFor(pre.book, bot.id);
            if (options.length) Phases.vote(pre, context(), bot.id, options[Math.floor(rand() * options.length)].id);
          } else if (stage === 'prep') {
            const list = ['piano', 'synth', 'bass', 'lead', 'trumpet', 'flute'];
            Phases.prepReady(pre, context(), bot.id, {
              bpm: Phases.BPM.presets[Math.floor(rand() * Phases.BPM.presets.length)],
              instrumentId: list[Math.floor(rand() * list.length)],
              mode: Phases.MODES[Math.floor(rand() * Phases.MODES.length)],
              settings: null,
            });
          }
          step();
        }, delay());
        botTimers.push(timer);
      });
    }

    function step() {
      if (finished) return;
      const before = pre.stage;
      Phases.tick(pre, context());
      if (pre.stage !== before) {
        botTimers.splice(0).forEach(clearTimeout);
        if (pre.stage === 'done') {
          finished = true;
          clearInterval(ticker);
          if (typeof options.onDone === 'function') options.onDone({ theme: pre.book.theme, preps: JSON.parse(JSON.stringify(pre.prep)) });
          return;
        }
        botAct(pre.stage);
      }
      render();
    }

    const controller = {
      online: false,
      youId: you.id,
      defaultBpm,
      pre,
      view: () => Phases.view(pre, performance.now()),
      players: () => players.map((player) => Object.assign({ connected: true }, player)),
      send(command, arg) {
        const input = arg || {};
        let result;
        if (command === 'propose') result = Phases.propose(pre, context(), you, input.text);
        else if (command === 'vote') result = Phases.vote(pre, context(), you.id, String(input.id));
        else if (command === 'prep') result = Phases.prepReady(pre, context(), you.id, input);
        else result = { ok: false, error: 'Commande inconnue.' };
        step();
        return result;
      },
      quit() {
        controller.stop();
      },
      stop() {
        finished = true;
        clearInterval(ticker);
        botTimers.splice(0).forEach(clearTimeout);
      },
    };
    ticker = setInterval(step, 200);
    botAct('propose');
    return controller;
  }

  if (el.quit) {
    el.quit.addEventListener('click', () => {
      if (!ctl) return;
      if (ctl.online) {
        if (window.confirm('Quitter la partie ? Ta place sera libérée.')) ctl.quit();
        return;
      }
      ctl.quit();
      close();
      if (GB.gameUI) GB.gameUI.leavePregame();
    });
  }

  GB.pregameUI = {
    open,
    close,
    refresh: render,
    isOpen: () => Boolean(ctl),
    controller: () => ctl,
    createLocalController,
    timings,
    /** Un message d'erreur du serveur arrive pendant une phase : on rend la main au joueur. */
    notify(message) {
      sending = '';
      const target = $('pre-error');
      if (target) target.textContent = message || '';
      render();
    },
    /** La bibliothèque de sons a changé (import, renommage, suppression) : la liste des instruments suit. */
    soundsChanged() {
      if (onSoundsChanged) onSoundsChanged();
    },
    /** Un son importé est choisi depuis « Mes sons » pendant la préparation. */
    chooseSound(instrumentId) {
      if (ctl && builtKey.startsWith('prep')) {
        chooseInstrument(instrumentId);
        return true;
      }
      return false;
    },
  };
})((window.GB = window.GB || {}));

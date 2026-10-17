/**
 * GARTIC BANDE — panneau de la voix enregistrée (piste « Voix (micro) »).
 *
 * Parcours : Enregistrer (micro demandé seulement à ce clic) → Terminer → Réécouter →
 * placer dans la boucle (glisser, ◀ ▶) → régler le volume → Recommencer si besoin → valider le tour.
 *
 * Deux façons d'enregistrer :
 *   « Enregistrer »              libre : on parle, puis on place l'extrait où on veut dans la boucle ;
 *   « Enregistrer sur la boucle » la chanson joue pendant l'enregistrement : la voix est calée sur le début
 *                                 de la boucle (le décalage de démarrage du micro est retranché).
 */
(function (GB) {
  'use strict';

  const { CONFIG, store, audio, voice } = GB;
  const ui = GB.ui;
  const $ = (id) => document.getElementById(id);

  const el = {
    panel: $('voice-panel'),
    status: $('voice-status'),
    btnRec: $('btn-rec'),
    btnRecLoop: $('btn-rec-loop'),
    btnStop: $('btn-rec-stop'),
    btnPlay: $('btn-rec-play'),
    btnRedo: $('btn-rec-redo'),
    level: $('voice-level'),
    ruler: $('voice-ruler'),
    timeline: $('voice-timeline'),
    btnLeft: $('btn-clip-left'),
    btnRight: $('btn-clip-right'),
    pos: $('voice-pos'),
    gain: $('voice-gain'),
    gainValue: $('voice-gain-value'),
  };

  const rec = {
    active: false,
    trackId: null,
    loopMode: false,
    loopTrim: 0,
    startedAt: 0,
    autoStopTimer: null,
    tickTimer: null,
    raf: null,
    drag: null,
  };

  function create(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function loopSeconds() {
    return (CONFIG.STEP_COUNT * 60) / store.state.bpm;
  }

  function currentTrack() {
    const track = store.getSelectedTrack();
    return track && GB.INSTRUMENTS[track.instrumentId].kind === 'audio' ? track : null;
  }

  function setStatus(message, kind) {
    el.status.textContent = message || '';
    el.status.className = 'voice-status' + (kind ? ' ' + kind : '');
  }

  function describePosition(start) {
    const bar = Math.floor(start / CONFIG.STEPS_PER_BAR) + 1;
    const beat = start - (bar - 1) * CONFIG.STEPS_PER_BAR + 1;
    const beatText = Number.isInteger(beat) ? String(beat) : String(Math.round(beat * 100) / 100).replace('.', ',');
    return 'Mesure ' + bar + ', temps ' + beatText;
  }

  /* ------------------------------------------------------------------ */
  /*  Affichage                                                          */
  /* ------------------------------------------------------------------ */

  function clipColumns(clip) {
    return (clip.duration * store.state.bpm) / 60; // la voix dure un nombre fixe de secondes, donc un nombre variable de temps
  }

  function renderTimeline(track) {
    el.timeline.innerHTML = '';
    el.ruler.innerHTML = '';
    el.timeline.style.setProperty('--cols', CONFIG.STEP_COUNT);
    el.ruler.style.setProperty('--cols', CONFIG.STEP_COUNT);
    el.timeline.style.setProperty('--track-color', track.color);
    for (let bar = 0; bar < CONFIG.STEP_COUNT / CONFIG.STEPS_PER_BAR; bar += 1) el.ruler.append(create('span', null, 'Mesure ' + (bar + 1)));
    if (!track.clip) {
      el.timeline.append(create('p', 'voice-empty', 'Ton enregistrement apparaîtra ici : tu pourras le glisser où tu veux dans la boucle.'));
      return;
    }
    const clip = track.clip;
    const block = create('div', 'voice-clip');
    block.tabIndex = 0;
    block.setAttribute('role', 'slider');
    block.setAttribute('aria-label', 'Position de l\'enregistrement');
    block.setAttribute('aria-valuetext', describePosition(clip.start));
    block.style.setProperty('--x', clip.start);
    const columns = Math.min(clipColumns(clip), CONFIG.STEP_COUNT - clip.start);
    block.style.setProperty('--w', columns);
    const canvas = create('canvas');
    canvas.width = 480;
    canvas.height = 80;
    block.append(canvas, create('span', 'voice-clip-label', clip.duration.toFixed(1).replace('.', ',') + ' s'));
    el.timeline.append(block);
    voice.drawWave(canvas, clip.peaks, 'rgba(255,255,255,0.95)');
    if (clipColumns(clip) > CONFIG.STEP_COUNT - clip.start + 0.01) block.classList.add('cut');
  }

  function render() {
    const track = currentTrack();
    el.panel.hidden = !track;
    if (!track) {
      if (rec.active) cancelRecording();
      return;
    }
    if (rec.active && rec.trackId !== track.id) cancelRecording();

    const locked = track.locked;
    const hasClip = Boolean(track.clip);
    const recording = rec.active;
    renderTimeline(track);

    el.btnRec.hidden = recording;
    el.btnRecLoop.hidden = recording;
    el.btnStop.hidden = !recording;
    el.btnRec.textContent = hasClip ? '⏺ Réenregistrer' : '⏺ Enregistrer';
    el.btnRecLoop.textContent = hasClip ? '🎼 Réenregistrer sur la boucle' : '🎼 Enregistrer sur la boucle';
    el.btnRec.disabled = locked;
    el.btnRecLoop.disabled = locked;
    el.btnPlay.disabled = !hasClip || recording;
    el.btnRedo.disabled = locked || !hasClip || recording;
    el.btnLeft.disabled = locked || !hasClip || recording || track.clip.start <= 0;
    el.btnRight.disabled = locked || !hasClip || recording || track.clip.start >= CONFIG.STEP_COUNT - 1;
    el.gain.disabled = locked || !hasClip || recording;
    el.gain.value = hasClip ? track.clip.gainDb : 0;
    el.gainValue.textContent = (hasClip ? (track.clip.gainDb > 0 ? '+' : '') + track.clip.gainDb : 0) + ' dB';
    el.pos.textContent = hasClip ? describePosition(track.clip.start) : '—';
    ui.renderTracks(); // « enregistrement 1,5 s » dans la liste des pistes
    ui.renderStageHeader();
  }

  /* ------------------------------------------------------------------ */
  /*  Enregistrement                                                     */
  /* ------------------------------------------------------------------ */

  function stopTimers() {
    clearTimeout(rec.autoStopTimer);
    clearInterval(rec.tickTimer);
    cancelAnimationFrame(rec.raf);
    rec.autoStopTimer = rec.tickTimer = rec.raf = null;
    el.level.style.setProperty('--level', 0);
  }

  function animateLevel() {
    el.level.style.setProperty('--level', voice.getLevel().toFixed(3));
    if (rec.active) rec.raf = requestAnimationFrame(animateLevel);
  }

  async function startRecording(loopMode) {
    const track = currentTrack();
    if (!track || track.locked || rec.active || voice.isRecording()) return;
    setStatus('Demande d\'accès au micro… accepte la demande du navigateur.', 'info');
    el.btnRec.disabled = true;
    el.btnRecLoop.disabled = true;
    rec.trackId = track.id;
    rec.loopMode = loopMode;
    rec.loopTrim = 0;
    if (loopMode) audio.stop();
    try {
      const limit = loopSeconds() + (loopMode ? 1 : 0);
      const started = await voice.start({ maxSeconds: limit, onAutoStop: () => finishRecording() });
      rec.active = true;
      rec.startedAt = started.startedAt;
      if (loopMode) {
        await audio.play();
        // Le son de la boucle sort `lookAhead` secondes après l'appel : c'est lui, pas le clic, qui donne le temps zéro.
        const audibleStart = performance.now() + Tone.getContext().lookAhead * 1000;
        rec.loopTrim = Math.min(0.6, Math.max(0, (audibleStart - rec.startedAt) / 1000));
        clearTimeout(rec.autoStopTimer);
        rec.autoStopTimer = setTimeout(() => finishRecording(), (rec.loopTrim + loopSeconds()) * 1000 + 60);
      }
      rec.tickTimer = setInterval(() => {
        const seconds = (performance.now() - rec.startedAt) / 1000;
        setStatus('● Enregistrement en cours… ' + seconds.toFixed(1).replace('.', ',') + ' s' + (loopMode ? ' (la boucle s\'arrête toute seule)' : ' · durée maximale ' + Math.round(loopSeconds()) + ' s'), 'recording');
      }, 100);
      animateLevel();
      render();
      if (GB.gameUI) GB.gameUI.refreshActions();
    } catch (error) {
      rec.active = false;
      stopTimers();
      if (loopMode) audio.stop();
      if (error && error.code === 'cancelled') setStatus('', '');
      else {
        setStatus(error.message || 'Impossible d\'enregistrer.', 'error');
        ui.showToast('Micro indisponible — lis le message sous le titre 🎤');
      }
      render();
    }
  }

  async function finishRecording() {
    if (!rec.active) return;
    const track = store.getTrack(rec.trackId);
    const loopMode = rec.loopMode;
    const trim = rec.loopTrim;
    rec.active = false;
    stopTimers();
    setStatus('Traitement de l\'enregistrement…', 'info');
    render();
    try {
      const clip = await voice.stop({ trimSeconds: loopMode ? trim : 0, maxLength: loopSeconds() });
      if (loopMode) audio.stop();
      if (!track || !store.getTrack(track.id) || track.locked) return;
      const previous = track.clip;
      if (previous && !loopMode) {
        clip.start = previous.start; // on réenregistre « à la même place »
        clip.gainDb = previous.gainDb;
      } else if (previous) {
        clip.gainDb = previous.gainDb;
      }
      store.setClip(track.id, clip);
      audio.syncTracks();
      const silent = Math.max.apply(null, clip.peaks) < 0.02;
      setStatus(
        silent
          ? 'L\'enregistrement est presque silencieux : vérifie ton micro (ou monte le volume) et recommence.'
          : 'Enregistrement prêt (' + clip.duration.toFixed(1).replace('.', ',') + ' s). Réécoute-le, place-le dans la boucle, puis valide ton tour.',
        silent ? 'error' : 'ok'
      );
    } catch (error) {
      setStatus(error.message || 'L\'enregistrement a échoué.', 'error');
      if (loopMode) audio.stop();
    }
    render();
  }

  function cancelRecording() {
    voice.cancel();
    rec.active = false;
    stopTimers();
    if (rec.loopMode) audio.stop();
    setStatus('', '');
  }

  /* ------------------------------------------------------------------ */
  /*  Placement et volume                                                */
  /* ------------------------------------------------------------------ */

  function nudge(delta) {
    const track = currentTrack();
    if (!track || !track.clip || !store.moveClip(track.id, track.clip.start + delta)) return;
    render();
  }

  function onPointerDown(event) {
    const block = event.target.closest('.voice-clip');
    const track = currentTrack();
    if (!block || !track || !track.clip || track.locked || rec.active) return;
    event.preventDefault();
    const rect = el.timeline.getBoundingClientRect();
    rec.drag = { pointerId: event.pointerId, startX: event.clientX, startPos: track.clip.start, columnWidth: rect.width / CONFIG.STEP_COUNT, moved: false };
    block.classList.add('dragging');
    try {
      block.setPointerCapture(event.pointerId);
    } catch (error) {
      /* pas indispensable */
    }
  }

  function onPointerMove(event) {
    const drag = rec.drag;
    const track = currentTrack();
    if (!drag || event.pointerId !== drag.pointerId || !track || !track.clip) return;
    const delta = (event.clientX - drag.startX) / drag.columnWidth;
    if (Math.abs(event.clientX - drag.startX) > 2) drag.moved = true;
    if (store.moveClip(track.id, drag.startPos + delta)) {
      const block = el.timeline.querySelector('.voice-clip');
      const clip = track.clip;
      block.style.setProperty('--x', clip.start);
      block.style.setProperty('--w', Math.min(clipColumns(clip), CONFIG.STEP_COUNT - clip.start));
      block.setAttribute('aria-valuetext', describePosition(clip.start));
      el.pos.textContent = describePosition(clip.start);
    }
  }

  function onPointerUp(event) {
    const drag = rec.drag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    rec.drag = null;
    render();
  }

  /* ------------------------------------------------------------------ */
  /*  Branchement                                                        */
  /* ------------------------------------------------------------------ */

  function bind() {
    el.btnRec.addEventListener('click', () => startRecording(false));
    el.btnRecLoop.addEventListener('click', () => startRecording(true));
    el.btnStop.addEventListener('click', () => finishRecording());
    el.btnPlay.addEventListener('click', () => {
      const track = currentTrack();
      if (track) audio.previewClip(track.id);
    });
    el.btnRedo.addEventListener('click', () => {
      const track = currentTrack();
      if (!track || !store.clearClip(track.id)) return;
      audio.stop();
      audio.syncTracks();
      setStatus('Enregistrement effacé : tu peux recommencer.', 'info');
      render();
    });
    el.btnLeft.addEventListener('click', () => nudge(-1));
    el.btnRight.addEventListener('click', () => nudge(1));
    el.gain.addEventListener('input', () => {
      const track = currentTrack();
      if (!track || !store.setClipGain(track.id, el.gain.value)) return;
      audio.syncTracks();
      el.gainValue.textContent = (track.clip.gainDb > 0 ? '+' : '') + track.clip.gainDb + ' dB';
    });
    el.timeline.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    el.timeline.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowLeft') nudge(event.shiftKey ? -1 : -0.25);
      else if (event.key === 'ArrowRight') nudge(event.shiftKey ? 1 : 0.25);
      else return;
      event.preventDefault();
      const block = el.timeline.querySelector('.voice-clip');
      if (block) block.focus();
    });
  }

  GB.voiceUI = {
    render,
    /** Coupe tout enregistrement en cours et efface le message (changement de piste, fin de partie…). */
    reset() {
      if (rec.active || voice.isRecording()) cancelRecording();
      setStatus('', '');
    },
    isRecording: () => rec.active,
  };
  bind();
})((window.GB = window.GB || {}));

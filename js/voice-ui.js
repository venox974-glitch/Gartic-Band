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
    deviceKey: 'default',
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

  /* ---- Affichage en direct : le curseur avance et le bloc rouge de la voix se dessine pendant qu'on chante ---- */
  const live = { canvas: null, cursor: null, levels: [], raf: 0, previewFrom: 0, previewStart: 0, previewUntil: 0 };

  function ensureOverlay() {
    live.canvas = create('canvas', 'voice-live');
    live.cursor = create('div', 'voice-cursor');
    live.cursor.hidden = true;
    el.timeline.append(live.canvas, live.cursor);
  }

  /** Position du curseur en temps (colonnes) ; null = rien à suivre. */
  function livePosition() {
    const now = performance.now();
    if (now < live.previewUntil) return live.previewFrom + ((now - live.previewStart) / 1000) * (store.state.bpm / 60);
    if (audio.getStatus() === 'playing') return audio.getPlayheadPosition();
    if (rec.active && !rec.counting) return ((now - (rec.zeroAt || rec.startedAt)) / 1000) * (store.state.bpm / 60);
    return null;
  }

  function drawLive(position) {
    const canvas = live.canvas;
    if (!canvas || !canvas.isConnected) return;
    const width = el.timeline.clientWidth;
    const height = el.timeline.clientHeight;
    if (canvas.width !== width * 2 || canvas.height !== height * 2) {
      canvas.width = width * 2;
      canvas.height = height * 2;
    }
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!rec.active || !live.levels.length) return;
    const perCol = canvas.width / CONFIG.STEP_COUNT;
    const x0 = live.levels[0].x * perCol;
    const x1 = Math.min(canvas.width, Math.max(x0 + 4, position * perCol));
    // le « cube rouge » : il s'allonge avec le curseur ; les barres blanches montrent le volume de la voix à chaque instant
    ctx.fillStyle = '#e0314b';
    ctx.strokeStyle = '#20123f';
    ctx.lineWidth = 6;
    const top = 16;
    const blockH = canvas.height - 32;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x0, top, x1 - x0, blockH, 18);
    else ctx.rect(x0, top, x1 - x0, blockH);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    const mid = top + blockH / 2;
    live.levels.forEach((sample) => {
      const x = sample.x * perCol;
      const h = Math.max(4, sample.v * (blockH - 16));
      ctx.fillRect(x, mid - h / 2, Math.max(3, perCol / 8), h);
    });
  }

  function liveLoop() {
    live.raf = 0;
    if (el.panel.hidden) return;
    const position = livePosition();
    if (live.cursor && live.cursor.isConnected) {
      live.cursor.hidden = position === null;
      if (position !== null) live.cursor.style.setProperty('--px', Math.max(0, Math.min(CONFIG.STEP_COUNT, position)));
    }
    if (rec.active && !rec.counting && position !== null) {
      const x = Math.max(0, Math.min(CONFIG.STEP_COUNT, position));
      const bucket = Math.floor(x * 4); // une barre toutes les 1/4 de colonne : on garde le volume le plus fort du créneau
      let last = live.levels[live.levels.length - 1];
      if (last && x < last.x - 1) { live.levels = []; last = null; } // la boucle a redémarré (la position de départ était périmée) : on repart de zéro
      if (last && last.bucket === bucket) last.v = Math.max(last.v, voice.getLevel());
      else live.levels.push({ x, bucket, v: voice.getLevel() });
      drawLive(Math.min(CONFIG.STEP_COUNT, position));
    }
    if (position !== null || rec.active) live.raf = requestAnimationFrame(liveLoop);
  }

  function startLive() {
    if (!live.raf) live.raf = requestAnimationFrame(liveLoop);
  }

  function renderTimeline(track) {
    el.timeline.innerHTML = '';
    el.ruler.innerHTML = '';
    el.timeline.style.setProperty('--cols', CONFIG.STEP_COUNT);
    el.ruler.style.setProperty('--cols', CONFIG.STEP_COUNT);
    el.timeline.style.setProperty('--track-color', track.color);
    for (let bar = 0; bar < CONFIG.STEP_COUNT / CONFIG.STEPS_PER_BAR; bar += 1) el.ruler.append(create('span', null, 'Mesure ' + (bar + 1)));
    if (!track.clip) {
      el.timeline.append(create('p', 'voice-empty', 'Ton enregistrement apparaîtra ici : tu le verras se dessiner en direct pendant que le curseur avance.'));
      ensureOverlay();
      startLive();
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
    ensureOverlay();
    startLive();
  }

  function refreshCalibBanner() {
    const banner = $('voice-calib');
    if (banner) banner.hidden = !GB.micprefs || GB.micprefs.hasAnyCalibrated();
  }

  function render() {
    const track = currentTrack();
    el.panel.hidden = !track;
    refreshCalibBanner();
    if (!track) {
      if (rec.active) cancelRecording();
      return;
    }
    if (rec.active && rec.trackId !== track.id) cancelRecording();

    const locked = track.locked;
    const hasClip = Boolean(track.clip);
    const recording = rec.active;
    renderTimeline(track);

    const phoneRec = phoneRecordMode();
    el.btnRec.hidden = recording || !phoneRec; // hors Phone : seulement « sur la boucle » ; en Phone (chant de mémoire) : seulement l'enregistrement sans musique
    el.btnRecLoop.hidden = recording || phoneRec;
    el.btnRec.classList.toggle('btn-primary', phoneRec);
    el.btnRec.classList.toggle('btn-secondary', !phoneRec);
    el.btnStop.hidden = !recording;
    GB.icons.set(el.btnRec, 'record', hasClip ? 'Réenregistrer' : 'Enregistrer ma voix');
    GB.icons.set(el.btnRecLoop, 'loop', hasClip ? 'Réenregistrer sur la boucle' : 'Enregistrer sur la boucle');
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

  /** Petit bip (compte à rebours) : fréquence en Hz, durée en ms. Silencieux si l'audio n'est pas encore débloqué. */
  function beep(frequency, ms, volume) {
    try {
      const ctx = Tone.getContext().rawContext;
      if (ctx.state !== 'running') return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const now = ctx.currentTime;
      osc.type = 'sine';
      osc.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(volume || 0.3, now + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + ms / 1000);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + ms / 1000 + 0.03);
    } catch (error) {
      /* pas de bip : le visuel suffit */
    }
  }

  /**
   * Compte à rebours 3-2-1 : GRAND nombre au milieu de l'écran (posé sur la page, il ne disparaît jamais quand le panneau se redessine)
   * + un bip à chaque nombre et un bip plus aigu au départ. S'arrête juste après le « 1 ».
   */
  function countdown() {
    return new Promise((resolve) => {
      let n = 3;
      rec.counting = true;
      const badge = create('div', 'voice-countdown');
      badge.setAttribute('role', 'timer');
      badge.setAttribute('aria-live', 'assertive');
      const number = create('span', 'vc-number', String(n));
      badge.append(number, create('small', 'vc-hint', rec.loopMode ? 'La boucle démarre après le 1' : 'Tu chantes après le 1'));
      document.body.append(badge);
      beep(660, 160);
      setStatus('Prépare-toi… on commence après le 1.', 'info');
      const timer = setInterval(() => {
        n -= 1;
        if (n >= 1 && rec.active) {
          number.textContent = String(n);
          number.style.animation = 'none';
          void number.offsetWidth; // relance l'animation « pop »
          number.style.animation = '';
          beep(660, 160);
          return;
        }
        clearInterval(timer);
        rec.counting = false;
        if (rec.active) {
          beep(1100, 320, 0.35);
          number.textContent = '🎤';
          badge.classList.add('go');
          setTimeout(() => badge.remove(), 450);
        } else badge.remove();
        resolve();
      }, 1000);
      rec.countdownTimer = timer;
    });
  }

  /** Phone : on chante / on enregistre SANS musique (de mémoire) : la timeline défile quand même, avec le compte à rebours. */
  function phoneRecordMode() {
    return document.body.classList.contains('phone-active') && ['sing'].includes(document.body.getAttribute('data-phone-kind'));
  }

  async function startRecording(loopMode) {
    const track = currentTrack();
    if (!track || track.locked || rec.active || voice.isRecording()) return;
    setStatus('Demande d\'accès au micro… accepte la demande du navigateur.', 'info');
    el.btnRec.disabled = true;
    el.btnRecLoop.disabled = true;
    rec.trackId = track.id;
    rec.loopMode = loopMode;
    rec.timed = loopMode || phoneRecordMode(); // avec compte à rebours et départ calé sur le zéro de la timeline
    rec.loopTrim = 0;
    rec.zeroAt = 0;
    if (rec.timed) audio.stop();
    try {
      const limit = loopSeconds() + (rec.timed ? 5 : 0);
      const started = await voice.start({ maxSeconds: limit, onAutoStop: () => finishRecording() });
      rec.active = true;
      rec.startedAt = started.startedAt;
      rec.deviceKey = started.deviceKey || 'default';
      live.levels = [];
      startLive();
      if (rec.timed) {
        render(); // le bouton « Terminer » (annuler) est disponible dès le compte à rebours
        await countdown(); // 3, 2, 1 : le micro écoute déjà, le départ vient juste après le « 1 »
        if (!rec.active) return;
        if (loopMode) await audio.play();
        // Le son de la boucle sort `lookAhead` secondes après l'appel : c'est lui, pas le clic, qui donne le temps zéro.
        const audibleStart = performance.now() + (loopMode ? Tone.getContext().lookAhead * 1000 : 0);
        rec.zeroAt = audibleStart;
        // + le retard du micro (calibrage de l'accueil) : la voix enregistrée arrive plus tard que ce qui a été chanté
        rec.loopTrim = Math.min(6, Math.max(0, (audibleStart - rec.startedAt) / 1000 + (GB.micprefs ? GB.micprefs.getLatencyMs(rec.deviceKey) / 1000 : 0)));
        clearTimeout(rec.autoStopTimer);
        rec.autoStopTimer = setTimeout(() => finishRecording(), (rec.loopTrim + loopSeconds()) * 1000 + 60);
      }
      rec.tickTimer = setInterval(() => {
        const seconds = (performance.now() - rec.startedAt) / 1000;
        setStatus('● Enregistrement en cours… ' + seconds.toFixed(1).replace('.', ',') + ' s' + (rec.timed ? ' (ça s\'arrête tout seul)' : ' · durée maximale ' + Math.round(loopSeconds()) + ' s'), 'recording');
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
        ui.showToast('Micro indisponible — lis le message sous le titre');
      }
      render();
    }
  }

  async function finishRecording() {
    if (!rec.active) return;
    if (rec.counting) { cancelRecording(); render(); return; } // « Terminer » pendant le compte à rebours = annuler
    const track = store.getTrack(rec.trackId);
    const loopMode = rec.loopMode;
    const timed = rec.timed;
    const trim = rec.loopTrim;
    rec.active = false;
    stopTimers();
    setStatus('Traitement de l\'enregistrement…', 'info');
    render();
    try {
      const clip = await voice.stop({ trimSeconds: timed ? trim : 0, maxLength: loopSeconds() });
      if (loopMode) audio.stop();
      if (!track || !store.getTrack(track.id) || track.locked) return;
      const previous = track.clip;
      if (previous && !timed) {
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
    document.querySelectorAll('.voice-countdown').forEach((node) => node.remove());
    clearInterval(rec.countdownTimer);
    rec.counting = false;
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
    if ($('voice-calib-btn')) $('voice-calib-btn').addEventListener('click', () => GB.calibration && GB.calibration.open());
    if (GB.micprefs) GB.micprefs.onChange(refreshCalibBanner);
    el.btnRec.addEventListener('click', () => startRecording(false));
    el.btnRecLoop.addEventListener('click', () => startRecording(true));
    el.btnStop.addEventListener('click', () => finishRecording());
    el.btnPlay.addEventListener('click', () => {
      const track = currentTrack();
      if (track && track.clip) {
        live.previewFrom = track.clip.start;
        live.previewStart = performance.now();
        live.previewUntil = live.previewStart + track.clip.duration * 1000;
        startLive();
      }
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
    beep,
  };
  bind();
})((window.GB = window.GB || {}));

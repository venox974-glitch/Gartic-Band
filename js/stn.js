/**
 * GARTIC BANDE — Speech to Note : chante, les notes apparaissent en direct dans le piano-roll.
 *
 * Ce fichier = micro + session de capture + calibrages + fenêtre. Le calcul (détection de hauteur, suivi de notes,
 * estimation de latence) est dans js/stn-core.js, testé sous Node.
 *
 * Tout reste dans le navigateur : aucun enregistrement n'est conservé ni envoyé (on lit le signal du micro par morceaux, on le jette).
 * Le micro n'est demandé qu'après un clic sur l'outil, et ses pistes sont arrêtées dès qu'on ferme la fenêtre / termine / annule.
 */
(function (GB) {
  'use strict';

  const core = GB.stnCore;
  const CONFIG = GB.CONFIG;
  const $ = (id) => document.getElementById(id);

  /* ------------------------------------------------------------------ */
  /*  RÉGLAGES (à modifier ici)                                          */
  /* ------------------------------------------------------------------ */
  const SETTINGS = {
    COUNTDOWN_SECONDS: 3, // compte à rebours proposé au départ (le joueur peut le changer dans la fenêtre)
    DURATION_SECONDS: 20, // durée de capture proposée au départ
    FRAME_MS: 25, // fréquence d'analyse du micro
    FFT_SIZE: 2048, // taille de la fenêtre d'analyse (≈ 46 ms)
    COUNT_GO_MS: 700, // durée d'affichage de « C'est parti ! »
    LATENCY_CLICKS: 10, // nombre de repères du calibrage de latence
    LATENCY_INTERVAL: 0.8, // secondes entre deux repères
    LATENCY_SKIP: 2, // les premiers repères servent d'échauffement
    MAX_COMPENSATION_MS: 400, // la compensation ne déplace jamais les notes de plus que ça
    VOICE_RANGES: { low: [48, 55, 60], mid: [60, 67, 72], high: [67, 74, 79] }, // notes de référence (MIDI) du calibrage vocal
    REF_NOTE_SECONDS: 1.4, // durée de la note de référence
    LISTEN_SECONDS: 3.5, // temps laissé pour la reproduire
  };

  const STORAGE_KEY = 'gartic-bande.stn.v1';
  const prefs = { duration: SETTINGS.DURATION_SECONDS, countdown: SETTINGS.COUNTDOWN_SECONDS, quantize: false, gridUnit: 'auto', octave: 0, range: 'mid', attackSens: 0.5, attackGap: 90, debug: false };
  const mp = GB.micprefs; // compensation de latence par micro : partagée avec le panneau Paramètres (js/mic-prefs.js)

  function loadPrefs() {
    try {
      const raw = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || 'null');
      if (raw && typeof raw === 'object') {
        if ([10, 20, 30, 60].includes(raw.duration)) prefs.duration = raw.duration;
        if ([0, 3, 5].includes(raw.countdown)) prefs.countdown = raw.countdown;
        if (typeof raw.quantize === 'boolean') prefs.quantize = raw.quantize;
        if (['auto', '1', '0.5', '0.25', '0.125'].includes(String(raw.gridUnit))) prefs.gridUnit = String(raw.gridUnit);
        if ([-2, -1, 0, 1, 2].includes(raw.octave)) prefs.octave = raw.octave;
        if (['low', 'mid', 'high'].includes(raw.range)) prefs.range = raw.range;
        if ([0.25, 0.5, 0.85].includes(raw.attackSens)) prefs.attackSens = raw.attackSens;
        if ([60, 90, 140, 200].includes(raw.attackGap)) prefs.attackGap = raw.attackGap;
        if (typeof raw.debug === 'boolean') prefs.debug = raw.debug;
      }
    } catch (error) {
      /* stockage indisponible : réglages par défaut */
    }
  }
  function savePrefs() {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    } catch (error) {
      /* stockage bloqué : valable jusqu'à la fermeture de la page */
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Micro (analyse en continu, rien n'est enregistré)                  */
  /* ------------------------------------------------------------------ */
  const mic = { stream: null, source: null, analyser: null, ctx: null, buffer: null, scratch: null, timer: null, deviceKey: 'default', label: '', listeners: new Set(), lost: null };

  function support() {
    if (!window.isSecureContext) return { ok: false, message: 'Le navigateur bloque le micro sur cette page (connexion non sécurisée). Ouvre le jeu depuis http://localhost ou une adresse https://.' };
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') return { ok: false, message: 'Ce navigateur ne permet pas d\'utiliser le micro. Essaie une version récente de Chrome, Edge, Firefox ou Safari.' };
    if (!(window.AudioContext || window.webkitAudioContext) || typeof Tone === 'undefined') return { ok: false, message: 'Ce navigateur ne permet pas l\'analyse audio nécessaire (Web Audio absent).' };
    return { ok: true };
  }

  function describeMicError(error) {
    const name = error && error.name;
    if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') return 'L\'accès au micro est refusé. Autorise le micro pour cette page (icône de cadenas près de l\'adresse), puis rouvre Speech to Note.';
    if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') return 'Aucun micro détecté. Branche un micro ou un casque, puis réessaie.';
    if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') return 'Le micro est utilisé par une autre application ou ne répond pas. Ferme-la, puis réessaie.';
    if (name === 'NotSupportedError') return 'Le micro n\'est pas disponible ici (autorisation refusée par le navigateur, ou navigateur non compatible). Vérifie les autorisations du site, puis rouvre Speech to Note.';
    return 'Impossible d\'utiliser le micro : ' + ((error && error.message) || 'erreur inconnue') + '.';
  }

  function micIsOpen() {
    return Boolean(mic.stream);
  }

  async function openMic() {
    if (micIsOpen()) return;
    const check = support();
    if (!check.ok) throw new Error(check.message);
    if (GB.voice && GB.voice.isRecording && GB.voice.isRecording()) throw new Error('Un enregistrement de voix est déjà en cours : termine-le d\'abord.');
    await Tone.start();
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    } catch (error) {
      throw new Error(describeMicError(error));
    }
    const ctx = Tone.getContext().rawContext;
    mic.ctx = ctx;
    mic.stream = stream;
    mic.lost = null;
    mic.source = ctx.createMediaStreamSource(stream);
    mic.analyser = ctx.createAnalyser();
    mic.analyser.fftSize = SETTINGS.FFT_SIZE;
    mic.analyser.smoothingTimeConstant = 0;
    mic.buffer = new Float32Array(SETTINGS.FFT_SIZE);
    mic.scratch = new Float32Array(SETTINGS.FFT_SIZE);
    mic.source.connect(mic.analyser); // volontairement PAS relié à la sortie : pas de retour sonore
    const track = stream.getAudioTracks()[0];
    try {
      mic.deviceKey = (track && track.getSettings && track.getSettings().deviceId) || 'default';
      mic.label = (track && track.label) || '';
    } catch (error) {
      mic.deviceKey = 'default';
    }
    if (track) {
      track.addEventListener('ended', () => {
        if (!micIsOpen()) return;
        mic.lost = 'Le micro a été déconnecté ou coupé.';
        mic.listeners.forEach((fn) => fn(null, mic.lost));
        onMicLost();
      });
    }
    mic.timer = setInterval(pollMic, SETTINGS.FRAME_MS);
  }

  function closeMic() {
    clearInterval(mic.timer);
    mic.timer = null;
    if (mic.source) {
      try {
        mic.source.disconnect();
      } catch (error) {
        /* déjà déconnecté */
      }
    }
    if (mic.stream) mic.stream.getTracks().forEach((track) => track.stop());
    mic.stream = null;
    mic.source = null;
    mic.analyser = null;
    updateMicState();
  }

  function pollMic() {
    if (!mic.analyser) return;
    mic.analyser.getFloatTimeDomainData(mic.buffer);
    const now = mic.ctx.currentTime;
    const frame = core.detectPitch(mic.buffer, mic.ctx.sampleRate, session.active ? session.pitchOptions : null, mic.scratch);
    frame.t = now - SETTINGS.FFT_SIZE / 2 / mic.ctx.sampleRate; // centre de la fenêtre analysée
    frame.now = now;
    // attaques : détecteur sur les NOUVEAUX échantillons seulement (≈ 25 ms), horloge du contexte audio comme les trames de hauteur
    frame.onsets = [];
    if (session.active && live.attack) {
      const sr = mic.ctx.sampleRate;
      const fresh = mic.lastNow == null ? 0 : Math.min(mic.buffer.length, Math.max(0, Math.round((now - mic.lastNow) * sr)));
      if (fresh >= 64) frame.onsets = live.attack.process(mic.buffer.subarray(mic.buffer.length - fresh), now, sr);
    }
    mic.lastNow = now;
    mic.listeners.forEach((fn) => fn(frame, null));
  }

  function onMic(fn) {
    mic.listeners.add(fn);
    return () => mic.listeners.delete(fn);
  }

  /* ------------------------------------------------------------------ */
  /*  Outils communs                                                     */
  /* ------------------------------------------------------------------ */
  function stepSeconds() {
    return Tone.Time(CONFIG.STEP_SUBDIVISION).toSeconds();
  }

  function setText(id, text) {
    const node = $(id);
    if (node) node.textContent = text;
  }

  function meterWidth(rms) {
    return Math.round(Math.min(1, rms * 5) * 100) + '%';
  }

  function toast(text) {
    if (GB.ui && GB.ui.showToast) GB.ui.showToast(text);
  }

  function currentLatencyMs() {
    return mp.getLatencyMs(mic.deviceKey);
  }

  function updateMicState() {
    const node = $('stn-mic-state');
    if (!node) return;
    node.textContent = mic.lost ? 'Micro : ' + mic.lost : micIsOpen() ? 'Micro : actif' : 'Micro : fermé';
  }

  function showError(message) {
    const node = $('stn-error');
    node.textContent = message || '';
    node.hidden = !message;
  }

  /* ------------------------------------------------------------------ */
  /*  La fenêtre (préparation / calibrages)                              */
  /* ------------------------------------------------------------------ */
  const session = { active: false, pitchOptions: null };
  let view = 'setup';
  let dialogFrameOff = null;

  function showView(name) {
    view = name;
    document.querySelectorAll('#stn-dialog section[data-view]').forEach((section) => {
      section.hidden = section.dataset.view !== name;
    });
  }

  function refreshSettingsUi() {
    $('stn-duration').value = String(prefs.duration);
    $('stn-countdown').value = String(prefs.countdown);
    $('stn-quant').checked = prefs.quantize;
    $('stn-grid').value = prefs.gridUnit;
    $('stn-grid').disabled = !prefs.quantize;
    $('stn-latency-on').checked = mp.isEnabled();
    const entry = mp.get(mic.deviceKey);
    $('stn-latency-ms').value = entry ? entry.ms : 0;
    $('stn-latency-ms').disabled = !mp.isEnabled();
    $('stn-octave').value = String(prefs.octave);
    $('stn-attack').value = String(prefs.attackSens);
    $('stn-attack-gap').value = String(prefs.attackGap);
    $('stn-debug').checked = prefs.debug;
    let info;
    if (!mp.isEnabled()) info = 'Compensation désactivée : les notes sont placées exactement là où le son est détecté.';
    else if (entry && entry.method) info = 'Compensation actuelle : ' + entry.ms + ' ms (' + (entry.method === 'visual' ? 'calibrage visuel' : entry.method === 'click' ? 'calibrage sonore' : 'réglage manuel') + (entry.reliability ? ', fiabilité ' + entry.reliability : '') + '), enregistrée pour ce micro.';
    else info = 'Compensation actuelle : ' + (entry ? entry.ms : 0) + ' ms. Lance le calibrage du microphone pour l\'estimer.';
    setText('stn-latency-info', info);
  }

  function bindSettingsUi() {
    $('stn-duration').addEventListener('change', (e) => {
      prefs.duration = Number(e.target.value);
      savePrefs();
    });
    $('stn-countdown').addEventListener('change', (e) => {
      prefs.countdown = Number(e.target.value);
      savePrefs();
    });
    $('stn-quant').addEventListener('change', (e) => {
      prefs.quantize = e.target.checked;
      savePrefs();
      refreshSettingsUi();
    });
    $('stn-grid').addEventListener('change', (e) => {
      prefs.gridUnit = e.target.value;
      savePrefs();
    });
    $('stn-latency-on').addEventListener('change', (e) => {
      mp.setEnabled(e.target.checked);
      refreshSettingsUi();
    });
    $('stn-latency-ms').addEventListener('change', (e) => {
      const ms = Math.max(-SETTINGS.MAX_COMPENSATION_MS, Math.min(SETTINGS.MAX_COMPENSATION_MS, Math.round(Number(e.target.value) || 0)));
      const existing = mp.get(mic.deviceKey);
      if (existing && existing.ms === ms) return refreshSettingsUi(); // même valeur : on garde le calibrage mesuré tel quel (pas de « manuel » par accident)
      mp.setLatency(mic.deviceKey, { ms, reliability: '', method: 'manual', label: mic.label || '' });
      refreshSettingsUi();
    });
    $('stn-octave').addEventListener('change', (e) => {
      prefs.octave = Number(e.target.value);
      savePrefs();
    });
    $('stn-attack').addEventListener('change', (e) => {
      prefs.attackSens = Number(e.target.value);
      savePrefs();
    });
    $('stn-attack-gap').addEventListener('change', (e) => {
      prefs.attackGap = Number(e.target.value);
      savePrefs();
    });
    $('stn-debug').addEventListener('change', (e) => {
      prefs.debug = e.target.checked;
      savePrefs();
    });
  }

  function findProblemWithTrack() {
    const track = GB.store.getSelectedTrack();
    if (!track) return 'Aucune piste sélectionnée.';
    if (track.locked) return 'Cette piste est verrouillée : choisis une piste que tu peux modifier.';
    const meta = GB.INSTRUMENTS[track.instrumentId];
    if (!meta || meta.kind !== 'melodic') return 'Speech to Note crée des notes mélodiques : choisis (ou ajoute) une piste de piano, synthé, basse, lead, trompette, flûte ou voix robot.';
    return '';
  }

  /** Clic sur l'outil : vérifie, demande le micro, puis ouvre la fenêtre. */
  // « Calibrage seul » : ouvert depuis le panneau Paramètres de l'accueil, sans piste ni capture (pas de bouton Démarrer).
  let calibrationOnly = false;

  async function openTool(options) {
    const dialog = $('stn-dialog');
    if (dialog.open || session.active) return;
    calibrationOnly = Boolean(options && options.calibrationOnly);
    dialog.dataset.only = calibrationOnly ? 'calibration' : '';
    $('stn-start').hidden = calibrationOnly;
    if (GB.audio.getStatus() === 'playing') GB.audio.pause();
    showError('');
    showView('setup');
    $('stn-live-note').textContent = '—';
    $('stn-meter').style.width = '0%';
    const trackProblem = calibrationOnly ? '' : findProblemWithTrack();
    const check = support();
    let micError = '';
    if (!trackProblem && check.ok) {
      try {
        await openMic();
      } catch (error) {
        micError = error.message;
      }
    }
    const message = trackProblem || (!check.ok ? check.message : '') || micError;
    refreshSettingsUi();
    updateMicState();
    const blocked = Boolean(message);
    ['stn-start', 'stn-open-latency', 'stn-open-voice'].forEach((id) => {
      $(id).disabled = blocked;
    });
    showError(message);
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    if (dialogFrameOff) dialogFrameOff();
    dialogFrameOff = onMic((frame) => {
      if (!frame) return updateMicState();
      if (view === 'setup') {
        $('stn-meter').style.width = meterWidth(frame.rms);
        $('stn-live-note').textContent = frame.midi != null && frame.conf >= core.DEFAULTS.minConfidence ? core.midiName(frame.midi) : '—';
      }
      updateMicState();
    });
  }

  function closeDialog() {
    cancelCalibrations();
    if (dialogFrameOff) dialogFrameOff();
    dialogFrameOff = null;
    const dialog = $('stn-dialog');
    if (dialog.open) dialog.close();
    else dialog.removeAttribute('open');
    if (!session.active) closeMic(); // le micro n'est gardé que pour la capture en cours
    dialog.dataset.only = '';
    $('stn-start').hidden = false;
    calibrationOnly = false;
    closeListeners.forEach((fn) => fn());
  }
  const closeListeners = new Set();

  /* ------------------------------------------------------------------ */
  /*  Calibrage du microphone (latence)                                  */
  /* ------------------------------------------------------------------ */
  const calib = { running: false, token: 0, mode: 'click', result: null, raf: 0, stopFrames: null };

  function cancelCalibrations() {
    calib.token += 1;
    calib.running = false;
    cancelAnimationFrame(calib.raf);
    if (calib.stopFrames) calib.stopFrames();
    calib.stopFrames = null;
    voiceCal.token += 1;
    voiceCal.running = false;
    if (voiceCal.stopFrames) voiceCal.stopFrames();
    voiceCal.stopFrames = null;
    setBall(0);
  }

  /** Boule : p = 0 à gauche, p = 1 posée sur la ligne cible (à 88 % de la largeur). */
  function setBall(p) {
    const dot = $('stn-ball-dot');
    if (dot) dot.style.left = 'calc(' + Math.max(0, Math.min(1, p)) * 88 + '% - 17px)';
  }

  function latencyHow() {
    return calib.mode === 'click'
      ? 'Tu entends des clics réguliers. Dis « ta » (court) en même temps que chaque clic, comme si tu chantais sur le rythme. Les 2 premiers clics servent d\'échauffement.'
      : 'Une boule glisse vers la ligne et la touche à intervalles réguliers. Dis « ta » (court) à chaque fois qu\'elle touche la ligne. Cette méthode ne tient pas compte du retard du son de ton casque.';
  }

  function setLatencyMode(mode) {
    if (calib.running) return;
    calib.mode = mode;
    document.querySelectorAll('[data-lat-mode]').forEach((b) => b.classList.toggle('active', b.dataset.latMode === mode));
    setText('stn-lat-how', latencyHow());
    $('stn-ball').classList.toggle('is-click', mode === 'click');
    resetLatencyResult();
  }

  function resetLatencyResult() {
    calib.result = null;
    $('stn-lat-result').hidden = true;
    $('stn-lat-use').hidden = true;
    $('stn-lat-run').textContent = 'Lancer le calibrage';
    setText('stn-lat-progress', '');
    $('stn-lat-disable').hidden = !(mp.isEnabled() && mp.get(mic.deviceKey) && mp.get(mic.deviceKey).ms !== 0);
  }

  function playClick(ctx, time) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = 1400;
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(0.35, time + 0.003);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.05);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(time);
    osc.stop(time + 0.06);
  }

  async function runLatencyCalibration() {
    if (calib.running || !micIsOpen()) return;
    calib.running = true;
    calib.result = null;
    const token = (calib.token += 1);
    const mode = calib.mode;
    $('stn-lat-result').hidden = true;
    $('stn-lat-use').hidden = true;
    $('stn-lat-run').disabled = true;
    const ctx = mic.ctx;
    const interval = SETTINGS.LATENCY_INTERVAL;
    const t0 = ctx.currentTime + 2.2;
    const targets = Array.from({ length: SETTINGS.LATENCY_CLICKS }, (_, k) => t0 + k * interval);
    const onsets = [];
    const detector = core.createOnsetDetector({ floor: 0.003 });
    // le détecteur n'écoute qu'à partir de l'échauffement : on laisse d'abord le bruit de fond s'installer
    calib.stopFrames = onMic((frame) => {
      if (!frame || token !== calib.token) return;
      if (detector.push(frame.t, frame.rms) && frame.t > t0 - 0.35) onsets.push(frame.t);
    });
    if (mode === 'click') targets.forEach((time) => playClick(ctx, time));
    const pulse = $('stn-ball-pulse');
    const end = targets[targets.length - 1] + 1.0;
    const draw = () => {
      if (token !== calib.token) return;
      const now = ctx.currentTime;
      if (now < t0 - 0.3) {
        setText('stn-lat-progress', 'Prépare-toi… ' + Math.max(1, Math.ceil(t0 - now)));
        setBall(0);
      } else {
        const k = Math.min(targets.length - 1, Math.max(0, Math.floor((now - t0) / interval + 1e-6)));
        const nextIndex = Math.min(targets.length - 1, Math.max(0, Math.ceil((now - t0) / interval - 1e-6)));
        const phase = (now - (t0 + (nextIndex - 1) * interval)) / interval; // 0 -> 1 vers la cible suivante
        setBall(now < t0 ? (now - (t0 - interval)) / interval : phase);
        const sinceHit = now - (t0 + k * interval);
        pulse.classList.toggle('on', sinceHit >= 0 && sinceHit < 0.12);
        setText('stn-lat-progress', 'Repère ' + (Math.min(nextIndex, targets.length - 1) + 1) + ' / ' + targets.length + (nextIndex < SETTINGS.LATENCY_SKIP ? ' (échauffement)' : ''));
      }
      if (now < end) calib.raf = requestAnimationFrame(draw);
      else finishLatency();
    };
    const finishLatency = () => {
      if (token !== calib.token) return;
      if (calib.stopFrames) calib.stopFrames();
      calib.stopFrames = null;
      calib.running = false;
      $('stn-lat-run').disabled = false;
      pulse.classList.remove('on');
      setBall(0);
      const result = core.estimateLatency(targets, onsets, { skip: SETTINGS.LATENCY_SKIP, maxCompensationMs: SETTINGS.MAX_COMPENSATION_MS });
      result.mode = mode;
      calib.result = result;
      showLatencyResult(result);
    };
    draw();
  }

  function showLatencyResult(result) {
    const box = $('stn-lat-result');
    box.hidden = false;
    setText('stn-lat-progress', 'Terminé.');
    const current = mp.getLatencyMs(mic.deviceKey);
    const lines = [];
    if (result.matched < 3 || result.kept.length < 3) {
      lines.push('<p><strong>Mesure impossible.</strong> Seulement ' + result.matched + ' son(s) détecté(s) sur ' + result.expected + '. Parle un peu plus fort, rapproche le micro, ou vérifie que le jeu n\'est pas en sourdine, puis refais le calibrage.</p>');
    } else {
      const badge = result.reliability === 'bonne' ? 'is-good' : result.reliability === 'moyenne' ? 'is-mid' : 'is-low';
      lines.push('<p class="stn-big">Décalage estimé : <strong>' + (result.medianMs >= 0 ? '+' : '') + result.medianMs + ' ms</strong></p>');
      lines.push('<p>Fiabilité : <span class="stn-badge ' + badge + '">' + result.reliability + '</span> (' + result.kept.length + ' mesures retenues sur ' + result.expected + ', écart typique ' + result.sdMs + ' ms)</p>');
      lines.push('<p>Compensation actuellement utilisée : ' + current + ' ms · proposée : ' + result.compensationMs + ' ms</p>');
      if (result.suspectEcho) lines.push('<p class="stn-warn">Les sons arrivent presque exactement avec les clics : le micro a peut-être entendu les haut-parleurs. Mets un casque et refais le calibrage.</p>');
      if (result.reliability === 'faible') lines.push('<p class="stn-warn">Mesures peu cohérentes : ce résultat n\'est pas fiable. Refais le calibrage en répétant bien le même « ta » bref.</p>');
      lines.push('<p class="stn-small">Rappel : c\'est le décalage global observé (ta réaction comprise), pas la latence exacte du matériel.</p>');
    }
    box.innerHTML = lines.join('');
    const usable = result.kept.length >= 3;
    $('stn-lat-use').hidden = !usable;
    $('stn-lat-use').textContent = result.reliability === 'faible' ? 'Utiliser quand même (' + result.compensationMs + ' ms)' : 'Utiliser ' + result.compensationMs + ' ms';
    $('stn-lat-run').textContent = 'Refaire le calibrage';
    $('stn-lat-disable').hidden = !(mp.isEnabled() && mp.get(mic.deviceKey) && mp.get(mic.deviceKey).ms !== 0);
  }

  function bindLatencyUi() {
    document.querySelectorAll('[data-lat-mode]').forEach((b) => b.addEventListener('click', () => setLatencyMode(b.dataset.latMode)));
    $('stn-open-latency').addEventListener('click', () => {
      showView('latency');
      setLatencyMode(calib.mode);
    });
    $('stn-lat-run').addEventListener('click', runLatencyCalibration);
    $('stn-lat-use').addEventListener('click', () => {
      if (!calib.result) return;
      mp.setLatency(mic.deviceKey, { ms: calib.result.compensationMs, reliability: calib.result.reliability, method: calib.result.mode, label: mic.label || '' });
      mp.setEnabled(true);
      savePrefs();
      refreshSettingsUi();
      showResultSaved();
    });
    $('stn-lat-disable').addEventListener('click', () => {
      mp.setEnabled(false);
      savePrefs();
      refreshSettingsUi();
      setText('stn-lat-progress', 'Compensation désactivée (le réglage est gardé : tu peux la réactiver dans la fenêtre principale).');
      $('stn-lat-disable').hidden = true;
    });
  }

  function showResultSaved() {
    setText('stn-lat-progress', 'Compensation enregistrée pour ce micro : ' + mp.get(mic.deviceKey).ms + ' ms.');
    $('stn-lat-use').hidden = true;
    $('stn-lat-disable').hidden = false;
  }

  /* ------------------------------------------------------------------ */
  /*  Calibrage vocal                                                    */
  /* ------------------------------------------------------------------ */
  const voiceCal = { running: false, token: 0, refs: [], results: [], index: 0, stopFrames: null, synth: null };

  function voiceRefs() {
    return SETTINGS.VOICE_RANGES[prefs.range].slice(0, 2); // deux notes d'abord ; une troisième sur demande
  }

  function resetVoiceCal() {
    voiceCal.token += 1;
    voiceCal.running = false;
    voiceCal.results = [];
    voiceCal.index = 0;
    voiceCal.refs = voiceRefs();
    renderVoiceCal();
  }

  function renderVoiceCal() {
    const list = $('stn-voice-list');
    list.innerHTML = '';
    voiceCal.results.forEach((r, i) => {
      const li = document.createElement('li');
      li.className = r.status === 'ok' ? 'is-ok' : 'is-bad';
      const head = '<strong>Note ' + (i + 1) + '</strong> · référence ' + core.midiName(r.refMidi);
      if (r.status === 'ok') {
        const octave = r.octaves ? ' · <span class="stn-warn-inline">' + (r.octaves > 0 ? '+' : '') + r.octaves + ' octave' + (Math.abs(r.octaves) > 1 ? 's' : '') + '</span>' : '';
        li.innerHTML = head + ' · détectée <strong>' + r.detectedName + '</strong>' + octave + ' · écart ' + (r.cents >= 0 ? '+' : '') + r.cents + ' cents · <span class="stn-badge is-good">fiable</span>';
      } else {
        li.innerHTML = head + ' · <span class="stn-badge is-low">non fiable</span> ' + r.reason;
      }
      list.append(li);
    });
    const done = voiceCal.results.length;
    const nextRef = voiceCal.refs[done];
    const total = voiceCal.refs.length;
    const run = $('stn-voice-run');
    run.disabled = voiceCal.running;
    $('stn-voice-more').hidden = !(done >= 2 && total === 2) || voiceCal.running;
    if (nextRef !== undefined) {
      run.hidden = false;
      run.textContent = done === 0 ? 'Jouer la note 1' : 'Jouer la note ' + (done + 1);
      if (!voiceCal.running) setText('stn-voice-progress', done === 0 ? 'Choisis ta voix, puis lance la première note : écoute-la, et chante-la quand c\'est à toi.' : 'Note ' + done + ' terminée.');
    } else {
      run.hidden = true;
      setText('stn-voice-progress', 'Calibrage terminé.');
    }
    const summaryBox = $('stn-voice-summary');
    const apply = $('stn-voice-apply');
    apply.hidden = true;
    if (done >= 2) {
      const summary = core.summarizeVoice(voiceCal.results);
      summaryBox.textContent = summary.message;
      if (summary.consistentOctave) {
        apply.hidden = false;
        const on = prefs.octave === -summary.octaveOffset;
        apply.textContent = on ? 'Annuler le décalage d\'octave' : 'Décaler mes notes de ' + (-summary.octaveOffset > 0 ? '+' : '') + -summary.octaveOffset + ' octave' + (Math.abs(summary.octaveOffset) > 1 ? 's' : '');
        apply.dataset.octave = String(-summary.octaveOffset);
      }
    } else {
      summaryBox.textContent = done === 1 ? 'Une seule note ne permet pas de conclure : fais-en au moins deux.' : '';
    }
  }

  async function playReference(midi) {
    const synth = new Tone.Synth({ oscillator: { type: 'triangle' }, envelope: { attack: 0.03, decay: 0.1, sustain: 0.8, release: 0.2 } }).toDestination();
    voiceCal.synth = synth;
    synth.volume.value = -8;
    synth.triggerAttackRelease(core.midiToHz(midi), SETTINGS.REF_NOTE_SECONDS);
    await new Promise((resolve) => setTimeout(resolve, SETTINGS.REF_NOTE_SECONDS * 1000 + 350));
    setTimeout(() => synth.dispose(), 400);
    voiceCal.synth = null;
  }

  async function runVoiceNote() {
    if (voiceCal.running || !micIsOpen()) return;
    const index = voiceCal.results.length;
    const ref = voiceCal.refs[index];
    if (ref === undefined) return;
    voiceCal.running = true;
    const token = (voiceCal.token += 1);
    renderVoiceCal();
    setText('stn-voice-progress', 'Écoute la note de référence : ' + core.midiName(ref) + '…');
    await playReference(ref);
    if (token !== voiceCal.token) return;
    const frames = [];
    voiceCal.stopFrames = onMic((frame) => {
      if (!frame || token !== voiceCal.token) return;
      frames.push({ midi: frame.midi, conf: frame.conf, rms: frame.rms });
      $('stn-voice-meter').style.width = meterWidth(frame.rms);
      $('stn-voice-live').textContent = frame.midi != null && frame.conf >= core.DEFAULTS.minConfidence ? core.midiName(frame.midi) : '—';
    });
    const endAt = performance.now() + SETTINGS.LISTEN_SECONDS * 1000;
    while (performance.now() < endAt) {
      if (token !== voiceCal.token) return;
      setText('stn-voice-progress', 'Chante ' + core.midiName(ref) + ' maintenant… ' + Math.max(1, Math.ceil((endAt - performance.now()) / 1000)) + ' s');
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    if (voiceCal.stopFrames) voiceCal.stopFrames();
    voiceCal.stopFrames = null;
    if (token !== voiceCal.token) return;
    voiceCal.running = false;
    $('stn-voice-meter').style.width = '0%';
    $('stn-voice-live').textContent = '—';
    voiceCal.results.push(core.evaluateVoiceNote(ref, frames));
    renderVoiceCal();
  }

  function bindVoiceUi() {
    $('stn-open-voice').addEventListener('click', () => {
      showView('voice');
      $('stn-range').value = prefs.range;
      resetVoiceCal();
    });
    $('stn-range').addEventListener('change', (e) => {
      prefs.range = e.target.value;
      savePrefs();
      resetVoiceCal();
    });
    $('stn-voice-run').addEventListener('click', runVoiceNote);
    $('stn-voice-reset').addEventListener('click', resetVoiceCal);
    $('stn-voice-more').addEventListener('click', () => {
      const base = SETTINGS.VOICE_RANGES[prefs.range];
      voiceCal.refs = base.slice(0, 3); // 3e note de la plage
      renderVoiceCal();
    });
    $('stn-voice-apply').addEventListener('click', () => {
      const wanted = Number($('stn-voice-apply').dataset.octave || 0);
      prefs.octave = prefs.octave === wanted ? 0 : wanted;
      savePrefs();
      refreshSettingsUi();
      renderVoiceCal();
    });
    document.querySelectorAll('#stn-dialog [data-back]').forEach((b) =>
      b.addEventListener('click', () => {
        cancelCalibrations();
        showView('setup');
        refreshSettingsUi();
      })
    );
  }

  /* ------------------------------------------------------------------ */
  /*  Capture en direct                                                  */
  /* ------------------------------------------------------------------ */
  const live = { track: null, notes: new Map(), createdIds: [], tracker: null, attack: null, log: [], lastFrame: null, startedAtCtx: 0, lastPos: 0, endAtCtx: 0, stats: null, off: null, countdownTimer: null, token: 0, wasPlayingError: '' };

  function setHud(visible) {
    $('stn-hud').hidden = !visible;
    document.body.classList.toggle('stn-active', visible || !$('stn-overlay').hidden);
  }

  function formatTime(seconds) {
    const s = Math.max(0, Math.ceil(seconds - 1e-6));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  function roomLimit(track, note) {
    let limit = CONFIG.STEP_COUNT;
    track.notes.forEach((other) => {
      if (other.id !== note.id && other.row === note.row && other.step >= note.step + 1e-9) limit = Math.min(limit, other.step);
    });
    return limit;
  }

  /* ---- diagnostic (désactivable : case « Diagnostic » ou ?stndebug=1) ---- */
  function debugOn() {
    return prefs.debug || /[?&]stndebug=1\b/.test(window.location.search);
  }
  function logDebug(kind, text) {
    live.log.push({ kind, text });
    if (live.log.length > 300) live.log.shift();
  }
  function renderDebug(frame, musicalSeconds) {
    const box = $('stn-debug-box');
    if (!box) return;
    box.hidden = !debugOn();
    if (box.hidden) return;
    const f = frame.freq ? frame.freq.toFixed(1) + ' Hz' : '—';
    const m = frame.midi != null ? frame.midi.toFixed(2) : '—';
    const curNote = live.tracker && live.tracker.current ? live.tracker.current() : null;
    const stab = curNote ? core.midiName(curNote.midi) : '—';
    const db = frame.rms > 0 ? (20 * Math.log10(frame.rms)).toFixed(0) : '-∞';
    const head = 'f ' + f + ' · MIDI ' + m + ' · stable ' + stab + ' · niveau ' + db + ' dBFS · confiance ' + (frame.conf != null ? frame.conf.toFixed(2) : '—') + ' · t ' + musicalSeconds.toFixed(2) + ' s';
    box.textContent = head + '\n' + live.log.slice(-6).map((l) => l.text).join('\n');
  }
  function describeEvent(event) {
    const sec = stepSeconds();
    if (event.type === 'attack') return 'attaque ' + event.t.toFixed(2) + ' s (' + event.why + ')';
    if (event.type === 'attack-ignored' || event.type === 'attack-dropped') return event.type + ' ' + event.t.toFixed(2) + ' s : ' + event.reason;
    if (event.type === 'start') return 'DÉBUT #' + event.id + ' ' + core.midiName(event.midi) + ' à ' + event.t.toFixed(2) + ' s (' + event.reason + ')';
    if (event.type === 'end') return 'FIN #' + event.id + ' ' + core.midiName(event.midi) + ' ' + event.start.toFixed(2) + '→' + event.end.toFixed(2) + ' s (' + event.reason + ', ' + ((event.end - event.start) / sec).toFixed(2) + ' pas)';
    if (event.type === 'discard') return 'REJET #' + event.id + ' (' + event.reason + ')';
    if (event.type === 'retune') return 'note #' + event.id + ' corrigée en ' + core.midiName(event.midi) + ' (' + event.reason + ')';
    return '';
  }

  /** Ligne du piano-roll pour une hauteur MIDI (même règle que lors de la création). */
  function rowFor(midi, track) {
    const mapped = core.midiToRow(midi, { octaveShift: prefs.octave });
    let row = mapped.row;
    const view = GB.ui.view;
    if (view && view.mode && !GB.modeAllowsRow(view.mode, view.scale, row)) {
      for (let d = 1; d < 12; d += 1) {
        if (row + d < GB.getRowCount(track.instrumentId) && GB.modeAllowsRow(view.mode, view.scale, row + d)) { row += d; break; }
        if (row - d >= 0 && GB.modeAllowsRow(view.mode, view.scale, row - d)) { row -= d; break; }
      }
    }
    return { row, folded: mapped.folded };
  }

  function handleEvent(event, ctxInfo) {
    const diag = describeEvent(event);
    if (diag) logDebug(event.type, diag);
    if (event.type === 'attack' || event.type === 'attack-ignored' || event.type === 'attack-dropped') return;
    const store = GB.store;
    const track = live.track;
    const sec = stepSeconds();
    const unit = prefs.gridUnit === 'auto' ? store.grid.unit : Number(prefs.gridUnit); // pas de la grille utilisé quand « Aligner sur la grille » est coché
    if (event.type === 'start') {
      const mapped = core.midiToRow(event.midi, { octaveShift: prefs.octave });
      if (mapped.folded) live.stats.folded += 1;
      let step = event.t / sec;
      if (prefs.quantize) step = Math.round(step / unit) * unit;
      step = Math.max(0, step);
      const previous = live.last;
      // grille : deux attaques qui tombent dans la même case ne se fusionnent pas, la nouvelle passe à la case suivante
      if (prefs.quantize && previous && step <= previous.note.step + 1e-6) step = previous.note.step + unit;
      const row = rowFor(event.midi, track).row;
      if (step >= CONFIG.STEP_COUNT - 0.05) return;
      const note = store.addNote(track.id, step, row, 0.05);
      if (!note) {
        live.stats.occupied += 1;
        return;
      }
      // voix monophonique : la note précédente se termine au plus tard quand celle-ci commence
      if (previous && previous.note.step + previous.note.length > step + 1e-6) {
        previous.note.length = Math.round(Math.max(0.05, step - previous.note.step) * 1000) / 1000;
        GB.ui.liveNote.update(track, previous.note);
      }
      const entry = { note, start: step, midi: event.midi, row };
      live.last = entry;
      live.notes.set(event.id, entry);
      live.createdIds.push(note.id);
      GB.ui.liveNote.add(track, note);
    } else if (event.type === 'retune') {
      // la hauteur d'une note qui vient de commencer se précise : on déplace CETTE note (même id), jamais une autre
      const entry = live.notes.get(event.id);
      if (!entry) return;
      const row = rowFor(event.midi, track).row;
      if (row !== entry.note.row && store.moveNote(track.id, entry.note.id, entry.note.step, row)) {
        entry.midi = event.midi;
        entry.row = row;
        GB.ui.liveNote.update(track, entry.note);
      }
    } else if (event.type === 'update') {
      const entry = live.notes.get(event.id);
      if (!entry) return;
      const length = event.end / sec - entry.start;
      const limit = roomLimit(track, entry.note);
      const next = Math.round(Math.max(0.05, Math.min(length, limit - entry.note.step)) * 1000) / 1000;
      if (Math.abs(next - entry.note.length) > 1e-6) {
        entry.note.length = next;
        GB.ui.liveNote.update(track, entry.note);
      }
    } else if (event.type === 'end') {
      const entry = live.notes.get(event.id);
      if (!entry) return;
      let length = event.end / sec - event.start / sec;
      if (prefs.quantize) length = Math.max(unit, Math.round(length / unit) * unit);
      const limit = roomLimit(track, entry.note);
      entry.note.length = Math.round(Math.max(0.05, Math.min(length, limit - entry.note.step, CONFIG.STEP_COUNT - entry.note.step)) * 1000) / 1000;
      GB.ui.liveNote.update(track, entry.note);
      live.notes.delete(event.id);
    } else if (event.type === 'discard') {
      const entry = live.notes.get(event.id);
      if (!entry) return;
      live.stats.discarded += 1;
      store.removeNote(track.id, entry.note.id);
      GB.ui.liveNote.remove(entry.note.id);
      live.createdIds = live.createdIds.filter((id) => id !== entry.note.id);
      live.notes.delete(event.id);
    }
  }

  function updateHudCount() {
    const n = live.createdIds.length;
    setText('stn-hud-count', n + ' note' + (n > 1 ? 's' : ''));
  }

  function onCaptureFrame(frame) {
    if (!frame || !session.active || !live.tracker || !live.capturing) return;
    const sec = stepSeconds();
    const elapsed = frame.now - live.startedAtCtx;
    let pos = GB.audio.getPlayheadPosition();
    // juste après le départ, la tête de lecture (corrigée de l'avance du moteur) peut être légèrement négative = repliée en fin de boucle
    if (elapsed < 1 && live.startPos < 1 && pos > CONFIG.STEP_COUNT / 2) pos -= CONFIG.STEP_COUNT;
    // fin de boucle : la tête de lecture est revenue au début
    if (pos < live.lastPos - 0.5) return void finishSession('Fin de la boucle atteinte.');
    live.lastPos = pos;
    const remaining = Math.min(prefs.duration - elapsed, (CONFIG.STEP_COUNT - pos) * sec);
    if (remaining <= 0.02) return void finishSession('Temps écoulé.');
    // temps musical de la trame : position de la tête de lecture, ramenée au centre de la fenêtre d'analyse, moins la compensation
    const musicalSeconds = pos * sec - (frame.now - frame.t) - currentLatencyMs() / 1000;
    // les attaques sont à l'heure du contexte audio : même conversion que la trame (tête de lecture – retard d'analyse – compensation)
    const comp = currentLatencyMs() / 1000;
    const onsets = (frame.onsets || []).map((o) => Object.assign({}, o, { t: pos * sec - (frame.now - o.t) - comp }));
    const events = live.tracker.push({ t: musicalSeconds, midi: frame.midi, conf: frame.conf, rms: frame.rms, onsets });
    events.forEach((event) => handleEvent(event));
    setText('stn-time', formatTime(remaining));
    $('stn-hud-meter').style.width = meterWidth(frame.rms);
    const reliable = frame.midi != null && frame.conf >= core.DEFAULTS.minConfidence;
    setText('stn-hud-note', reliable ? core.midiName(frame.midi) : '—');
    setText('stn-hud-state', frame.rms < (session.pitchOptions ? session.pitchOptions.minRms : core.DEFAULTS.minRms) ? 'Silence' : reliable ? 'Voix détectée' : 'Son peu clair');
    updateHudCount();
    renderDebug(frame, musicalSeconds);
  }

  async function startSession() {
    if (session.active) return;
    const problem = findProblemWithTrack();
    if (problem) return showError(problem);
    if (!micIsOpen()) {
      try {
        await openMic();
      } catch (error) {
        return showError(error.message);
      }
    }
    const token = (live.token += 1);
    savePrefs();
    live.track = GB.store.getSelectedTrack();
    live.notes = new Map();
    live.createdIds = [];
    live.last = null;
    live.stats = { folded: 0, occupied: 0, discarded: 0 };
    live.lastPos = GB.audio.getCursor ? GB.audio.getCursor() : 0;
    live.startPos = live.lastPos;
    session.active = true;
    session.pitchOptions = null;
    if (dialogFrameOff) dialogFrameOff();
    dialogFrameOff = null;
    $('stn-dialog').close();
    document.body.classList.add('stn-active');
    GB.ui.cancelGesture && GB.ui.cancelGesture();
    if (GB.audio.getStatus() === 'playing') GB.audio.pause();
    setText('stn-time', formatTime(prefs.duration));
    setText('stn-hud-note', '—');
    setText('stn-hud-state', 'Micro actif');
    updateHudCount();
    $('stn-hud').hidden = false;
    live.off = onMic((frame, lostMessage) => {
      if (lostMessage) return;
      if (live.counting) live.floor.push(frame.rms);
      else onCaptureFrame(frame);
    });
    // compte à rebours : on mesure aussi le bruit de fond (silence) pour régler le seuil de voix
    live.counting = true;
    live.capturing = false;
    live.floor = [];
    const seconds = prefs.countdown;
    const box = $('stn-overlay');
    if (seconds > 0) {
      box.hidden = false;
      for (let n = seconds; n >= 1; n -= 1) {
        setText('stn-count-text', String(n));
        await new Promise((resolve) => (live.countdownTimer = setTimeout(resolve, 1000)));
        if (token !== live.token || !session.active) return;
      }
      setText('stn-count-text', 'C\'est parti !');
      await new Promise((resolve) => (live.countdownTimer = setTimeout(resolve, SETTINGS.COUNT_GO_MS)));
      if (token !== live.token || !session.active) return;
    } else {
      await new Promise((resolve) => (live.countdownTimer = setTimeout(resolve, 400)));
      if (token !== live.token || !session.active) return;
    }
    box.hidden = true;
    // bruit de fond = bas niveau observé (20e centile) : robuste si le joueur commence à fredonner pendant le compte à rebours
    const sortedFloor = live.floor.slice().sort((a, b) => a - b);
    const floor = sortedFloor.length ? sortedFloor[Math.floor(sortedFloor.length * 0.2)] : 0;
    session.pitchOptions = { minRms: Math.max(core.DEFAULTS.minRms, Math.min(0.02, floor * 2.5)), attackSensitivity: prefs.attackSens, minAttackGapMs: prefs.attackGap };
    live.tracker = core.createTracker(session.pitchOptions);
    live.attack = core.createAttackDetector({ sensitivity: prefs.attackSens, minRms: Math.max(0.004, Math.min(0.012, floor * 2)), minGapMs: prefs.attackGap });
    live.log = [];
    mic.lastNow = null;
    live.counting = false;
    try {
      await GB.audio.play(); // la lecture démarre ; le curseur avance
    } catch (error) {
      return void abortSession('La lecture n\'a pas pu démarrer : ' + (error && error.message ? error.message : 'erreur audio') + '.');
    }
    if (token !== live.token || !session.active) return;
    live.startedAtCtx = mic.ctx.currentTime;
    live.lastPos = live.startPos;
    live.capturing = true; // l'analyse commence ici, au même instant que la lecture
  }

  /** Retire les écouteurs, le bandeau et libère le micro. */
  function endSessionCommon() {
    live.token += 1;
    clearTimeout(live.countdownTimer);
    live.counting = false;
    live.capturing = false;
    if (live.off) live.off();
    live.off = null;
    session.active = false;
    session.pitchOptions = null;
    live.attack = null;
    $('stn-hud').hidden = true;
    $('stn-overlay').hidden = true;
    document.body.classList.remove('stn-active');
    if (GB.audio.getStatus() === 'playing') GB.audio.pause();
    if (GB.audio.seek && Number.isFinite(live.startPos)) GB.audio.seek(live.startPos); // la barre revient où la capture a commencé : on peut réécouter ou refaire
    closeMic();
  }

  function finishSession(reason) {
    if (!session.active) return;
    const events = live.tracker ? live.tracker.flush(Infinity) : [];
    events.forEach((event) => handleEvent(event)); // termine proprement la note en cours
    const track = live.track;
    // sécurité : une note encore ouverte ne dépasse jamais la boucle
    live.notes.forEach((entry) => {
      entry.note.length = Math.max(0.05, Math.min(entry.note.length, CONFIG.STEP_COUNT - entry.note.step));
      GB.ui.liveNote.update(track, entry.note);
    });
    const count = live.createdIds.length;
    const stats = live.stats;
    endSessionCommon();
    GB.ui.liveNote.finish(); // un seul pas d'« Annuler » pour toute la session
    GB.audio.syncTracks();
    let text = count ? count + ' note' + (count > 1 ? 's' : '') + ' ajoutée' + (count > 1 ? 's' : '') + ' (' + reason + ')' : 'Aucune note détectée (' + reason + '). Chante plus près du micro, plus fort, ou refais le calibrage.';
    if (stats.occupied) text += ' · ' + stats.occupied + ' ignorée' + (stats.occupied > 1 ? 's' : '') + ' (place déjà prise)';
    if (stats.folded) text += ' · ' + stats.folded + ' ramenée' + (stats.folded > 1 ? 's' : '') + ' dans la grille (hors plage)';
    toast(text);
  }

  /** Annulation : toutes les notes créées pendant la session disparaissent. */
  function abortSession(message) {
    if (!session.active) return;
    const track = live.track;
    live.createdIds.forEach((id) => {
      GB.store.removeNote(track.id, id);
      GB.ui.liveNote.remove(id);
    });
    live.createdIds = [];
    live.notes.clear();
    endSessionCommon();
    GB.ui.liveNote.finish();
    GB.audio.syncTracks();
    toast(message || 'Session annulée : aucune note conservée.');
  }

  function onMicLost() {
    if (session.active) abortSession('Le micro a été déconnecté : session annulée, aucune note conservée.');
    else {
      updateMicState();
      showError('Le micro a été déconnecté. Ferme cette fenêtre et rouvre Speech to Note.');
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Branchement                                                        */
  /* ------------------------------------------------------------------ */
  function init() {
    if (!$('stn-dialog') || !$('lt-stn')) return;
    loadPrefs();
    bindSettingsUi();
    bindLatencyUi();
    bindVoiceUi();
    // le calibrage peut aussi être modifié depuis le panneau Paramètres : la fenêtre reste à jour
    mp.onChange(() => {
      if ($('stn-dialog').open) refreshSettingsUi();
    });
    $('lt-stn').addEventListener('click', () => openTool());
    $('stn-close').addEventListener('click', closeDialog);
    $('stn-cancel').addEventListener('click', closeDialog);
    $('stn-dialog').addEventListener('cancel', (event) => {
      event.preventDefault();
      closeDialog();
    });
    $('stn-dialog').addEventListener('close', () => {
      if (!session.active) closeMic();
    });
    $('stn-start').addEventListener('click', startSession);
    $('stn-stop').addEventListener('click', () => finishSession('arrêt manuel'));
    $('stn-abort').addEventListener('click', () => abortSession());
    window.addEventListener('pagehide', () => {
      if (session.active) abortSession('Session interrompue.');
      closeMic();
    });
  }

  GB.stn = {
    SETTINGS,
    open: openTool,
    onClose: (fn) => { closeListeners.add(fn); return () => closeListeners.delete(fn); },
    getMicInfo: () => ({ deviceKey: mic.deviceKey, label: mic.label, open: micIsOpen() }),
    // accès au micro partagé (utilisé par l'écran de calibrage simple, js/calibration-ui.js)
    micApi: {
      support,
      open: openMic,
      close: () => {
        if (!session.active) closeMic();
      },
      isOpen: () => micIsOpen(),
      onFrame: onMic,
      info: () => ({ ctx: mic.ctx, deviceKey: mic.deviceKey, label: mic.label }),
      playClick,
      core,
    },
    isActive: () => session.active,
    getPrefs: () => JSON.parse(JSON.stringify(prefs)),
    // pour les tests : injecter une trame de hauteur comme si elle venait du micro
    _debug: { onCaptureFrame, live, mic, session, finishSession, abortSession },
  };

  init();
})((window.GB = window.GB || {}));

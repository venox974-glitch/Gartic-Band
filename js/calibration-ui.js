/**
 * GARTIC BANDE — écran de calibrage du micro, simple et direct (ouvert depuis la roue dentée de l'accueil).
 *
 * Trois états sur un seul écran :
 *   prêt      : consigne en 3 lignes, jauge du micro (on voit tout de suite qu'il marche), un gros bouton « Commencer » ;
 *   en cours  : un flash et un clic toutes les 0,8 s ; le joueur dit « ta » à chaque clic ; compteur ;
 *   résultat  : le décalage en grand, un verdict (très bon / correct / à refaire). Un résultat fiable est enregistré tout seul.
 *
 * La mesure elle-même (détecteur de sons, médiane, valeurs aberrantes, fiabilité) est celle de Speech to Note
 * (js/stn-core.js : estimateLatency) ; le micro vient de GB.stn.micApi ; le résultat est écrit dans GB.micprefs.
 */
(function (GB) {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const mp = GB.micprefs;
  const CLICKS = 10;
  const SKIP = 2; // les 2 premiers clics servent d'échauffement
  const INTERVAL = 0.8;
  const MAX_MS = 400;

  const state = { running: false, token: 0, off: null, raf: 0, closeCbs: new Set(), result: null, saved: false };

  function api() {
    return GB.stn && GB.stn.micApi;
  }

  function show(name) {
    document.querySelectorAll('#cal-dialog section[data-cal]').forEach((section) => {
      section.hidden = section.dataset.cal !== name;
    });
  }

  function setError(message) {
    const node = $('cal-error');
    node.textContent = message || '';
    node.hidden = !message;
  }

  function meterWidth(rms) {
    return Math.round(Math.max(0, Math.min(1, Math.sqrt(rms) * 2.2)) * 100) + '%';
  }

  function stopRun() {
    state.token += 1;
    state.running = false;
    cancelAnimationFrame(state.raf);
    if (state.off) state.off();
    state.off = null;
    $('cal-flash').classList.remove('on');
  }

  async function prepare() {
    stopRun();
    $('cal-line').hidden = true;
    show('ready');
    setError('');
    state.result = null;
    $('cal-start').disabled = true;
    $('cal-meter').style.width = '0%';
    $('cal-mic').textContent = 'Micro : ouverture… accepte la demande du navigateur.';
    const micApi = api();
    if (!micApi) return setError('Le calibrage n\'est pas disponible sur cette page.');
    const check = micApi.support();
    if (!check.ok) return setError(check.message);
    try {
      await micApi.open();
    } catch (error) {
      return setError(error.message || 'Impossible d\'ouvrir le micro.');
    }
    const info = micApi.info();
    $('cal-mic').textContent = 'Micro : ' + (info.label || 'micro par défaut') + ' — dis quelque chose : la jauge doit bouger.';
    $('cal-start').disabled = false;
    if (state.off) state.off();
    state.off = micApi.onFrame((frame) => {
      if (frame) $('cal-meter').style.width = meterWidth(frame.rms);
    });
  }

  const headset = () => !$('cal-headset') || $('cal-headset').checked;

  function refreshHeadset() {
    const on = headset();
    $('cal-step1').innerHTML = on ? 'Mets ton <strong>casque</strong>.' : 'Pas de casque : <strong>aucun son</strong> ne sera joué (le micro n\'entendrait que les haut-parleurs).';
    $('cal-step2').innerHTML = on ? 'Dis <strong>« ta »</strong> à chaque clic (et à chaque flash).' : 'Une <strong>boule</strong> rebondit : dis <strong>« ta »</strong> à chaque fois qu\'elle <strong>touche la ligne</strong>.';
  }

  function open() {
    const dialog = $('cal-dialog');
    if (!dialog || dialog.open) return;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    prepare();
  }

  function close() {
    stopRun();
    const micApi = api();
    if (micApi) micApi.close();
    const dialog = $('cal-dialog');
    if (dialog.open) dialog.close();
    else dialog.removeAttribute('open');
    state.closeCbs.forEach((fn) => fn(state.saved));
    state.saved = false;
  }

  function verdictOf(result) {
    if (result.matched < 3 || result.kept.length < 3) return { key: 'fail', text: 'Je n\'ai pas assez entendu', cls: 'is-low' };
    if (result.reliability === 'bonne') return { key: 'good', text: 'Très bien, c\'est enregistré', cls: 'is-good' };
    if (result.reliability === 'moyenne') return { key: 'mid', text: 'Correct, c\'est enregistré', cls: 'is-mid' };
    return { key: 'low', text: 'Résultat peu fiable : refais-le', cls: 'is-low' };
  }

  function showResult(result) {
    state.result = result;
    const verdict = verdictOf(result);
    show('result');
    const box = $('cal-verdict');
    box.textContent = verdict.text;
    box.className = 'cal-verdict ' + verdict.cls;
    const usable = verdict.key === 'good' || verdict.key === 'mid';
    $('cal-ms').textContent = result.matched >= 3 && result.kept.length >= 3 ? (result.compensationMs >= 0 ? '+' : '') + result.compensationMs + ' ms' : '—';
    const lines = [];
    if (verdict.key === 'fail') lines.push('Seulement ' + result.matched + ' « ta » entendu(s) sur ' + result.expected + '. Parle un peu plus fort, rapproche le micro, et dis « ta » bien net à chaque clic.');
    else {
      lines.push(result.kept.length + ' mesures retenues sur ' + result.expected + ', écart typique ' + result.sdMs + ' ms.');
      if (result.suspectEcho) lines.push('Attention : les sons arrivent presque exactement avec les clics, le micro a peut-être entendu les haut-parleurs. Mets un casque et refais le calibrage.');
      if (verdict.key === 'low') lines.push('Les mesures ne sont pas assez régulières. Dis « ta » à chaque clic, toujours pareil.');
    }
    $('cal-detail').textContent = lines.join(' ');
    state.saved = false;
    if (usable && !result.suspectEcho) {
      const info = api().info();
      mp.setLatency(info.deviceKey, { ms: result.compensationMs, reliability: result.reliability, method: headset() ? 'click' : 'visual', label: info.label });
      mp.setEnabled(true);
      state.saved = true;
    } else if (usable && result.suspectEcho) {
      $('cal-verdict').textContent = 'À vérifier : pas enregistré';
      $('cal-verdict').className = 'cal-verdict is-mid';
    }
  }

  function start() {
    const micApi = api();
    if (!micApi || !micApi.isOpen() || state.running) return;
    stopRun();
    const token = state.token;
    state.running = true;
    show('running');
    const info = micApi.info();
    const ctx = info.ctx;
    const t0 = ctx.currentTime + 2.2;
    const flash = $('cal-flash');
    const targets = Array.from({ length: CLICKS }, (_, k) => t0 + k * INTERVAL);
    const onsets = [];
    const detector = micApi.core.createOnsetDetector({ floor: 0.003 });
    state.off = micApi.onFrame((frame) => {
      if (!frame || token !== state.token) return;
      if (detector.push(frame.t, frame.rms) && frame.t > t0 - 0.35) onsets.push(frame.t);
    });
    const withSound = headset();
    const ball = !withSound;
    if (withSound) targets.forEach((time) => micApi.playClick(ctx, time));
    $('cal-line').hidden = !ball;
    flash.classList.toggle('ball', ball);
    flash.style.transform = '';
    const end = targets[targets.length - 1] + 1.0;
    const draw = () => {
      if (token !== state.token) return;
      const now = ctx.currentTime;
      if (now < t0 - 0.3) {
        $('cal-count').textContent = 'Prépare-toi… ' + Math.max(1, Math.ceil(t0 - now));
        flash.classList.remove('on');
        if (ball) flash.style.setProperty('--lift', '0');
      } else {
        const k = Math.min(CLICKS - 1, Math.max(0, Math.floor((now - t0) / INTERVAL + 1e-6)));
        const since = now - (t0 + k * INTERVAL);
        if (ball) {
          const phase = Math.max(0, since / INTERVAL); // 0 = la boule touche la ligne, 0,5 = sommet du rebond
          flash.style.setProperty('--lift', String(4 * phase * (1 - phase)));
        } else flash.classList.toggle('on', since >= 0 && since < 0.14);
        $('cal-count').textContent = k < SKIP ? 'Échauffement… dis « ta » à chaque clic' : 'Dis « ta » ! ' + (k + 1 - SKIP) + ' / ' + (CLICKS - SKIP);
      }
      if (now < end) state.raf = requestAnimationFrame(draw);
      else {
        const result = micApi.core.estimateLatency(targets, onsets, { skip: SKIP, maxCompensationMs: MAX_MS });
        stopRun();
        showResult(result);
      }
    };
    draw();
  }

  function init() {
    if (!$('cal-dialog')) return;
    $('cal-close').addEventListener('click', close);
    $('cal-done').addEventListener('click', close);
    $('cal-start').addEventListener('click', start);
    $('cal-headset').addEventListener('change', refreshHeadset);
    refreshHeadset();
    $('cal-retry').addEventListener('click', prepare);
    $('cal-cancel').addEventListener('click', prepare);
    $('cal-dialog').addEventListener('cancel', (event) => {
      event.preventDefault();
      close();
    });
  }

  GB.calibration = {
    open,
    close,
    isOpen: () => Boolean($('cal-dialog') && $('cal-dialog').open),
    onClose(fn) {
      state.closeCbs.add(fn);
      return () => state.closeCbs.delete(fn);
    },
  };
  init();
})((window.GB = window.GB || {}));

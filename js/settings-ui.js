/**
 * GARTIC BANDE — panneau Paramètres de l'accueil (roue dentée en haut à droite).
 *
 * Pour l'instant : le micro. Il lit et modifie les mêmes réglages que Speech to Note (js/mic-prefs.js) ;
 * le calibrage lui-même est l'écran simple de js/calibration-ui.js.
 * Une pastille sur la roue signale qu'aucun micro n'a encore été calibré (vérifié sans demander l'accès au micro).
 */
(function (GB) {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const mp = GB.micprefs;
  const METHODS = { visual: 'calibrage visuel', click: 'calibrage sonore', manual: 'réglage manuel' };
  let reopenAfterCalibration = false;

  function create(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function refreshBadge() {
    const dot = $('gear-dot');
    if (!dot) return;
    const missing = !mp.hasAnyCalibrated();
    dot.hidden = !missing;
    const button = $('btn-settings');
    button.dataset.alert = missing ? '1' : '';
    button.title = missing ? 'Paramètres : ton micro n\'est pas encore calibré' : 'Paramètres';
    button.setAttribute('aria-label', missing ? 'Paramètres (le micro n\'est pas calibré)' : 'Paramètres');
  }

  function formatDate(at) {
    if (!at) return '';
    try {
      return new Date(at).toLocaleDateString('fr-CA', { year: 'numeric', month: 'short', day: 'numeric' });
    } catch (error) {
      return '';
    }
  }

  function render() {
    refreshBadge();
    $('settings-latency-on').checked = mp.isEnabled();
    const entries = mp.list();
    const calibrated = entries.filter((entry) => entry.method !== 'manual').length;
    $('settings-mic-status').textContent = !entries.length
      ? 'Aucun micro calibré pour l\'instant. Le calibrage mesure le retard entre ce que tu chantes et ce que le jeu entend : il sert à placer ta voix et tes notes au bon moment. Ça prend une dizaine de secondes.'
      : calibrated
        ? calibrated + ' micro' + (calibrated > 1 ? 's' : '') + ' calibré' + (calibrated > 1 ? 's' : '') + ' sur cet appareil.'
        : 'Aucun micro n\'est vraiment calibré (seulement des réglages manuels). Lance un calibrage pour plus de précision.';
    const list = $('settings-mic-list');
    list.replaceChildren();
    entries.forEach((entry) => {
      const item = create('li', 'settings-mic');
      const text = create('div', 'settings-mic-text');
      text.append(create('strong', null, entry.label || (entry.id === 'default' ? 'Micro par défaut' : 'Micro (' + entry.id.slice(0, 8) + '…)')));
      const details = [entry.ms + ' ms', METHODS[entry.method] || '', entry.reliability ? 'fiabilité ' + entry.reliability : '', formatDate(entry.at)].filter(Boolean).join(' · ');
      text.append(create('small', null, details));
      const forget = create('button', 'btn btn-ghost settings-forget', 'Oublier');
      forget.type = 'button';
      forget.setAttribute('aria-label', 'Oublier le calibrage de ce micro');
      forget.addEventListener('click', () => mp.forget(entry.id));
      item.append(text, forget);
      list.append(item);
    });
  }

  function openSettings() {
    const dialog = $('settings-dialog');
    render();
    if (dialog.open) return;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  }

  function closeSettings() {
    const dialog = $('settings-dialog');
    if (dialog.open) dialog.close();
    else dialog.removeAttribute('open');
  }

  function init() {
    if (!$('btn-settings') || !mp) return;
    $('btn-settings').addEventListener('click', openSettings);
    $('settings-close').addEventListener('click', closeSettings);
    $('settings-latency-on').addEventListener('change', (event) => mp.setEnabled(event.target.checked));
    $('settings-calibrate').addEventListener('click', () => {
      if (!GB.calibration) return;
      reopenAfterCalibration = true;
      closeSettings();
      GB.calibration.open();
    });
    if (GB.calibration && GB.calibration.onClose) {
      GB.calibration.onClose(() => {
        refreshBadge();
        if (reopenAfterCalibration) {
          reopenAfterCalibration = false;
          openSettings();
        }
      });
    }
    mp.onChange(() => {
      refreshBadge();
      if ($('settings-dialog').open) render();
    });
    refreshBadge();
  }

  GB.settingsUi = { open: openSettings, close: closeSettings, refreshBadge };
  init();
})((window.GB = window.GB || {}));

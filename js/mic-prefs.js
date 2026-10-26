/**
 * GARTIC BANDE — réglages du micro partagés (compensation de latence par micro).
 *
 * Utilisé par Speech to Note (js/stn.js), par le panneau Paramètres de l'accueil (js/settings-ui.js) et, plus tard, par
 * l'enregistrement de la voix du mode Phone. Une seule source de vérité : tout le monde lit et écrit ici.
 *
 * Stockage : localStorage `gartic-bande.mic.v1` (dans le navigateur du joueur uniquement, jamais envoyé au serveur).
 * Au premier lancement, les valeurs déjà enregistrées par Speech to Note (`gartic-bande.stn.v1`) sont reprises, sans les effacer.
 * Un micro est identifié par son `deviceId` (ou « default »). Rien n'est supposé sur le micro actuel avant qu'il soit ouvert.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else {
    root.GB = root.GB || {};
    root.GB.micprefs = factory().create(typeof window !== 'undefined' ? window.localStorage : null);
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const KEY = 'gartic-bande.mic.v1';
  const OLD_KEY = 'gartic-bande.stn.v1';
  const MAX_MS = 400;
  const MAX_DEVICES = 20;

  function clampMs(value) {
    const number = Math.round(Number(value));
    return Number.isFinite(number) ? Math.max(-MAX_MS, Math.min(MAX_MS, number)) : 0;
  }

  function cleanEntry(raw) {
    if (!raw || typeof raw !== 'object' || !Number.isFinite(Number(raw.ms))) return null;
    return {
      ms: clampMs(raw.ms),
      reliability: String(raw.reliability || '').slice(0, 20),
      method: ['visual', 'click', 'manual'].includes(raw.method) ? raw.method : 'manual',
      label: String(raw.label || '').slice(0, 80),
      at: Number.isFinite(Number(raw.at)) ? Number(raw.at) : 0,
    };
  }

  /** `storage` : localStorage (ou un objet de test avec getItem/setItem). Peut être null : tout reste en mémoire. */
  function create(storage) {
    const state = { latencyOn: true, latency: {} };
    const listeners = new Set();

    function read(key) {
      try {
        return storage ? JSON.parse(storage.getItem(key) || 'null') : null;
      } catch (error) {
        return null;
      }
    }

    function apply(raw) {
      if (!raw || typeof raw !== 'object') return;
      if (typeof raw.latencyOn === 'boolean') state.latencyOn = raw.latencyOn;
      if (raw.latency && typeof raw.latency === 'object') {
        Object.keys(raw.latency).slice(0, MAX_DEVICES).forEach((id) => {
          const entry = cleanEntry(raw.latency[id]);
          if (entry) state.latency[String(id).slice(0, 80)] = entry;
        });
      }
    }

    function save() {
      try {
        if (storage) storage.setItem(KEY, JSON.stringify(state));
      } catch (error) {
        /* stockage bloqué : les réglages valent jusqu'à la fermeture de la page */
      }
    }

    function emit() {
      listeners.forEach((fn) => {
        try {
          fn();
        } catch (error) {
          /* un abonné qui plante ne bloque pas les autres */
        }
      });
    }

    function load() {
      state.latencyOn = true;
      state.latency = {};
      const own = read(KEY);
      if (own) apply(own);
      else {
        const old = read(OLD_KEY); // reprise des réglages de Speech to Note (l'ancienne clé n'est pas modifiée)
        if (old) {
          apply(old);
          save();
        }
      }
    }

    load();

    return {
      KEY,
      MAX_MS,
      state,
      load,
      /** Compensation activée (réglage global). */
      isEnabled: () => state.latencyOn,
      setEnabled(on) {
        state.latencyOn = Boolean(on);
        save();
        emit();
      },
      /** Entrée enregistrée pour ce micro, ou null si ce micro n'a jamais été calibré ni réglé. */
      get: (deviceKey) => state.latency[deviceKey] || null,
      /** Décalage à appliquer (ms) : 0 si la compensation est coupée ou si le micro est inconnu. */
      getLatencyMs: (deviceKey) => (state.latencyOn && state.latency[deviceKey] ? state.latency[deviceKey].ms : 0),
      setLatency(deviceKey, entry) {
        const clean = cleanEntry(Object.assign({ at: Date.now() }, entry));
        if (!clean) return null;
        const id = String(deviceKey || 'default').slice(0, 80);
        if (!state.latency[id] && Object.keys(state.latency).length >= MAX_DEVICES) delete state.latency[Object.keys(state.latency)[0]];
        state.latency[id] = clean;
        save();
        emit();
        return clean;
      },
      forget(deviceKey) {
        delete state.latency[deviceKey];
        save();
        emit();
      },
      /** Ce micro a-t-il un VRAI calibrage (mesuré, pas seulement saisi à la main) ? */
      isCalibrated: (deviceKey) => Boolean(state.latency[deviceKey] && state.latency[deviceKey].method !== 'manual'),
      /** Au moins un micro a-t-il été calibré ou réglé ? (sert à la pastille de la roue dentée, sans demander le micro) */
      hasAny: () => Object.keys(state.latency).length > 0,
      hasAnyCalibrated: () => Object.keys(state.latency).some((id) => state.latency[id].method !== 'manual'),
      list: () => Object.keys(state.latency).map((id) => Object.assign({ id }, state.latency[id])),
      onChange(fn) {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
    };
  }

  return { create, KEY, OLD_KEY, MAX_MS, MAX_DEVICES };
});

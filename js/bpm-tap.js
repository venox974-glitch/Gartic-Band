/**
 * GARTIC BANDE — Smart BPM : retrouver un tempo en tapant au rythme d'une chanson.
 * Calcul pur (aucun accès au micro, à l'audio ni au réseau) : on lui donne les instants des appuis, il rend une estimation.
 *
 *   GB.bpmTap.estimate(times, { min, max })   times = instants des appuis en ms (horloge monotone : performance.now / event.timeStamp)
 *     -> { bpm, rawBpm, taps, used, stable, spread, alternatives: { half, double } }   (bpm = null tant qu'il y a moins de 3 appuis)
 *
 * Méthode (volontairement simple et robuste) :
 *  1. intervalles entre appuis consécutifs ; une pause longue (> PAUSE_MS) coupe la série : on repart du dernier appui ;
 *  2. un appui beaucoup trop proche du précédent (double appui) est ignoré ; on ne garde que les intervalles compatibles avec la plage de BPM du jeu (min..max) ;
 *  3. fenêtre glissante des WINDOW derniers intervalles (le tempo suit le joueur sans rester prisonnier du début) ;
 *  4. médiane, puis on écarte les intervalles trop loin d'elle (±OUTLIER) : double appui (≈ moitié) ou appui oublié (≈ double) ;
 *  5. moyenne des intervalles restants, PUIS conversion en tempo : BPM = 60 000 / intervalle moyen (ms).
 * `stable` : au moins 4 intervalles retenus et dispersion (écart-type / moyenne) sous 8 %.
 * `alternatives` : le tempo ÷ 2 et × 2, seulement s'ils restent dans la plage du jeu.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.GB = root.GB || {}).bpmTap = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const WINDOW = 12;
  const OUTLIER = 0.28;
  const PAUSE_MS = 2500;

  const median = (values) => {
    const sorted = values.slice().sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  };

  function estimate(times, limits) {
    const min = limits && limits.min > 0 ? limits.min : 60;
    const max = limits && limits.max > min ? limits.max : 180;
    const loMs = 60000 / max;
    const hiMs = 60000 / min;
    const taps = Array.isArray(times) ? times.filter((t) => Number.isFinite(t)) : [];
    // série en cours : on repart après une longue pause
    let start = 0;
    for (let i = 1; i < taps.length; i += 1) if (taps[i] - taps[i - 1] > PAUSE_MS) start = i;
    const series = taps.slice(start);
    const intervals = [];
    let last = series.length ? series[0] : 0;
    for (let i = 1; i < series.length; i += 1) {
      const gap = series[i] - last;
      if (gap < loMs * 0.9) continue; // appui trop rapproché : doigt qui rebondit, on l'ignore (le repère reste le dernier bon appui)
      if (intervals.length >= 2 && gap < median(intervals.slice(-WINDOW)) * 0.5) continue; // double appui accidentel
      last = series[i];
      if (gap <= hiMs * 1.1) intervals.push(gap);
    }
    const recent = intervals.slice(-WINDOW);
    const result = { bpm: null, rawBpm: null, taps: taps.length, used: 0, stable: false, spread: null, alternatives: { half: null, double: null } };
    if (recent.length < 2) return result;
    const mid = median(recent);
    const kept = recent.filter((gap) => Math.abs(gap - mid) <= mid * OUTLIER);
    const pool = kept.length >= 2 ? kept : recent;
    const mean = pool.reduce((sum, gap) => sum + gap, 0) / pool.length;
    const sd = Math.sqrt(pool.reduce((sum, gap) => sum + (gap - mean) * (gap - mean), 0) / pool.length);
    const raw = 60000 / mean;
    const bpm = Math.round(Math.min(max, Math.max(min, raw)));
    result.rawBpm = raw;
    result.bpm = bpm;
    result.used = pool.length;
    result.spread = sd / mean;
    result.stable = pool.length >= 4 && result.spread < 0.08;
    const half = Math.round(raw / 2);
    const twice = Math.round(raw * 2);
    result.alternatives.half = half >= min && half <= max ? half : null;
    result.alternatives.double = twice >= min && twice <= max ? twice : null;
    return result;
  }

  return { estimate, WINDOW, OUTLIER, PAUSE_MS };
});

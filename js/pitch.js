/**
 * GARTIC BANDE — changement de HAUTEUR d'un son SANS changer sa DURÉE (ni sa vitesse).
 *
 * Pourquoi pas simplement « jouer plus vite » (playbackRate) ? Parce que ça change la hauteur ET la durée :
 * une note aiguë durerait moitié moins longtemps, une note grave deux fois plus. Ici la durée reste exactement celle du fichier.
 *
 * Méthode (deux temps, 100 % dans le navigateur, sans dépendance) :
 *   1. ÉTIREMENT TEMPOREL par WSOLA (Waveform-Similarity Overlap-Add) : on découpe le son en petites fenêtres,
 *      on les recolle plus espacées (ou plus serrées) en choisissant à chaque fois le point de recollage où la forme
 *      d'onde « colle » le mieux à la précédente. La durée est multipliée par `r`, la hauteur ne change pas.
 *   2. RÉÉCHANTILLONNAGE par interpolation sinc fenêtrée (filtrée contre le repliement) à la vitesse `r` :
 *      la hauteur est multipliée par `r`, la durée revient à celle d'origine.
 * Résultat : même durée qu'au départ (au échantillon près), hauteur × 2^(demi-tons / 12).
 *
 * Compromis (à connaître) :
 *   - Qualité : très bonne jusqu'à ±7 demi-tons, correcte jusqu'à ±12, de plus en plus « métallique » au-delà (jusqu'à +23).
 *     Les sons percutants (clap, kick) peuvent perdre un peu d'attaque : la réglage « Hauteur : toujours l'original » les garde intacts.
 *   - Les sons très courts (moins de 4 fenêtres, ≈ 0,18 s) ne peuvent pas être étirés : on les rééchantillonne simplement
 *     puis on les recoupe à leur durée d'origine (comportement classique d'un échantillonneur pour un coup de percussion).
 *   - Coût : calcul de quelques dizaines de millisecondes par hauteur et par seconde de son ; le résultat est gardé en mémoire
 *     (un seul calcul par son et par hauteur).
 *
 * Ce module est pur (pas de DOM, pas de Tone.js) : il est aussi testé sous Node.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else {
    root.GB = root.GB || {};
    root.GB.pitch = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const LIMITS = { minSemitones: -24, maxSemitones: 24 };

  function ratioOf(semitones) {
    return Math.pow(2, semitones / 12);
  }

  /** Taille de fenêtre (puissance de 2) : ≈ 40 ms. */
  function frameSizeFor(sampleRate) {
    let size = 256;
    while (size < sampleRate * 0.04) size *= 2;
    return size;
  }

  function hannWindow(size) {
    const window = new Float32Array(size);
    for (let i = 0; i < size; i += 1) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size); // périodique : deux fenêtres à 50 % font 1
    return window;
  }

  function monoMix(channels) {
    const length = channels[0].length;
    if (channels.length === 1) return channels[0];
    const mix = new Float32Array(length);
    for (let c = 0; c < channels.length; c += 1) {
      const data = channels[c];
      for (let i = 0; i < length; i += 1) mix[i] += data[i] / channels.length;
    }
    return mix;
  }

  /**
   * Étire la durée par `alpha` sans changer la hauteur (WSOLA). Les décisions de recollage sont prises sur le mono
   * et appliquées à tous les canaux : le stéréo garde sa cohérence de phase.
   */
  function stretch(channels, alpha, sampleRate) {
    const length = channels[0].length;
    const N = frameSizeFor(sampleRate);
    const Hs = N / 2; // pas de synthèse (sortie)
    const Ha = Hs / alpha; // pas d'analyse nominal (entrée)
    const tolerance = N / 4; // écart de recherche autour de la position nominale
    const outLength = Math.max(1, Math.round(length * alpha));
    const frames = Math.ceil(outLength / Hs) + 2;
    const window = hannWindow(N);
    const firstWindow = window.slice();
    for (let i = 0; i < Hs; i += 1) firstWindow[i] = 1; // la 1re fenêtre ne « monte » pas : l'attaque du son est gardée intacte
    const mono = monoMix(channels);
    const out = channels.map(() => new Float32Array(outLength + N * 2));
    const at = (data, index) => (index >= 0 && index < length ? data[index] : 0);

    const STRIDE_J = 4; // la corrélation n'examine qu'un échantillon sur 4 : 4 fois plus rapide, peu de perte
    const STRIDE_D = 2;
    let previous = 0;
    for (let k = 0; k < frames; k += 1) {
      const nominal = Math.round(k * Ha);
      let position = nominal;
      if (k > 0) {
        // Où le son « continuerait » naturellement après la fenêtre précédente : c'est ce que la nouvelle fenêtre doit prolonger.
        const targetStart = previous + Hs;
        let best = -Infinity;
        let bestD = 0;
        for (let d = -tolerance; d <= tolerance; d += STRIDE_D) {
          const candidate = nominal + d;
          if (candidate < 0) continue;
          let sum = 0;
          let energy = 1e-9;
          for (let j = 0; j < Hs; j += STRIDE_J) {
            const a = at(mono, candidate + j);
            sum += a * at(mono, targetStart + j);
            energy += a * a;
          }
          const score = sum / Math.sqrt(energy);
          if (score > best) {
            best = score;
            bestD = d;
          }
        }
        position = Math.max(0, nominal + bestD);
      }
      const outStart = k * Hs;
      for (let c = 0; c < channels.length; c += 1) {
        const source = channels[c];
        const target = out[c];
        for (let i = 0; i < N; i += 1) {
          const index = position + i;
          if (index >= length) break;
          target[outStart + i] += (k === 0 ? firstWindow : window)[i] * source[index];
        }
      }
      previous = position;
    }
    return out.map((data) => data.subarray(0, outLength));
  }

  /** Table du noyau « sinc fenêtré » (précalculée une fois) : 8 passages par zéro de chaque côté. */
  const ZERO_CROSSINGS = 8;
  const TABLE_RES = 512; // points par unité
  const KERNEL = (() => {
    const size = ZERO_CROSSINGS * TABLE_RES;
    const table = new Float32Array(size + 2);
    for (let i = 0; i <= size + 1; i += 1) {
      const x = i / TABLE_RES;
      const sinc = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
      const win = x >= ZERO_CROSSINGS ? 0 : 0.5 + 0.5 * Math.cos((Math.PI * x) / ZERO_CROSSINGS);
      table[i] = sinc * win;
    }
    return table;
  })();

  function kernelAt(x) {
    const a = Math.abs(x);
    if (a >= ZERO_CROSSINGS) return 0;
    const position = a * TABLE_RES;
    const index = Math.floor(position);
    const fraction = position - index;
    return KERNEL[index] * (1 - fraction) + KERNEL[index + 1] * fraction;
  }

  /** Relit `data` à la vitesse `rate` (hauteur × rate, durée / rate) avec un filtre anti-repliement quand on accélère. */
  function resample(data, rate, outLength) {
    const out = new Float32Array(outLength);
    const cutoff = rate > 1 ? 1 / rate : 1;
    const half = Math.ceil(ZERO_CROSSINGS / cutoff);
    const length = data.length;
    for (let i = 0; i < outLength; i += 1) {
      const position = i * rate;
      const center = Math.floor(position);
      let sum = 0;
      for (let j = center - half + 1; j <= center + half; j += 1) {
        if (j < 0 || j >= length) continue;
        sum += data[j] * kernelAt((j - position) * cutoff);
      }
      out[i] = sum * cutoff;
    }
    return out;
  }

  /**
   * Décale la hauteur de `semitones` demi-tons en gardant la durée. `channels` : tableau de Float32Array (un par canal).
   * Renvoie de NOUVEAUX tableaux de même longueur. 0 demi-ton : copie.
   */
  function shift(channels, sampleRate, semitones) {
    const length = channels[0].length;
    const clamped = Math.max(LIMITS.minSemitones, Math.min(LIMITS.maxSemitones, Math.round(semitones)));
    if (clamped === 0 || length === 0) return channels.map((data) => new Float32Array(data));
    const r = ratioOf(clamped);
    const N = frameSizeFor(sampleRate);
    if (length < N * 4) {
      // Son trop court pour être étiré : simple rééchantillonnage, recoupé (ou complété de silence) à la durée d'origine.
      return channels.map((data) => {
        const resampled = resample(data, r, length);
        // fondu de sortie de 5 ms quand le son est tronqué (pas de clic)
        const fade = Math.min(length, Math.round(sampleRate * 0.005));
        for (let i = 0; i < fade; i += 1) resampled[length - 1 - i] *= i / fade;
        return resampled;
      });
    }
    const stretched = stretch(channels, r, sampleRate);
    return stretched.map((data) => {
      const resampled = resample(data, r, length);
      return resampled;
    });
  }

  /**
   * Petite mémoire des sons déjà décalés (un par son et par hauteur), plafonnée en nombre d'échantillons
   * pour ne jamais faire grossir la mémoire sans limite (les plus anciens sont oubliés).
   */
  function createCache(maxSamples) {
    const store = new Map(); // clé → { channels, samples }
    let total = 0;
    return {
      get(key) {
        const entry = store.get(key);
        if (!entry) return null;
        store.delete(key); // le plus récemment utilisé passe en dernier
        store.set(key, entry);
        return entry.value;
      },
      set(key, value, samples) {
        if (store.has(key)) total -= store.get(key).samples;
        store.set(key, { value, samples });
        total += samples;
        while (total > maxSamples && store.size > 1) {
          const oldest = store.keys().next().value;
          total -= store.get(oldest).samples;
          store.delete(oldest);
        }
      },
      has: (key) => store.has(key),
      clear() {
        store.clear();
        total = 0;
      },
      size: () => store.size,
    };
  }

  return { shift, stretch, resample, ratioOf, createCache, frameSizeFor, LIMITS };
});

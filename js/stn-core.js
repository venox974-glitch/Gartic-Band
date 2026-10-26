/**
 * GARTIC BANDE — Speech to Note : le cœur du calcul (détection de hauteur, suivi de notes, calibrages).
 *
 * Module PUR (pas de DOM, pas de micro, pas de Tone.js) : il est testé sous Node (server/test-stn.js) avec des signaux synthétiques.
 * Le navigateur lui envoie des « trames » (un morceau de signal toutes les ~25 ms) et récupère des événements de notes.
 *
 * Méthode : YIN (de Cheveigné & Kawahara, 2002) = autocorrélation « différence » normalisée, seuil absolu, interpolation parabolique.
 * Choisie parce qu'elle est courte (une centaine de lignes), sans dépendance, rapide (≈ 1 ms par trame) et robuste pour UNE voix.
 * Autre option évaluée : « pitchy » / « aubio » (McLeod / YIN en bibliothèque) : inutile ici, et une dépendance de plus à servir.
 *
 * Limites connues (voir aussi README) : une seule voix à la fois (monophonique) ; les erreurs d'octave sont possibles sur les sons
 * souffles / très graves ; la voix très aiguë (> ~1 kHz) n'est pas suivie ; le bruit ou une musique forte dans le micro trompe l'analyse.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else {
    root.GB = root.GB || {};
    root.GB.stnCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** Réglages techniques (modifiables ici). Durées en millisecondes, niveaux en amplitude (1 = pleine échelle). */
  const DEFAULTS = {
    minHz: 70, // plus grave détectée (≈ Do♯2)
    maxHz: 1100, // plus aiguë détectée (≈ Do♯6)
    yinThreshold: 0.2, // seuil YIN : plus petit = plus sûr mais moins de détections
    minConfidence: 0.72, // confiance minimale (1 − valeur YIN) pour DÉMARRER une note
    keepConfidence: 0.55, // confiance minimale pour CONTINUER une note déjà commencée (évite de la couper sur une trame floue)
    attackSensitivity: 0.5, // 0 = peu sensible (seulement les attaques franches) … 1 = très sensible (attaques douces comme « la la »)
    minDipMs: 24, // un creux d'énergie plus court que ça n'est pas une séparation entre deux notes
    minAttackGapMs: 90, // durée minimale entre deux attaques : une nouvelle note ne peut pas commencer avant
    attackWaitMs: 220, // après une attaque, temps laissé à la voyelle pour donner une hauteur fiable (sinon : bruit de consonne, ignoré)
    settleMs: 220, // au début d'une note, la hauteur peut encore être corrigée sans créer une nouvelle note (glissé d'attaque)
    silenceMs: 55, // silence continu avant de terminer la note
    minRms: 0.006, // niveau minimal (≈ −44 dBFS) : en dessous, c'est du silence
    onsetMs: 25, // une hauteur stable pendant ce temps (2 trames) déclenche une note
    changeMs: 70, // temps pendant lequel une AUTRE hauteur doit durer pour couper la note (distingue un vrai changement d'une fluctuation)
    jumpMs: 150, // idem pour un saut d'une octave ou plus (souvent une erreur de détection : on attend plus longtemps)
    holdMs: 100, // trous non silencieux tolérés (souffle, trame floue) avant de terminer la note
    minNoteMs: 60, // note plus courte que ça : jetée
    changeSemitones: 0.85, // écart (en demi-tons) à partir duquel on parle d'un autre degré (le vibrato reste en dessous)
    medianFrames: 3, // lissage de la hauteur sur les dernières trames
  };

  const NAMES = ['Do', 'Do♯', 'Ré', 'Ré♯', 'Mi', 'Fa', 'Fa♯', 'Sol', 'Sol♯', 'La', 'La♯', 'Si'];

  function hzToMidi(hz) {
    return 69 + 12 * Math.log2(hz / 440);
  }
  function midiToHz(midi) {
    return 440 * Math.pow(2, (midi - 69) / 12);
  }
  /** Do4 = 60 → « Do4 » (même écriture que les lignes du piano-roll). */
  function midiName(midi) {
    const m = Math.round(midi);
    return NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
  }

  function median(values) {
    if (!values.length) return NaN;
    const sorted = values.slice().sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  function rmsOf(buffer) {
    let sum = 0;
    for (let i = 0; i < buffer.length; i += 1) sum += buffer[i] * buffer[i];
    return Math.sqrt(sum / buffer.length);
  }

  /* ------------------------------------------------------------------ */
  /*  Détection de la fréquence fondamentale (YIN)                       */
  /* ------------------------------------------------------------------ */

  /**
   * Analyse une trame. Renvoie { freq, midi, conf, rms } ; freq = 0 (et midi = null) si rien d'identifiable.
   * `buffer` : Float32Array (mono), idéalement 2048 échantillons. `scratch` : tableau réutilisable (évite d'allouer à chaque trame).
   */
  function detectPitch(buffer, sampleRate, options, scratch) {
    const o = Object.assign({}, DEFAULTS, options || {});
    const size = buffer.length;
    const rms = rmsOf(buffer);
    const none = { freq: 0, midi: null, conf: 0, rms };
    if (rms < o.minRms) return none;
    const half = size >> 1;
    const tauMax = Math.min(half - 1, Math.floor(sampleRate / o.minHz));
    const tauMin = Math.max(2, Math.floor(sampleRate / o.maxHz));
    if (tauMax <= tauMin + 2) return none;

    // moyenne retirée (décalage continu du micro)
    let mean = 0;
    for (let i = 0; i < size; i += 1) mean += buffer[i];
    mean /= size;

    const cmnd = scratch && scratch.length >= tauMax + 2 ? scratch : new Float32Array(tauMax + 2);
    cmnd[0] = 1;
    let running = 0;
    for (let tau = 1; tau <= tauMax; tau += 1) {
      let sum = 0;
      for (let j = 0; j < half; j += 1) {
        const delta = buffer[j] - buffer[j + tau];
        sum += delta * delta;
      }
      running += sum;
      cmnd[tau] = running > 0 ? (sum * tau) / running : 1;
    }

    // premier creux sous le seuil, sinon le plus profond
    let best = -1;
    for (let tau = tauMin; tau <= tauMax; tau += 1) {
      if (cmnd[tau] < o.yinThreshold) {
        while (tau + 1 <= tauMax && cmnd[tau + 1] < cmnd[tau]) tau += 1;
        best = tau;
        break;
      }
    }
    if (best < 0) {
      let low = 1e9;
      for (let tau = tauMin; tau <= tauMax; tau += 1) {
        if (cmnd[tau] < low) {
          low = cmnd[tau];
          best = tau;
        }
      }
      if (low > 0.35) return none;
    }

    // erreur d'harmonique : si le « premier creux » est en fait la 2e..6e harmonique, le vrai son fondamental (période k fois plus longue)
    // présente lui aussi un creux net. On remonte alors vers la fondamentale (la plus grave dont le creux est quasi aussi profond).
    {
      const ref = cmnd[best];
      let chosen = best;
      for (let k = 2; k <= 6; k += 1) {
        const center = Math.round(best * k);
        if (center + 2 > tauMax) break;
        let low = 1e9;
        let at = center;
        for (let t = center - 2; t <= center + 2; t += 1) {
          if (cmnd[t] < low) {
            low = cmnd[t];
            at = t;
          }
        }
        // seulement si le creux d'origine est médiocre (> 0,08 : une note pure est ≈ 0) ET que le creux plus grave est nettement meilleur
        if (ref > 0.08 && low < ref * 0.85 && low < 0.25) chosen = at;
      }
      best = chosen;
    }

    // interpolation parabolique
    let tauExact = best;
    if (best > tauMin && best < tauMax) {
      const a = cmnd[best - 1];
      const b = cmnd[best];
      const c = cmnd[best + 1];
      const denom = a - 2 * b + c;
      if (Math.abs(denom) > 1e-12) tauExact = best + (a - c) / (2 * denom);
    }
    const freq = sampleRate / tauExact;
    if (!Number.isFinite(freq) || freq < o.minHz * 0.9 || freq > o.maxHz * 1.1) return none;
    return { freq, midi: hzToMidi(freq), conf: Math.max(0, Math.min(1, 1 - cmnd[best])), rms };
  }

  /* ------------------------------------------------------------------ */
  /*  Détection des ATTAQUES vocales (onset detection)                   */
  /* ------------------------------------------------------------------ */

  // FFT radix-2 en place (taille = puissance de 2) : utilisée seulement pour le flux spectral, sur des blocs de 256 échantillons.
  const fftCache = {};
  function fft(re, im) {
    const n = re.length;
    let c = fftCache[n];
    if (!c) {
      c = { cos: new Float32Array(n / 2), sin: new Float32Array(n / 2), rev: new Uint16Array(n) };
      for (let i = 0; i < n / 2; i += 1) {
        c.cos[i] = Math.cos((2 * Math.PI * i) / n);
        c.sin[i] = -Math.sin((2 * Math.PI * i) / n);
      }
      const bits = Math.log2(n);
      for (let i = 0; i < n; i += 1) {
        let r = 0;
        for (let b = 0; b < bits; b += 1) r |= ((i >> b) & 1) << (bits - 1 - b);
        c.rev[i] = r;
      }
      fftCache[n] = c;
    }
    for (let i = 0; i < n; i += 1) {
      const j = c.rev[i];
      if (j > i) {
        let t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }
    for (let size = 2; size <= n; size *= 2) {
      const half = size / 2;
      const step = n / size;
      for (let start = 0; start < n; start += size) {
        for (let k = 0; k < half; k += 1) {
          const wr = c.cos[k * step];
          const wi = c.sin[k * step];
          const a = start + k;
          const b = a + half;
          const tr = re[b] * wr - im[b] * wi;
          const ti = re[b] * wi + im[b] * wr;
          re[b] = re[a] - tr; im[b] = im[a] - ti;
          re[a] += tr; im[a] += ti;
        }
      }
    }
  }

  const BLOCK = 256; // ≈ 5 ms : résolution temporelle des attaques (bien plus fine que les trames de hauteur de 25 ms)

  /**
   * Cherche les débuts de sons à partir des NOUVEAUX échantillons reçus. Indices combinés (jamais un seul) :
   *   1. montée d'énergie : le niveau (dB) remonte d'au moins `riseDb` au-dessus de son minimum des ~100 dernières ms
   *      (c'est ce qui sépare « ta-ta-ta » ET « la-la-la » : un creux puis une remontée) ;
   *   2. flux spectral : le spectre change vite (transitoire) — ou éclat de hautes fréquences (le « t » d'une consonne) ;
   *   3. sinon la montée doit être très forte (+6 dB de plus) : un son qui démarre franchement après un silence.
   * Un crescendo lent ou un vibrato (montée douce, spectre stable) ne déclenche donc rien.
   * `process(samples, tEnd, sampleRate)` : `tEnd` = instant (s) du DERNIER échantillon. Renvoie [{ t, strength, why }].
   */
  function createAttackDetector(options) {
    const o = Object.assign({ sensitivity: DEFAULTS.attackSensitivity, minRms: 0.004 }, options || {});
    const history = []; // { t0, db, flux, hf } par bloc
    const re = new Float32Array(BLOCK);
    const im = new Float32Array(BLOCK);
    const hann = new Float32Array(BLOCK);
    for (let i = 0; i < BLOCK; i += 1) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / BLOCK);
    let carry = new Float32Array(0);
    let prevLog = null;
    let armed = true;
    let lastFire = -1e9;

    function medianOf(list) {
      return median(list);
    }

    function process(samples, tEnd, sampleRate) {
      const out = [];
      const all = new Float32Array(carry.length + samples.length);
      all.set(carry, 0);
      all.set(samples, carry.length);
      const blocks = Math.floor(all.length / BLOCK);
      const total = all.length;
      const riseDb = 10 - 6 * Math.max(0, Math.min(1, o.sensitivity)); // 10 dB (0) … 4 dB (1) ; 7 dB par défaut
      const lookBack = Math.max(8, Math.round(0.1 / (BLOCK / sampleRate))); // ≈ 100 ms
      const hfBin = Math.floor(2500 / (sampleRate / BLOCK));
      for (let k = 0; k < blocks; k += 1) {
        const off = k * BLOCK;
        let energy = 0;
        for (let i = 0; i < BLOCK; i += 1) {
          const x = all[off + i];
          energy += x * x;
          re[i] = x * hann[i];
          im[i] = 0;
        }
        energy /= BLOCK;
        fft(re, im);
        let flux = 0;
        let hf = 0;
        let sum = 1e-12;
        const logs = new Float32Array(BLOCK / 2);
        for (let b = 1; b < BLOCK / 2; b += 1) {
          const mag = Math.sqrt(re[b] * re[b] + im[b] * im[b]);
          const l = Math.log1p(mag * 60);
          logs[b] = l;
          if (prevLog && b < Math.floor(8000 / (sampleRate / BLOCK))) flux += Math.max(0, l - prevLog[b]);
          sum += mag * mag;
          if (b >= hfBin) hf += mag * mag;
        }
        prevLog = logs;
        const tStart = tEnd - (total - off) / sampleRate;
        history.push({ t0: tStart, db: 10 * Math.log10(energy + 1e-10), flux, hf: hf / sum, rms: Math.sqrt(energy) });
        if (history.length > 160) history.shift();
        const n = history.length;
        if (n < lookBack + 2) continue;
        const cur = history[n - 1];
        // minimum des ~100 dernières ms (hors bloc courant) et sa position
        let minDb = 1e9;
        let minAt = n - 2;
        for (let j = n - 2; j >= Math.max(0, n - 1 - lookBack); j -= 1) {
          if (history[j].db < minDb) {
            minDb = history[j].db;
            minAt = j;
          }
        }
        const rise = cur.db - minDb;
        // largeur du creux : durée pendant laquelle le niveau reste ≥ 12 dB sous le niveau d'avant le creux. Un trou de quelques ms
        // (clic, coupure, raccord d'enveloppe) n'est pas un vrai silence entre deux notes ; une syllabe qui s'éteint puis revient (« la la ») l'est.
        let before = -200;
        for (let j = Math.max(0, n - 1 - lookBack * 2); j <= minAt; j += 1) before = Math.max(before, history[j].db);
        const refDb = before - Math.max(3, Math.min(12, (before - minDb) * 0.5)); // creux peu profond : seuil à mi-profondeur
        let dipBlocks = 0;
        for (let j = n - 2; j >= Math.max(0, n - 1 - lookBack * 2); j -= 1) if (history[j].db <= refDb) dipBlocks += 1;
        // pas de son avant (le niveau d'avant le creux est lui-même au plancher) : c'est un départ depuis le silence, pas un creux entre deux notes
        const dipOk = before - minDb < 6 || dipBlocks * (BLOCK / sampleRate) * 1000 >= DEFAULTS.minDipMs;
        if (rise < riseDb * 0.5) armed = true;
        if (!armed || cur.rms < o.minRms || rise < riseDb) continue;
        if (!dipOk) {
          armed = false; // creux trop court : cette montée est consommée (sinon elle se déclencherait plus tard, quand le creux sort de la fenêtre)
          continue;
        }
        // seuil adaptatif du flux : médiane + 3 écarts médians sur ~1 s
        const fluxes = history.map((h) => h.flux);
        const fm = medianOf(fluxes);
        const mad = medianOf(fluxes.map((f) => Math.abs(f - fm)));
        const recentFlux = Math.max(...history.slice(n - 4).map((h) => h.flux));
        const fluxOk = recentFlux > fm + 3 * mad + 0.4;
        const hfBefore = medianOf(history.slice(Math.max(0, n - 8), n - 2).map((h) => h.hf));
        const hfBurst = Math.max(...history.slice(n - 4).map((h) => h.hf)) - hfBefore > 0.2 && rise >= riseDb * 0.7;
        const strong = rise >= riseDb + 6;
        if (!(fluxOk || hfBurst || strong)) continue;
        // début de la montée : premier bloc après le minimum qui dépasse minDb + 2 dB (début du « t » ou de la voyelle)
        let first = n - 1;
        for (let j = minAt + 1; j < n; j += 1) {
          if (history[j].db >= minDb + 2) {
            first = j;
            break;
          }
        }
        // un éclat de hautes fréquences juste avant la montée (« t ») avance l'attaque à son début
        for (let j = first - 1; j >= Math.max(0, first - 5); j -= 1) {
          if (history[j].hf - hfBefore > 0.2 && history[j].db > minDb + 1) first = j;
          else break;
        }
        const t = history[first].t0;
        if ((t - lastFire) * 1000 < (o.minGapMs || DEFAULTS.minAttackGapMs) * 0.5) continue; // double détection du même front
        lastFire = t;
        armed = false;
        out.push({ t, strength: Math.round(rise * 10) / 10, why: [fluxOk ? 'flux' : '', hfBurst ? 'consonne' : '', strong ? 'énergie forte' : '', 'énergie +' + Math.round(rise) + ' dB'].filter(Boolean).join(' + ') });
      }
      carry = all.slice(blocks * BLOCK);
      return out;
    }

    return { process };
  }

  /* ------------------------------------------------------------------ */
  /*  Suivi de notes : trames de hauteur + attaques -> événements         */
  /* ------------------------------------------------------------------ */

  /**
   * `push({ t, midi, conf, rms, onsets })` (t en secondes, croissant ; `onsets` = attaques de createAttackDetector, même horloge)
   * renvoie une liste d'événements, chacun avec une `reason` (utile au mode diagnostic) :
   *   { type: 'start',   id, midi, t, reason }          une note commence ('attaque' | 'hauteur' | 'changement de hauteur')
   *   { type: 'update',  id, end }                      la note tient toujours (sa fin provisoire avance)
   *   { type: 'retune',  id, midi, reason }             la hauteur d'une note qui vient de commencer est corrigée (glissé d'attaque)
   *   { type: 'end',     id, midi, start, end, reason } la note est terminée ('silence' | 'souffle' | 'nouvelle attaque' | 'changement de hauteur' | 'arrêt')
   *   { type: 'discard', id, reason }                   la note était trop courte : à supprimer
   *   { type: 'attack',  t, strength, why } / { type: 'attack-ignored' | 'attack-dropped', t, reason } : pour le diagnostic
   * `flush(t)` termine proprement la note en cours.
   * Une attaque ne coupe la note en cours QUE si une hauteur fiable suit (la voyelle) : un bruit de consonne seul ne crée rien.
   */
  function createTracker(options) {
    const o = Object.assign({}, DEFAULTS, options || {});
    let cur = null;
    let pending = null;
    let run = [];
    let recent = [];
    let nextId = 1;
    let lastT = null;
    let dt = 0.025;
    let attack = null; // { t, expires, after: [midi...] } attaque en attente d'une hauteur fiable
    let lastAttackT = -1e9;
    let silentSince = null;

    function closeNote(end, reason) {
      const note = cur;
      cur = null;
      pending = null;
      if (!note) return null;
      if ((end - note.start) * 1000 < o.minNoteMs) return { type: 'discard', id: note.id, reason: 'trop courte (' + Math.round((end - note.start) * 1000) + ' ms)' };
      return { type: 'end', id: note.id, midi: note.midi, start: note.start, end, reason };
    }

    function openNote(midi, start, frame, reason, events) {
      cur = { id: nextId, midi, start, lastVoiced: frame.t, pitches: [], reason };
      nextId += 1;
      events.push({ type: 'start', id: cur.id, midi, t: start, reason });
      events.push({ type: 'update', id: cur.id, end: frame.t + dt / 2 });
    }

    function push(frame) {
      const events = [];
      if (lastT !== null && frame.t > lastT) dt = Math.min(0.08, Math.max(0.005, 0.7 * dt + 0.3 * (frame.t - lastT)));
      lastT = frame.t;

      // 1. attaques reçues
      (frame.onsets || []).forEach((onset) => {
        if ((onset.t - lastAttackT) * 1000 < o.minAttackGapMs) {
          events.push({ type: 'attack-ignored', t: onset.t, reason: 'trop proche de l\'attaque précédente (' + Math.round((onset.t - lastAttackT) * 1000) + ' ms < ' + o.minAttackGapMs + ' ms)' });
          return;
        }
        if (cur && (onset.t - cur.start) * 1000 < o.minNoteMs) {
          events.push({ type: 'attack-ignored', t: onset.t, reason: 'la note vient juste de commencer' });
          return;
        }
        lastAttackT = onset.t;
        attack = { t: onset.t, expires: onset.t + o.attackWaitMs / 1000, after: [] };
        events.push({ type: 'attack', t: onset.t, strength: onset.strength, why: onset.why });
      });
      if (attack && frame.t > attack.expires) {
        events.push({ type: 'attack-dropped', t: attack.t, reason: 'aucune hauteur fiable après l\'attaque (bruit de consonne ou de bouche)' });
        attack = null;
      }

      const loud = frame.rms >= o.minRms;
      const strict = frame.midi != null && frame.conf >= o.minConfidence && loud;
      // une note est en cours : on accepte des trames un peu moins nettes tant qu'elles restent près de sa hauteur
      const keep = Boolean(cur) && frame.midi != null && frame.conf >= o.keepConfidence && loud && Math.abs(frame.midi - cur.midi) < 2;
      const voiced = strict || keep;
      if (voiced) {
        recent.push(frame.midi);
        if (recent.length > o.medianFrames) recent.shift();
      }

      // ---- aucune note en cours ----
      if (!cur) {
        if (!strict) {
          run = [];
          recent = [];
          return events;
        }
        if (run.length && Math.abs(frame.midi - median(run.map((r) => r.m))) > 0.8) run = [];
        run.push({ t: frame.t, m: frame.midi });
        if ((frame.t - run[0].t) * 1000 >= o.onsetMs && run.length >= 2) {
          const midi = Math.round(median(run.map((r) => r.m)));
          // la note commence à l'ATTAQUE (le « t ») si on en a vu une juste avant la voyelle, sinon à la première trame fiable
          const usable = attack && attack.t >= run[0].t - o.attackWaitMs / 1000 && attack.t <= frame.t;
          openNote(midi, usable ? attack.t : run[0].t, frame, usable ? 'attaque' : 'hauteur', events);
          cur.pitches = run.map((r) => r.m);
          if (usable) attack = null;
          run = [];
        }
        return events;
      }

      // ---- une note est en cours ----
      // attaque en attente : dès que la voyelle donne 2 hauteurs fiables, on coupe la note en cours et on en ouvre une autre
      if (attack && strict && frame.conf >= 0.8 && frame.t >= attack.t) {
        // les hauteurs qui suivent l'attaque doivent s'accorder entre elles (sinon : erreur d'octave ou mesure instable, on recommence)
        if (attack.after.length && Math.abs(frame.midi - attack.after[attack.after.length - 1]) > 1.5) attack.after = [];
        attack.after.push(frame.midi);
        if (attack.after.length >= 2) {
          const midi = Math.round(median(attack.after));
          const closed = closeNote(Math.max(cur.start, attack.t), 'nouvelle attaque');
          if (closed) events.push(closed);
          openNote(midi, attack.t, frame, 'attaque', events);
          cur.pitches = attack.after.slice();
          attack = null;
          recent = attack ? recent : recent.slice(-o.medianFrames);
          return events;
        }
      }

      if (loud) silentSince = null;
      else if (silentSince === null) silentSince = frame.t;

      if (voiced) {
        cur.lastVoiced = frame.t;
        cur.pitches.push(frame.midi);
        const m = median(recent);
        // début de note : la hauteur peut encore être corrigée (glissé d'attaque, première trame trop basse) sans créer de note
        const settledNow = Math.round(median(cur.pitches));
        if (cur.reason !== 'changement de hauteur' && (frame.t - cur.start) * 1000 < o.settleMs && Math.abs(Math.round(m) - cur.midi) <= 2) {
          // seulement une petite correction (≤ 2 demi-tons) : un vrai saut de hauteur passe par le chemin « changement de hauteur » ci-dessous
          const settled = settledNow;
          if (settled !== cur.midi && Math.abs(settled - cur.midi) <= 2) {
            cur.midi = settled;
            events.push({ type: 'retune', id: cur.id, midi: settled, reason: 'la hauteur se précise au début de la note' });
          }
          events.push({ type: 'update', id: cur.id, end: frame.t + dt / 2 });
          return events;
        }
        // référence = hauteur moyenne suivie de la note (pas l'entier arrondi) : une voix qui dérive de ±0,8 demi-ton ne coupe pas la note ;
        // une mesure peu sûre (confiance < 0,85) ne peut jamais, seule, déclencher un changement de hauteur
        if (cur.ref === undefined) cur.ref = cur.pitches.length ? median(cur.pitches) : cur.midi;
        const diff = m - cur.ref;
        if (frame.conf < 0.85 || Math.abs(diff) < o.changeSemitones) {
          if (Math.abs(diff) < o.changeSemitones) cur.ref += 0.12 * (m - cur.ref);
          if (frame.conf >= 0.85) pending = null;
          events.push({ type: 'update', id: cur.id, end: frame.t + dt / 2 });
        } else {
          const candidate = Math.round(m);
          if (!pending || pending.midi !== candidate) pending = { midi: candidate, since: frame.t };
          const need = Math.abs(candidate - cur.midi) >= 11 ? o.jumpMs : o.changeMs;
          if ((frame.t - pending.since) * 1000 >= need) {
            const split = pending.since;
            const closed = closeNote(split, 'changement de hauteur');
            if (closed) events.push(closed);
            openNote(candidate, split, frame, 'changement de hauteur', events);
            cur.pitches = [frame.midi];
            cur.ref = m;
          } else {
            events.push({ type: 'update', id: cur.id, end: frame.t + dt / 2 });
          }
        }
      } else if (silentSince !== null && (frame.t - silentSince) * 1000 >= o.silenceMs) {
        const closed = closeNote(cur.lastVoiced + dt / 2, 'silence');
        if (closed) events.push(closed);
        recent = [];
        silentSince = null;
      } else if ((frame.t - cur.lastVoiced) * 1000 > o.holdMs) {
        const closed = closeNote(cur.lastVoiced + dt / 2, 'son sans hauteur (souffle, bruit)');
        if (closed) events.push(closed);
        recent = [];
      }
      return events;
    }

    function flush(t) {
      const events = [];
      if (cur) {
        const closed = closeNote(Math.max(cur.start, Math.min(t, cur.lastVoiced + dt / 2 + o.holdMs / 1000)), 'arrêt de la capture');
        if (closed) events.push(closed);
      }
      run = [];
      recent = [];
      attack = null;
      return events;
    }

    return { push, flush, isActive: () => Boolean(cur), current: () => (cur ? { id: cur.id, midi: cur.midi, start: cur.start } : null), options: o };
  }

  /* ------------------------------------------------------------------ */
  /*  Détection de début de son (calibrage de latence)                   */
  /* ------------------------------------------------------------------ */

  /** Début de son = le niveau passe nettement au-dessus du bruit de fond. `push(t, rms)` renvoie true à l'instant du front montant. */
  function createOnsetDetector(options) {
    const o = Object.assign({ ratio: 3.2, minAbs: 0.012, refractory: 0.3, floor: 0.004 }, options || {});
    let floor = o.floor;
    let above = false;
    let last = -1e9;
    return {
      push(t, rms) {
        const limit = Math.max(o.minAbs, floor * o.ratio);
        const isAbove = rms > limit;
        let fired = false;
        if (isAbove && !above && t - last >= o.refractory) {
          fired = true;
          last = t;
        }
        if (!isAbove) floor = Math.max(0.0005, floor * 0.96 + rms * 0.04); // le bruit de fond suit doucement
        above = isAbove;
        return fired;
      },
      getFloor: () => floor,
    };
  }

  /* ------------------------------------------------------------------ */
  /*  Calibrage de latence : décalage entre les références et les sons   */
  /* ------------------------------------------------------------------ */

  /**
   * `targets` : instants de référence (clics ou boule), `onsets` : instants où un son a été détecté (secondes, même horloge).
   * Renvoie { deltas, kept, medianMs, sdMs, matched, expected, compensationMs, reliability: 'bonne'|'moyenne'|'faible', suspectEcho }.
   * Le décalage mesuré est un décalage GLOBAL observé (réaction humaine + micro + traitement), pas la latence exacte du matériel.
   */
  function estimateLatency(targets, onsets, options) {
    const o = Object.assign({ skip: 2, before: 0.25, after: 0.6, maxCompensationMs: 400 }, options || {});
    const used = new Set();
    const deltas = [];
    let expected = 0;
    targets.forEach((target, index) => {
      if (index < o.skip) return;
      expected += 1;
      let bestIndex = -1;
      let bestAbs = Infinity;
      onsets.forEach((onset, i) => {
        if (used.has(i)) return;
        const d = onset - target;
        if (d < -o.before || d > o.after) return;
        if (Math.abs(d) < bestAbs) {
          bestAbs = Math.abs(d);
          bestIndex = i;
        }
      });
      if (bestIndex >= 0) {
        used.add(bestIndex);
        deltas.push(onsets[bestIndex] - target);
      }
    });
    const result = { deltas, kept: [], medianMs: 0, sdMs: 0, matched: deltas.length, expected, compensationMs: 0, reliability: 'faible', suspectEcho: false };
    if (deltas.length < 3) return result;
    const m = median(deltas);
    const mad = median(deltas.map((d) => Math.abs(d - m)));
    const limit = Math.max(0.06, 2.5 * 1.4826 * mad); // écarte les mesures aberrantes
    const kept = deltas.filter((d) => Math.abs(d - m) <= limit);
    result.kept = kept;
    if (kept.length < 3) return result;
    const keptMedian = median(kept);
    const mean = kept.reduce((a, b) => a + b, 0) / kept.length;
    const sd = Math.sqrt(kept.reduce((a, b) => a + (b - mean) * (b - mean), 0) / kept.length);
    result.medianMs = Math.round(keptMedian * 1000);
    result.sdMs = Math.round(sd * 1000);
    result.compensationMs = Math.max(-o.maxCompensationMs, Math.min(o.maxCompensationMs, result.medianMs));
    const ratio = expected ? kept.length / expected : 0;
    if (kept.length >= 5 && sd <= 0.05 && ratio >= 0.7) result.reliability = 'bonne';
    else if (kept.length >= 4 && sd <= 0.09 && ratio >= 0.5) result.reliability = 'moyenne';
    // des sons collés au clic (0 à 80 ms) et presque identiques : le haut-parleur a probablement été entendu par le micro
    result.suspectEcho = kept.length >= 3 && kept.every((d) => d >= -0.01 && d <= 0.08) && sd < 0.012;
    return result;
  }

  /* ------------------------------------------------------------------ */
  /*  Calibrage vocal : comparer la note de référence et la voix         */
  /* ------------------------------------------------------------------ */

  /**
   * `frames` : [{ midi (nombre à virgule), conf, rms }] entendues pendant que le joueur chantait la note `refMidi`.
   * Ne conclut rien si le signal est trop peu fiable ou trop instable.
   */
  function evaluateVoiceNote(refMidi, frames, options) {
    const o = Object.assign({ minConfidence: DEFAULTS.minConfidence, minFrames: 8, maxSpreadCents: 70 }, options || {});
    const good = frames.filter((f) => f.midi != null && f.conf >= o.minConfidence);
    const result = { refMidi, status: 'unreliable', reason: '', detectedMidi: null, detectedName: '', cents: null, semitones: null, octaves: 0, frames: good.length, spreadCents: null };
    if (good.length < o.minFrames) {
      result.reason = good.length === 0 ? 'Aucune voix identifiable (trop bas, trop bruité, ou pas de son).' : 'Pas assez de son stable pour conclure : chante la note plus longtemps.';
      return result;
    }
    const mids = good.map((f) => f.midi);
    const m = median(mids);
    const spread = median(mids.map((x) => Math.abs(x - m))) * 100 * 1.4826; // écart typique en cents
    result.spreadCents = Math.round(spread);
    result.detectedMidi = m;
    result.detectedName = midiName(m);
    if (spread > o.maxSpreadCents) {
      result.reason = 'La hauteur bouge beaucoup (≈ ' + Math.round(spread) + ' cents) : essaie de tenir la note plus droite avant de conclure.';
      return result;
    }
    const diff = m - refMidi;
    result.status = 'ok';
    result.semitones = Math.round(diff * 100) / 100;
    const nearestOctave = Math.round(diff / 12);
    if (nearestOctave !== 0 && Math.abs(diff - 12 * nearestOctave) <= 1.5) {
      result.octaves = nearestOctave;
      result.cents = Math.round((diff - 12 * nearestOctave) * 100);
    } else {
      result.cents = Math.round(diff * 100); // écart brut en cents
    }
    return result;
  }

  /** Conclusion sur plusieurs notes : un décalage d'octave CONSTANT est signalé (jamais appliqué sans le choix explicite du joueur). */
  function summarizeVoice(results) {
    const ok = results.filter((r) => r.status === 'ok');
    const summary = { reliable: ok.length, total: results.length, octaveOffset: 0, consistentOctave: false, avgCents: null, message: '' };
    if (ok.length === 0) {
      summary.message = 'Aucune des notes n\'a pu être mesurée de façon fiable : essaie dans un endroit plus calme, plus près du micro, avec un casque.';
      return summary;
    }
    const offsets = ok.map((r) => r.octaves);
    const sameOctave = offsets.every((x) => x === offsets[0]);
    const near = ok.filter((r) => r.octaves === 0);
    if (near.length) summary.avgCents = Math.round(near.reduce((a, r) => a + r.cents, 0) / near.length);
    if (ok.length >= 2 && sameOctave && offsets[0] !== 0) {
      summary.octaveOffset = offsets[0];
      summary.consistentOctave = true;
      const n = Math.abs(offsets[0]);
      summary.message =
        'Tes notes sont détectées ' + n + ' octave' + (n > 1 ? 's' : '') + (offsets[0] > 0 ? ' plus haut' : ' plus bas') + ' que les références, de façon constante. ' +
        'Soit tu chantes dans une autre octave (normal : une voix grave ou aiguë), soit la détection se trompe d\'octave. ' +
        'Tu peux choisir de décaler les notes créées : c\'est une option, désactivable.';
    } else if (ok.length >= 2 && !sameOctave) {
      summary.message = 'Les écarts d\'octave ne sont pas les mêmes d\'une note à l\'autre : aucune correction n\'est proposée (une seule mesure ne suffit pas à conclure).';
    } else if (ok.length === 1 && offsets[0] !== 0) {
      summary.message = 'Un décalage d\'octave sur une seule note : refais avec une deuxième note avant de conclure.';
    } else {
      summary.message = 'La hauteur détectée correspond aux références' + (summary.avgCents !== null ? ' (écart moyen ' + (summary.avgCents >= 0 ? '+' : '') + summary.avgCents + ' cents)' : '') + '. Aucune correction nécessaire.';
    }
    return summary;
  }

  /** Remet une hauteur MIDI (Do3 = 48 = ligne 0) dans les 36 lignes du piano-roll, en décalant d'octaves si besoin. */
  function midiToRow(midi, options) {
    const o = Object.assign({ baseMidi: 48, rows: 36, octaveShift: 0 }, options || {});
    let row = Math.round(midi) - o.baseMidi + 12 * o.octaveShift;
    let folded = 0;
    while (row < 0) {
      row += 12;
      folded += 1;
    }
    while (row >= o.rows) {
      row -= 12;
      folded += 1;
    }
    return { row, folded };
  }

  return { DEFAULTS, NAMES, hzToMidi, midiToHz, midiName, median, rmsOf, detectPitch, createTracker, createAttackDetector, createOnsetDetector, estimateLatency, evaluateVoiceNote, summarizeVoice, midiToRow };
});

// Tests de js/stn-core.js avec des signaux synthétiques (aucun micro). Lancer : node test-stn.js
const core = require('../js/stn-core.js');
let pass = 0, total = 0;
const ok = (name, cond, info) => { total += 1; if (cond) pass += 1; console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : ' ' + JSON.stringify(info))); };
const SR = 44100;
function rng(seed) { let s = seed; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1; }
// signal : segments [{ t0, t1, hz | hzFn(t), amp }] + bruit
function synth(seconds, segs, noise, seed) {
  const n = Math.floor(seconds * SR), out = new Float32Array(n), r = rng(seed || 1);
  for (let i = 0; i < n; i += 1) out[i] = (noise || 0) * r();
  segs.forEach((s) => {
    let phase = 0;
    for (let i = Math.floor(s.t0 * SR); i < Math.min(n, Math.floor(s.t1 * SR)); i += 1) {
      const t = i / SR, hz = s.hzFn ? s.hzFn(t) : s.hz;
      phase += (2 * Math.PI * hz) / SR;
      const env = Math.min(1, (t - s.t0) / 0.02, (s.t1 - t) / 0.02);
      // voix : fondamentale + harmoniques
      out[i] += (s.amp || 0.3) * env * (Math.sin(phase) + 0.5 * Math.sin(2 * phase) + 0.3 * Math.sin(3 * phase)) / 1.8;
    }
  });
  return out;
}
function run(signal, opts, attackOpts) {
  const tracker = core.createTracker(opts), N = 2048, hop = Math.round(SR * 0.025), events = [], frames = [], scratch = new Float32Array(2048);
  const attack = core.createAttackDetector ? core.createAttackDetector(attackOpts) : null;
  for (let p = 0; p + N <= signal.length; p += hop) {
    const f = core.detectPitch(signal.subarray(p, p + N), SR, null, scratch);
    const t = (p + N / 2) / SR; frames.push({ t, ...f });
    // comme dans le navigateur : on donne au détecteur les NOUVEAUX échantillons (le dernier pas) ; temps en secondes du signal
    const onsets = attack ? attack.process(signal.subarray(p + N - hop, p + N), (p + N) / SR, SR) : [];
    tracker.push({ t, midi: f.midi, conf: f.conf, rms: f.rms, onsets }).forEach((e) => events.push(e));
  }
  tracker.flush(signal.length / SR).forEach((e) => events.push(e));
  return { events, frames, notes: events.filter((e) => e.type === 'end') };
}
// 1. précision de la détection
for (const hz of [110, 196, 261.63, 440, 880]) {
  const f = core.detectPitch(synth(0.2, [{ t0: 0, t1: 0.2, hz }]).subarray(1000, 3048), SR);
  ok('YIN ' + hz + ' Hz', Math.abs(f.freq - hz) / hz < 0.005 && f.conf > 0.9, f);
}
// 2. silence et bruit
let r = run(synth(2, [], 0.0005));
ok('silence : aucune note', r.notes.length === 0 && r.events.filter((e) => e.type === 'start').length === 0, r.events.length);
r = run(synth(2, [], 0.2, 5));
ok('bruit blanc fort : (presque) aucune note', r.notes.length <= 1, r.notes.length);
// 3. une note tenue
r = run(synth(2, [{ t0: 0.3, t1: 1.3, hz: 261.63 }]));
ok('une note tenue : 1 note Do4', r.notes.length === 1 && r.notes[0].midi === 60, r.notes);
ok('une note tenue : début ≈ 0,3 s, fin ≈ 1,3 s', Math.abs(r.notes[0].start - 0.3) < 0.08 && Math.abs(r.notes[0].end - 1.3) < 0.1, r.notes[0]);
// 4. durée qui s'allonge (événements update croissants)
const ups = r.events.filter((e) => e.type === 'update').map((e) => e.end);
ok('les mises à jour allongent la note', ups.length > 10 && ups.every((x, i) => i === 0 || x >= ups[i - 1] - 1e-9), ups.length);
// 5. changement de hauteur : Do4 puis Sol4 (enchaînés)
r = run(synth(2, [{ t0: 0.2, t1: 0.9, hz: 261.63 }, { t0: 0.9, t1: 1.6, hz: 392 }]));
ok('changement de hauteur : 2 notes Do4 puis Sol4', r.notes.length === 2 && r.notes[0].midi === 60 && r.notes[1].midi === 67, r.notes);
ok('la 2e note commence à ≈ 0,9 s', Math.abs(r.notes[1].start - 0.9) < 0.1, r.notes[1]);
// 6. vibrato ±0,4 demi-ton à 5,5 Hz : une seule note
r = run(synth(2, [{ t0: 0.2, t1: 1.8, hzFn: (t) => 329.63 * Math.pow(2, (0.4 * Math.sin(2 * Math.PI * 5.5 * t)) / 12) }]));
ok('vibrato : 1 seule note (Mi4)', r.notes.length === 1 && r.notes[0].midi === 64, r.notes.map((n) => n.midi));
// 7. glissando Do4 → Sol4 : quelques notes, pas des dizaines
r = run(synth(2, [{ t0: 0.2, t1: 1.4, hzFn: (t) => 261.63 * Math.pow(2, ((t - 0.2) / 1.2) * (7 / 12)) }]));
ok('glissando : nombre de notes raisonnable (≤ 9)', r.notes.length >= 2 && r.notes.length <= 9, r.notes.length);
// 8. deux notes séparées par un silence
r = run(synth(3, [{ t0: 0.2, t1: 0.8, hz: 220 }, { t0: 1.5, t1: 2.1, hz: 220 }]));
ok('silence entre deux notes : 2 notes séparées', r.notes.length === 2, r.notes);
// 9. même note répétée avec un petit silence : notes SÉPARÉES
r = run(synth(2, [{ t0: 0.2, t1: 0.8, hz: 220 }, { t0: 0.86, t1: 1.4, hz: 220 }]));
ok('même note répétée (silence de 60 ms) : 2 notes', r.notes.length === 2 && r.notes.every((n) => n.midi === 57), r.notes);
r = run(synth(3, [0.2, 0.6, 1.0, 1.4, 1.8].map((t0) => ({ t0, t1: t0 + 0.32, hz: 261.63 }))));
ok('« ta ta ta ta ta » (5 fois Do4, 80 ms entre chaque) : 5 notes', r.notes.length === 5 && r.notes.every((n) => n.midi === 60), r.notes.map((n) => [n.midi, +n.start.toFixed(2), +n.end.toFixed(2)]));
r = run(synth(3, [0.2, 0.5, 0.8, 1.1, 1.4, 1.7, 2.0, 2.3].map((t0) => ({ t0, t1: t0 + 0.2, hz: 329.63 }))));
ok('croches rapides (8 × Mi4, 100 ms de silence) : 8 notes', r.notes.length === 8, r.notes.length);
// creux d\'amplitude SANS silence complet (legato répété) : nouvelle attaque
const legato = synth(3, [{ t0: 0.2, t1: 1.6, hz: 261.63, amp: 0.3 }]);
for (const c of [0.7, 1.1]) for (let i = Math.floor((c - 0.03) * SR); i < Math.floor((c + 0.03) * SR); i += 1) legato[i] *= 0.2;
r = run(legato);
ok('legato : 2 creux d\'amplitude → 3 notes', r.notes.length === 3, r.notes.map((n) => [+n.start.toFixed(2), +n.end.toFixed(2)]));
r = run(synth(2, [{ t0: 0.2, t1: 0.8, hz: 220 }, { t0: 0.81, t1: 1.4, hz: 220 }]));
ok('trou de 10 ms (coupure très brève, < 24 ms) : 1 note', r.notes.length === 1, r.notes);
// 10. note parasite très courte (30 ms) ignorée
r = run(synth(2, [{ t0: 0.5, t1: 0.53, hz: 330 }]));
ok('clic de 30 ms : aucune note', r.notes.length === 0, r.notes);
// 11. voix + bruit modéré
r = run(synth(2, [{ t0: 0.3, t1: 1.5, hz: 293.66, amp: 0.25 }], 0.02, 3));
ok('voix avec bruit : Ré4 trouvé', r.notes.length >= 1 && r.notes[0].midi === 62, r.notes.map((n) => n.midi));
// 12. un saut d'octave bref (80 ms) ne coupe pas la note (erreur d'octave typique)
r = run(synth(2, [{ t0: 0.2, t1: 0.9, hz: 220 }, { t0: 0.9, t1: 0.98, hz: 440 }, { t0: 0.98, t1: 1.6, hz: 220 }]));
ok('saut d\'octave de 80 ms ignoré', r.notes.length <= 2 && r.notes.filter((n) => n.midi === 57).length >= 1 && !r.notes.some((n) => n.midi === 69), r.notes.map((n) => n.midi));
// 13. aucune note quand on retire le seuil de confiance? (contrôle : événements start == discard + end)
r = run(synth(3, [{ t0: 0.2, t1: 0.7, hz: 200 }, { t0: 1, t1: 1.5, hz: 250 }, { t0: 1.8, t1: 2.3, hz: 300 }]));
const starts = r.events.filter((e) => e.type === 'start').length, ends = r.events.filter((e) => e.type === 'end' || e.type === 'discard').length;
ok('chaque note commencée est terminée (start = end + discard)', starts === ends && starts === 3, [starts, ends]);
// 14. midiToRow
ok('midiToRow : Do3 = ligne 0, Do4 = ligne 12', core.midiToRow(48).row === 0 && core.midiToRow(60).row === 12);
ok('midiToRow : hors grille → replié (Do2 → ligne 12... Do6 → ligne 0)', core.midiToRow(36).row === 0 && core.midiToRow(36).folded === 0 || core.midiToRow(36).row === 0, core.midiToRow(36));
ok('midiToRow : Si5 = 35, Do6 replié à 24', core.midiToRow(83).row === 35 && core.midiToRow(84).row === 24 && core.midiToRow(84).folded === 1, [core.midiToRow(83), core.midiToRow(84)]);
ok('midiToRow : octaveShift', core.midiToRow(60, { octaveShift: -1 }).row === 0);
// 15. calibrage de latence
const targets = Array.from({ length: 10 }, (_, k) => 1 + 0.8 * k);
let rr = core.estimateLatency(targets, targets.map((t, k) => t + 0.14 + 0.01 * Math.sin(k)));
ok('latence : médiane ≈ 140 ms, fiabilité bonne', Math.abs(rr.medianMs - 140) <= 15 && rr.reliability === 'bonne' && rr.compensationMs === rr.medianMs, rr);
rr = core.estimateLatency(targets, targets.map((t, k) => t + (k === 4 ? 0.5 : 0.12)));
ok('latence : une mesure aberrante écartée', Math.abs(rr.medianMs - 120) <= 5 && rr.kept.length === rr.deltas.length - 1, rr);
rr = core.estimateLatency(targets, [1.1, 3.5, 5.9]);
ok('latence : trop peu de mesures → fiabilité faible', rr.reliability === 'faible', rr);
rr = core.estimateLatency(targets, targets.map((t, k) => t + [0.02, 0.31, -0.1, 0.4, 0.05, 0.38, -0.15, 0.2][k % 8]));
ok('latence : mesures incohérentes → fiabilité pas bonne', rr.reliability !== 'bonne', rr);
rr = core.estimateLatency(targets, targets.map((t) => t + 0.03));
ok('latence : sons collés au clic → écho suspecté', rr.suspectEcho === true, rr);
rr = core.estimateLatency(targets, []);
ok('latence : aucun son → rien d\'apparié', rr.matched === 0 && rr.compensationMs === 0, rr);
rr = core.estimateLatency(targets, targets.map((t) => t + 0.58), { maxCompensationMs: 300 });
ok('latence : compensation bornée', rr.compensationMs <= 300, rr);
// détecteur de début de son
const od = core.createOnsetDetector({ floor: 0.003 }); let fired = [];
for (let i = 0; i < 200; i += 1) { const t = i * 0.01; const rms = (t > 0.5 && t < 0.7) || (t > 1.2 && t < 1.4) ? 0.1 : 0.003; if (od.push(t, rms)) fired.push(+t.toFixed(2)); }
ok('onsets : 2 débuts de son détectés', fired.length === 2 && Math.abs(fired[0] - 0.51) < 0.03 && Math.abs(fired[1] - 1.21) < 0.03, fired);
// 16. calibrage vocal
let v = core.evaluateVoiceNote(60, Array.from({ length: 30 }, () => ({ midi: 60.1, conf: 0.95 })));
ok('vocal : Do4 chanté Do4 → ok, écart ≈ +10 cents', v.status === 'ok' && v.octaves === 0 && Math.abs(v.cents - 10) <= 2, v);
v = core.evaluateVoiceNote(60, Array.from({ length: 30 }, () => ({ midi: 48.05, conf: 0.95 })));
ok('vocal : une octave plus bas détectée', v.status === 'ok' && v.octaves === -1, v);
v = core.evaluateVoiceNote(60, Array.from({ length: 3 }, () => ({ midi: 60, conf: 0.95 })));
ok('vocal : trop peu de trames → pas de conclusion', v.status === 'unreliable', v);
v = core.evaluateVoiceNote(60, Array.from({ length: 30 }, (_, i) => ({ midi: 58 + (i % 6), conf: 0.95 })));
ok('vocal : voix instable → pas de conclusion', v.status === 'unreliable', v);
v = core.evaluateVoiceNote(60, Array.from({ length: 30 }, () => ({ midi: 70, conf: 0.4 })));
ok('vocal : confiance faible → pas de conclusion', v.status === 'unreliable', v);
const mk = (ref, det) => core.evaluateVoiceNote(ref, Array.from({ length: 30 }, () => ({ midi: det, conf: 0.95 })));
let sm = core.summarizeVoice([mk(60, 48), mk(67, 55)]);
ok('résumé : décalage d\'octave constant signalé (-1)', sm.consistentOctave && sm.octaveOffset === -1, sm);
sm = core.summarizeVoice([mk(60, 48), mk(67, 67)]);
ok('résumé : écarts incohérents → aucune correction proposée', !sm.consistentOctave && sm.octaveOffset === 0, sm);
sm = core.summarizeVoice([mk(60, 48)]);
ok('résumé : une seule note → pas de correction', !sm.consistentOctave, sm);
sm = core.summarizeVoice([mk(60, 60), mk(67, 67)]);
ok('résumé : tout juste → aucune correction', !sm.consistentOctave && /Aucune correction/.test(sm.message), sm);

// ======== v23 : syllabes réalistes (consonne + voyelle), mélodies, alternances, bruits de bouche ========
// syllabe : fermeture silencieuse, éclat de consonne (bruit aigu), voyelle à attaque rapide ; hzFn facultatif (glissé)
function syllables(seconds, list, noiseAmp) {
  const out = synth(seconds, [], noiseAmp || 0.0003, 9), r = rng(77);
  list.forEach((s) => {
    const { t0, dur, hz } = s; // t0 = début de la consonne
    const consonant = s.consonant === undefined ? 0.014 : s.consonant, dip = s.dip === undefined ? 0 : s.dip; // dip : creux de la voyelle précédente (« la »)
    let phase = 0, prev = 0;
    for (let i = Math.floor(t0 * SR); i < Math.min(out.length, Math.floor((t0 + dur) * SR)); i += 1) {
      const t = i / SR, u = t - t0;
      if (u < consonant) { const w = r(); out[i] += 0.22 * (w - prev); prev = w; continue; } // bruit filtré passe-haut = « t »
      const f = s.hzFn ? s.hzFn(u - consonant) : hz;
      phase += (2 * Math.PI * f) / SR;
      const v = u - consonant, tail = t0 + dur - t;
      const env = Math.min(1, 0.15 + v / 0.012, tail / 0.03);
      out[i] += (s.amp || 0.3) * env * (Math.sin(phase) + 0.5 * Math.sin(2 * phase) + 0.3 * Math.sin(3 * phase)) / 1.8;
    }
  });
  return out;
}
const pitches = (r) => r.notes.map((n) => n.midi);
const bounds = (r) => r.notes.map((n) => [+n.start.toFixed(2), +n.end.toFixed(2)]);
// 1. note tenue plusieurs secondes
r = run(synth(5, [{ t0: 0.3, t1: 4.5, hz: 261.63 }]));
ok('V1 note tenue 4 s : UNE note', r.notes.length === 1 && r.notes[0].midi === 60 && r.notes[0].end - r.notes[0].start > 3.9, r.notes);
// 2. ta-ta-ta-ta, même hauteur
r = run(syllables(3, [0.3, 0.75, 1.2, 1.65].map((t0) => ({ t0, dur: 0.32, hz: 261.63 }))));
ok('V2 « ta ta ta ta » : 4 notes distinctes, même hauteur', r.notes.length === 4 && pitches(r).every((m) => m === 60), bounds(r));
ok('V2 les attaques tombent sur les « t » (± 40 ms)', r.notes.length === 4 && r.notes.every((n, i) => Math.abs(n.start - [0.3, 0.75, 1.2, 1.65][i]) < 0.04), bounds(r));
// 2b. ta-ta rapide (6 notes/s) 
r = run(syllables(3, [0.3, 0.47, 0.64, 0.81, 0.98, 1.15].map((t0) => ({ t0, dur: 0.14, hz: 293.66 }))));
ok('V2b « ta » rapides (170 ms) : 6 notes', r.notes.length === 6, bounds(r));
// 3. la-la-la-la : pas de consonne, creux d'énergie de 12 dB
function lala(times, hz) {
  const sig = synth(3, [{ t0: times[0], t1: times[times.length - 1] + 0.4, hz, amp: 0.3 }]);
  times.slice(1).forEach((c) => { for (let i = Math.floor((c - 0.035) * SR); i < Math.floor((c + 0.035) * SR); i += 1) { const x = Math.abs(i / SR - c) / 0.035; sig[i] *= 0.25 + 0.75 * x * x; } });
  return sig;
}
r = run(lala([0.3, 0.75, 1.2, 1.65], 329.63));
ok('V3 « la la la la » (creux de 12 dB, sans silence) : 4 notes', r.notes.length === 4 && pitches(r).every((m) => m === 64), bounds(r));
// 4. mélodie ascendante, notes liées (sans silence) : montent
const up = [60, 62, 64, 65, 67, 69];
r = run(synth(3, up.map((m, i) => ({ t0: 0.2 + i * 0.4, t1: 0.2 + (i + 1) * 0.4, hz: core.midiToHz(m) }))));
ok('V4 mélodie ascendante (liée) : Do Ré Mi Fa Sol La dans l\'ordre croissant', JSON.stringify(pitches(r)) === JSON.stringify(up), pitches(r));
r = run(syllables(3.5, up.map((m, i) => ({ t0: 0.2 + i * 0.4, dur: 0.34, hz: core.midiToHz(m) }))));
ok('V4b mélodie ascendante en « ta » : mêmes notes, strictement croissantes', JSON.stringify(pitches(r)) === JSON.stringify(up), pitches(r));
// 5. descendante
const down = up.slice().reverse();
r = run(synth(3, down.map((m, i) => ({ t0: 0.2 + i * 0.4, t1: 0.2 + (i + 1) * 0.4, hz: core.midiToHz(m) }))));
ok('V5 mélodie descendante (liée) : ordre décroissant', JSON.stringify(pitches(r)) === JSON.stringify(down), pitches(r));
r = run(syllables(3.5, down.map((m, i) => ({ t0: 0.2 + i * 0.4, dur: 0.34, hz: core.midiToHz(m) }))));
ok('V5b descendante en « ta »', JSON.stringify(pitches(r)) === JSON.stringify(down), pitches(r));
// 6. alternance rapide entre deux hauteurs (liées, 130 ms)
const alt = [69, 72, 69, 72, 69, 72, 69, 72];
r = run(synth(2, alt.map((m, i) => ({ t0: 0.2 + i * 0.13, t1: 0.2 + (i + 1) * 0.13, hz: core.midiToHz(m) }))));
ok('V6 alternance rapide La4/Do5 (130 ms) : ≥ 6 notes sur 8, alternées', r.notes.length >= 6 && r.notes.every((n, i, a) => i === 0 || n.midi !== a[i - 1].midi), pitches(r));
// 7. vibrato avec battement d'amplitude (±2 dB) : une seule note
const vib = synth(3, [{ t0: 0.2, t1: 2.6, hzFn: (t) => 392 * Math.pow(2, (0.45 * Math.sin(2 * Math.PI * 5.5 * t)) / 12) }]);
for (let i = 0; i < vib.length; i += 1) vib[i] *= 1 + 0.22 * Math.sin(2 * Math.PI * 5.5 * (i / SR));
r = run(vib);
ok('V7 vibrato (hauteur ±0,45 ton, volume ±2 dB) : UNE note', r.notes.length === 1 && r.notes[0].midi === 67, bounds(r));
// 7b. crescendo/decrescendo 12 dB sur une note tenue : une note
const cresc = synth(3, [{ t0: 0.2, t1: 2.8, hz: 261.63, amp: 0.1 }]);
for (let i = 0; i < cresc.length; i += 1) cresc[i] *= 1 + 3 * Math.sin(Math.PI * Math.min(1, Math.max(0, (i / SR - 0.2) / 2.6)));
r = run(cresc);
ok('V7b crescendo puis decrescendo de ≈ 12 dB : UNE note', r.notes.length === 1, bounds(r));
// 8. silences
r = run(syllables(4, [{ t0: 0.3, dur: 0.5, hz: 261.63 }, { t0: 1.6, dur: 0.5, hz: 261.63 }, { t0: 2.8, dur: 0.4, hz: 329.63 }]));
ok('V8 silences : 3 notes, durées séparées', r.notes.length === 3 && r.notes[0].end < 0.95 && r.notes[1].start > 1.5 && r.notes[1].end < 2.25 && r.notes[2].start > 2.7, bounds(r));
// 9. bruits de bouche / souffle : aucune note
const mouth = synth(4, [], 0.0004, 5), rn = rng(5);
[0.5, 1.4, 2.2].forEach((c, k) => { for (let i = Math.floor(c * SR); i < Math.floor((c + 0.03 + 0.02 * k) * SR); i += 1) mouth[i] += 0.25 * rn() * Math.sin(Math.PI * (i / SR - c) / (0.03 + 0.02 * k)); });
for (let i = Math.floor(2.8 * SR); i < Math.floor(3.5 * SR); i += 1) mouth[i] += 0.03 * rn();
r = run(mouth);
ok('V9 clics de bouche + souffle : aucune note parasite', r.notes.length === 0, bounds(r));
// 11. notes répétées de durées différentes
const durs = [0.12, 0.4, 0.2, 0.8, 0.16];
let cursor = 0.3; const list = durs.map((d) => { const o = { t0: cursor, dur: d, hz: 220 }; cursor += d + 0.09; return o; });
r = run(syllables(4, list));
ok('V11 5 « ta » de durées différentes : 5 notes dont les longueurs suivent', r.notes.length === 5 && r.notes.every((n, i) => Math.abs((n.end - n.start) - (durs[i])) < 0.1), r.notes.map((n) => +(n.end - n.start).toFixed(2)));
// 12. glissé d'attaque (« scoop » : démarre 1,5 demi-ton trop bas) : UNE note, à la hauteur visée
r = run(syllables(2, [{ t0: 0.3, dur: 0.7, hzFn: (u) => 329.63 * Math.pow(2, (-1.5 * Math.max(0, 1 - u / 0.07)) / 12) }]));
ok('V12 attaque en glissé (−1,5 ton → cible Mi4) : UNE note Mi4', r.notes.length === 1 && r.notes[0].midi === 64, pitches(r));
// raisons des événements (mode diagnostic)
r = run(syllables(3, [0.3, 0.75].map((t0) => ({ t0, dur: 0.32, hz: 261.63 }))));
ok('diagnostic : chaque début/fin de note porte une raison', r.events.filter((e) => e.type === 'start' || e.type === 'end').every((e) => typeof e.reason === 'string' && e.reason.length > 0), r.events.filter((e) => e.type === 'start' || e.type === 'end'));

// conversion fréquence -> MIDI -> ligne du piano-roll : plus aigu = MIDI plus grand = ligne plus haute
{
  const refs = [[110, 45], [130.81, 48], [196, 55], [220, 57], [261.63, 60], [329.63, 64], [440, 69], [523.25, 72], [880, 81]];
  ok('Hz -> MIDI : 69 + 12·log2(f/440) sur 9 fréquences de référence', refs.every(([hz, m]) => Math.abs(core.hzToMidi(hz) - m) < 0.01), refs.map(([hz]) => core.hzToMidi(hz).toFixed(2)));
  ok('Hz -> MIDI : strictement croissant avec la fréquence', refs.every((x, i) => i === 0 || core.hzToMidi(x[0]) > core.hzToMidi(refs[i - 1][0])));
  ok('MIDI -> Hz -> MIDI : aller-retour exact', [48, 60, 69, 72, 83].every((m) => Math.abs(core.hzToMidi(core.midiToHz(m)) - m) < 1e-9));
  const rows = [48, 52, 55, 60, 64, 67, 72, 79, 83].map((m) => core.midiToRow(m).row);
  ok('MIDI -> ligne : strictement croissant dans la plage (Do3..Si5)', rows.every((r, i) => i === 0 || r > rows[i - 1]), rows);
  ok('YIN -> MIDI : une note plus aiguë chantée donne une ligne plus haute (Do4 < Mi4 < Sol4 < La4)', [261.63, 329.63, 392, 440].map((hz) => core.midiToRow(Math.round(core.detectPitch(synth(0.2, [{ t0: 0, t1: 0.2, hz }]).subarray(1000, 3048), SR).midi)).row).every((r, i, a) => i === 0 || r > a[i - 1]));
  ok('midiName : Do4 / La4 / Si5', core.midiName(60).startsWith('Do4') && core.midiName(69).startsWith('La4') && core.midiName(83).startsWith('Si5'), [core.midiName(60), core.midiName(69), core.midiName(83)]);
}

// voix grave dont le 5e harmonique domine (cas réel d'un fredonnement masculin) : ne pas annoncer 5 × la fréquence
{
  const f0 = 123.5, n = 2048, buf = new Float32Array(n), amps = [0.25, 0.3, 0.35, 0.5, 1.0, 0.7];
  for (let i = 0; i < n; i += 1) { let v = 0; amps.forEach((a, k) => { v += a * Math.sin(2 * Math.PI * f0 * (k + 1) * i / SR + k); }); buf[i] = 0.1 * v; }
  const f = core.detectPitch(buf, SR);
  ok('harmonique dominant (fondamentale 123,5 Hz, 5e harmonique le plus fort) : fondamentale retrouvée', Math.abs(f.freq - f0) / f0 < 0.03, f);
}

console.log(pass === total ? 'OK ' + pass + '/' + total : 'ÉCHECS ' + (total - pass) + ' — ' + pass + '/' + total);
process.exit(pass === total ? 0 : 1);

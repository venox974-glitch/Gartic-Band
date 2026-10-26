const T = require('../js/bpm-tap.js');
let fails = 0;
const check = (n, ok, d) => { if (!ok) fails++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };
const L = { min: 60, max: 180 };
const taps = (ms, n, jitter = 0, t0 = 1000, rnd = (() => { let s = 7; return () => ((s = (s * 16807) % 2147483647) / 2147483647 - 0.5); })()) => Array.from({ length: n }, (_, i) => t0 + i * ms + (jitter ? rnd() * 2 * jitter : 0));

check('B1 moins de 3 appuis : pas d\'estimation', T.estimate([0], L).bpm === null && T.estimate([0, 500], L).bpm === null);
check('B2 500 ms exacts = 120 BPM', T.estimate(taps(500, 8), L).bpm === 120);
check('B3 formule 60000/ms (545 ms ≈ 110)', T.estimate(taps(545.45, 10), L).bpm === 110);
const j = T.estimate(taps(500, 16, 25), L);
check('B4 appuis imprécis (±25 ms) : 120 ± 2', Math.abs(j.bpm - 120) <= 2, j.bpm);
// un appui accidentel (double tap) au milieu
const dbl = taps(500, 10); dbl.splice(5, 0, dbl[4] + 90);
check('B5 double appui accidentel ignoré', Math.abs(T.estimate(dbl, L).bpm - 120) <= 2, T.estimate(dbl, L).bpm);
// un appui oublié (intervalle double)
const miss = taps(500, 12); miss.splice(6, 1);
check('B6 appui oublié ignoré', Math.abs(T.estimate(miss, L).bpm - 120) <= 2, T.estimate(miss, L).bpm);
const stableRes = T.estimate(taps(500, 12, 6), L);
check('B7 stable après plusieurs appuis réguliers', stableRes.stable === true, stableRes);
check('B8 irrégulier : pas stable', T.estimate([0, 400, 1100, 1500, 2400, 2800], L).stable === false);
const a = T.estimate(taps(500, 8), L).alternatives;
check('B9 alternatives plausibles : 60 et 240 -> ÷2 ok, ×2 hors plage', a.half === 60 && a.double === null, a);
const a2 = T.estimate(taps(400, 8), L).alternatives; // 150 BPM
check('B10 150 BPM : ÷2 = 75 proposé, ×2 = 300 refusé', a2.half === 75 && a2.double === null, a2);
const a3 = T.estimate(taps(1000, 8), L); // 60 BPM
check('B11 60 BPM : ×2 = 120 proposé, ÷2 refusé', a3.bpm === 60 && a3.alternatives.double === 120 && a3.alternatives.half === null, a3);
check('B12 intervalles hors plage ignorés (50 ms)', T.estimate(taps(50, 10), L).bpm === null);
const pause = taps(500, 6).concat(taps(500, 8, 0, 20000));
check('B13 longue pause : on repart de zéro', Math.abs(T.estimate(pause, L).bpm - 120) <= 1);
const drift = taps(600, 10).concat(taps(480, 14, 0, 1000 + 9 * 600 + 480));
check('B14 le tempo suit un changement (100 -> 125)', Math.abs(T.estimate(drift, L).bpm - 125) <= 3, T.estimate(drift, L).bpm);
check('B15 entrées invalides sans erreur', T.estimate(null, L).bpm === null && T.estimate([NaN, 1, 'a'], L).bpm === null);
console.log(fails ? fails + ' ÉCHEC(S)' : 'OK');
process.exit(fails ? 1 : 0);

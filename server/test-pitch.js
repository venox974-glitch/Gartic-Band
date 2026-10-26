const P = require('../js/pitch.js');
const SR = 44100;
let fails = 0;
const check = (n, ok, d) => { if (!ok) fails++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };

function tone(freq, seconds, opts = {}) {
  const n = Math.round(seconds * SR);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const env = opts.decay ? Math.exp(-t * opts.decay) : 1;
    out[i] = (Math.sin(2 * Math.PI * freq * t) + (opts.harm ? 0.4 * Math.sin(4 * Math.PI * freq * t) + 0.2 * Math.sin(6 * Math.PI * freq * t) : 0)) * 0.5 * env;
  }
  return out;
}
// fréquence dominante par autocorrélation (fenêtre au milieu)
function pitchOf(data, fromS, toS) {
  const a = Math.round(fromS * SR), b = Math.round(toS * SR);
  const seg = data.subarray(a, b);
  const minLag = Math.round(SR / 2500), maxLag = Math.round(SR / 60);
  const scores = new Float64Array(maxLag + 2);
  let best = -Infinity;
  for (let lag = minLag; lag <= maxLag + 1; lag++) {
    let s = 0;
    for (let i = 0; i + lag < seg.length; i++) s += seg[i] * seg[i + lag];
    scores[lag] = s / (seg.length - lag);
    if (lag <= maxLag && scores[lag] > best) best = scores[lag];
  }
  // plus petit retard qui est un maximum local proche du meilleur (évite de prendre un sous-multiple)
  for (let lag = minLag + 1; lag <= maxLag; lag++) {
    if (scores[lag] >= 0.9 * best && scores[lag] >= scores[lag - 1] && scores[lag] >= scores[lag + 1]) {
      // affinement parabolique
      const y0 = scores[lag - 1], y1 = scores[lag], y2 = scores[lag + 1];
      const denom = y0 - 2 * y1 + y2;
      const shift = denom !== 0 ? 0.5 * (y0 - y2) / denom : 0;
      return SR / (lag + shift);
    }
  }
  return 0;
}
function rms(data) { let s = 0; for (const v of data) s += v * v; return Math.sqrt(s / data.length); }

const base = 440;
for (const harm of [false, true]) {
  const x = tone(base, 2.0, { harm });
  for (const semi of [-12, -7, -3, 0, 3, 7, 12, 19]) {
    const t0 = Date.now();
    const [y] = P.shift([x], SR, semi);
    const ms = Date.now() - t0;
    const want = base * Math.pow(2, semi / 12);
    const got = pitchOf(y, 0.5, 1.2);
    const cents = 1200 * Math.log2(got / want);
    check(`${harm ? 'riche' : 'sinus'} ${semi >= 0 ? '+' : ''}${semi} : durée identique`, y.length === x.length, [y.length, x.length]);
    check(`${harm ? 'riche' : 'sinus'} ${semi >= 0 ? '+' : ''}${semi} : hauteur juste (±30 cents)`, Math.abs(cents) < 30, { want: +want.toFixed(1), got: +got.toFixed(1), cents: +cents.toFixed(1), ms });
    const level = rms(y.subarray(Math.round(0.3 * SR), Math.round(1.7 * SR))) / rms(x.subarray(Math.round(0.3 * SR), Math.round(1.7 * SR)));
    check(`${harm ? 'riche' : 'sinus'} ${semi >= 0 ? '+' : ''}${semi} : niveau conservé (0,7–1,3)`, level > 0.7 && level < 1.3, +level.toFixed(2));
  }
}
// son qui décroît : le moment de l'attaque et la fin ne bougent pas
const dec = tone(262, 1.5, { decay: 3, harm: true });
for (const semi of [-5, 7]) {
  const [y] = P.shift([dec], SR, semi);
  const peakAt = (d) => { let m = 0, at = 0; for (let i = 0; i < d.length; i++) if (Math.abs(d[i]) > m) { m = Math.abs(d[i]); at = i; } return at / SR; };
  const halfLife = (d) => { const pk = Math.max(...Array.from(d.subarray(0, 2000)).map(Math.abs)); for (let i = 0; i < d.length - 512; i += 256) { let m = 0; for (let j = 0; j < 512; j++) m = Math.max(m, Math.abs(d[i + j])); if (m < pk / 2) return i / SR; } return d.length / SR; };
  check(`décroissance ${semi} : même durée de vie (demi-vie ±25 %)`, Math.abs(halfLife(y) / halfLife(dec) - 1) < 0.25, [halfLife(y).toFixed(3), halfLife(dec).toFixed(3)]);
  check(`décroissance ${semi} : attaque au début (pic < 60 ms)`, peakAt(y) < 0.06, peakAt(y));
}
// stéréo : mêmes décisions
{
  const L = tone(330, 1.2), R = tone(330, 1.2, { harm: true });
  const [yl, yr] = P.shift([L, R], SR, 5);
  check('stéréo : deux canaux de la bonne longueur', yl.length === L.length && yr.length === R.length);
  check('stéréo : hauteur identique sur les deux canaux', Math.abs(1200 * Math.log2(pitchOf(yl, 0.3, 0.9) / pitchOf(yr, 0.3, 0.9))) < 30);
}
// son très court (percussion 80 ms) : durée conservée, pas de NaN
{
  const click = tone(200, 0.08, { decay: 40 });
  for (const semi of [-12, 12]) {
    const [y] = P.shift([click], SR, semi);
    check(`percussion courte ${semi} : durée conservée, valeurs finies`, y.length === click.length && y.every(Number.isFinite));
  }
}
// 0 demi-ton = copie identique
{ const x = tone(440, 0.5); const [y] = P.shift([x], SR, 0); check('0 demi-ton : identique', y.length === x.length && y.every((v, i) => v === x[i]) && y !== x); }
// perf : 5 s stéréo
{ const x = tone(440, 5, { harm: true }); const t0 = Date.now(); P.shift([x, x], SR, -9); const ms = Date.now() - t0; check('5 s stéréo, -9 demi-tons : calcul < 1500 ms', ms < 1500, ms); }
// cache
{ const c = P.createCache(1000); c.set('a', 1, 600); c.set('b', 2, 600); check('cache : le plus ancien est oublié au-delà du plafond', !c.has('a') && c.has('b')); }
console.log(fails ? fails + ' ÉCHECS' : 'OK');
process.exit(fails ? 1 : 0);

// Tests de js/mic-prefs.js. Lancer : node test-micprefs.js
const M = require('../js/mic-prefs.js');
let pass = 0, total = 0;
const ok = (name, cond, info) => { total += 1; if (cond) pass += 1; console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : ' ' + JSON.stringify(info))); };
const store = (init) => { const d = Object.assign({}, init); return { d, getItem: (k) => (k in d ? d[k] : null), setItem: (k, v) => { d[k] = String(v); } }; };

let s = store();
let p = M.create(s);
ok('départ : compensation activée, aucun micro connu, pastille « non calibré »', p.isEnabled() && !p.hasAny() && !p.hasAnyCalibrated() && p.getLatencyMs('mic1') === 0);
const saved = p.setLatency('mic1', { ms: 140, reliability: 'bonne', method: 'click', label: 'Casque USB' });
ok('calibrage enregistré et relu', p.get('mic1').ms === 140 && p.isCalibrated('mic1') && p.getLatencyMs('mic1') === 140 && saved.label === 'Casque USB');
ok('un autre micro n\'est pas calibré', !p.isCalibrated('mic2') && p.get('mic2') === null && p.getLatencyMs('mic2') === 0);
p.setLatency('mic2', { ms: 60, method: 'manual' });
ok('un réglage manuel compte comme « réglé » mais pas comme « calibré »', p.get('mic2').ms === 60 && !p.isCalibrated('mic2') && p.hasAny() && p.hasAnyCalibrated());
p.setEnabled(false);
ok('compensation coupée : décalage 0 partout, valeurs conservées', p.getLatencyMs('mic1') === 0 && p.get('mic1').ms === 140);
p.setEnabled(true);
const p2 = M.create(s);
ok('persistance : un nouveau chargement retrouve tout', p2.get('mic1').ms === 140 && p2.get('mic2').method === 'manual' && p2.isEnabled());
p.setLatency('mic3', { ms: 9999, method: 'click' });
ok('le décalage est borné à ±400 ms', p.get('mic3').ms === 400);
p.setLatency('mic3', { ms: -9999, method: 'click' });
ok('borne négative', p.get('mic3').ms === -400);
ok('valeur invalide refusée', p.setLatency('mic4', { ms: 'abc', method: 'click' }) === null && p.get('mic4') === null);
p.setLatency('mic5', { ms: 10, method: 'nimporte' });
ok('méthode inconnue → « manual » (jamais comptée comme calibrée)', p.get('mic5').method === 'manual' && !p.isCalibrated('mic5'));
p.forget('mic1');
ok('oublier un micro', p.get('mic1') === null && !p.isCalibrated('mic1'));
let n = 0; const off = p.onChange(() => { n += 1; }); p.setEnabled(false); p.setLatency('x', { ms: 1, method: 'click' }); off(); p.setEnabled(true);
ok('onChange notifie les modifications puis se désabonne', n === 2, n);
// migration depuis Speech to Note
const old = store({ 'gartic-bande.stn.v1': JSON.stringify({ latencyOn: false, octave: 1, latency: { oldmic: { ms: 120, reliability: 'bonne', method: 'visual' }, bad: { ms: 'x' } } }) });
const pm = M.create(old);
ok('migration : reprend latence et activation de Speech to Note', pm.get('oldmic').ms === 120 && pm.isCalibrated('oldmic') && !pm.isEnabled() && pm.get('bad') === null);
ok('migration : la nouvelle clé est écrite, l\'ancienne n\'est pas touchée', 'gartic-bande.mic.v1' in old.d && JSON.parse(old.d['gartic-bande.stn.v1']).octave === 1);
// données corrompues / stockage absent ou bloqué
const bad = M.create(store({ 'gartic-bande.mic.v1': '{pas du json' }));
ok('stockage corrompu : valeurs par défaut, pas d\'erreur', bad.isEnabled() && !bad.hasAny());
const mem = M.create(null);
mem.setLatency('a', { ms: 5, method: 'click' });
ok('sans stockage : fonctionne en mémoire', mem.get('a').ms === 5);
const throwing = M.create({ getItem() { throw new Error('bloqué'); }, setItem() { throw new Error('bloqué'); } });
ok('stockage qui lève une erreur : pas de plantage', throwing.setLatency('a', { ms: 5, method: 'click' }).ms === 5);
for (let i = 0; i < 30; i += 1) p.setLatency('d' + i, { ms: i, method: 'click' });
ok('au plus 20 micros mémorisés', p.list().length <= 20, p.list().length);
console.log(pass === total ? 'OK ' + pass + '/' + total : 'ÉCHECS ' + (total - pass) + ' — ' + pass + '/' + total);
process.exit(pass === total ? 0 : 1);

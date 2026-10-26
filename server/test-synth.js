'use strict';
/**
 * Tests de l'instrument personnalisé (js/synth.js) : nettoyage des réglages, identifiant, vérification côté serveur
 * (contributions et choix de préparation).
 */
const Synth = require('../js/synth.js');
const Phases = require('../js/phases.js');
const { validateContribution } = require('./rooms');

let passed = 0;
const failures = [];
function check(name, ok, detail) {
  if (ok) {
    passed += 1;
    console.log('PASS ' + name);
  } else {
    failures.push(name);
    console.log('FAIL ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : ''));
  }
}

const base = Synth.normalize({ label: 'Mon synthé', icon: '🎸', wave: 'drawn', unison: 3, filterType: 'lowpass', sweep: 2 });
const id = Synth.idOf(base);
// Ancien émoji : même identifiant que la nouvelle icône (les instruments déjà créés ne changent pas d'id).
check('Y0 ancien émoji → même icône et même identifiant', Synth.normalize({ icon: '🎸' }).icon === 'guitar' && Synth.idOf({ icon: '🎸' }) === Synth.idOf({ icon: 'guitar' }));
const notes = [{ step: 0, row: 12, length: 1 }];

check('Y1 réglages vides → instrument complet et valide', (() => { const n = Synth.normalize(null); return n.wave === 'sawtooth' && n.harmonics.length === 16 && n.unison === 1 && n.label === 'Instrument'; })());
check('Y2 valeurs absurdes ramenées dans les limites', (() => { const n = Synth.normalize({ attack: 99, sustain: -5, unison: 50, cutoff: 'x', wave: '<img>', icon: 'x', label: '<b>' + 'a'.repeat(100) }); return n.attack === 1.5 && n.sustain === 0 && n.unison === 5 && n.cutoff === 70 && n.wave === 'sawtooth' && n.icon === 'knob' && n.label.length <= 20 && !n.label.includes('<'); })());
check('Y3 harmoniques : 16 valeurs entre 0 et 1, jamais toutes nulles', (() => { const n = Synth.normalize({ harmonics: [5, -1, 'a', 0.456].concat(new Array(40).fill(1)) }); const z = Synth.normalize({ harmonics: new Array(16).fill(0) }); return n.harmonics.length === 16 && n.harmonics[0] === 1 && n.harmonics[1] === 0 && n.harmonics[3] === 0.46 && z.harmonics[0] === 1; })());
check('Y4 identifiant stable : custom- + 12 caractères', /^custom-[0-9a-f]{12}$/.test(id) && Synth.idOf(Synth.normalize(base)) === id && Synth.idOf(JSON.parse(JSON.stringify(base))) === id);
check('Y5 un réglage change → l\'identifiant change', Synth.idOf(Object.assign({}, base, { cutoff: 71 })) !== id && Synth.idOf(Object.assign({}, base, { label: 'Autre' })) !== id);
check('Y6 verify accepte réglages + identifiant cohérents', Synth.verify(id, base).ok && Synth.verify(id, base).settings.unison === 3);
check('Y7 verify refuse un identifiant qui ne correspond pas aux réglages', !Synth.verify(id, Object.assign({}, base, { cutoff: 12 })).ok && !Synth.verify('custom-000000000000', base).ok);
check('Y8 verify refuse un identifiant mal formé ou des réglages absents', !Synth.verify('custom-xyz', base).ok && !Synth.verify(id, null).ok && !Synth.verify('piano', base).ok);

const good = { instrumentId: id, settings: base, instrument: { id, engine: 'custom', label: 'x', settings: base }, notes };
check('Y9 contribution avec instrument personnalisé valide acceptée', validateContribution(good, 4).ok);
const out = validateContribution(Object.assign({}, good, { instrument: { id, engine: 'custom', label: '<script>', icon: 'x', settings: Object.assign({}, base, { label: 'ok' }) } }), 4);
check('Y10 le serveur renvoie l\'instantané NETTOYÉ (étiquette et réglages recalculés, pas ceux du client)', out.ok === false || (out.value.instrument.label === base.label && out.value.instrument.settings.label === base.label), out.ok ? out.value.instrument : out);
check('Y11 contribution : identifiant falsifié refusé', !validateContribution(Object.assign({}, good, { instrumentId: 'custom-aaaaaaaaaaaa', instrument: null }), 4).ok);
check('Y12 contribution : réglages falsifiés refusés', !validateContribution(Object.assign({}, good, { settings: Object.assign({}, base, { cutoff: 3 }) }), 4).ok);
check('Y13 contribution : instrument « custom » déguisé sous un autre identifiant refusé', !validateContribution({ instrumentId: 'piano', instrument: { id: 'piano', engine: 'custom', settings: base }, settings: null, notes }, 4).ok);
check('Y14 contribution : réglages trop volumineux refusés', !validateContribution(Object.assign({}, good, { settings: Object.assign({}, base, { pad: 'x'.repeat(7000) }) }), 4).ok);

const prepOk = Phases.normalizePrep({ bpm: 110, instrumentId: id, mode: 'beginner', settings: base }, { hasSound: () => true });
check('Y15 préparation avec instrument personnalisé valide acceptée (réglages nettoyés gardés)', prepOk.ok && prepOk.value.settings.unison === 3, prepOk);
check('Y16 préparation : identifiant falsifié refusé', !Phases.normalizePrep({ bpm: 110, instrumentId: 'custom-aaaaaaaaaaaa', mode: 'beginner', settings: base }, { hasSound: () => true }).ok);
check('Y17 préparation : « custom- » sans réglages refusé', !Phases.normalizePrep({ bpm: 110, instrumentId: id, mode: 'beginner', settings: null }, { hasSound: () => true }).ok);

console.log('\n' + passed + '/' + (passed + failures.length) + ' OK');
process.exit(failures.length ? 1 : 0);

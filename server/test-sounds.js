'use strict';
/**
 * Tests des sons importés : stockage par salon, accès, quotas, et contributions qui citent un son par son empreinte.
 */
const WebSocket = require('ws');
const Themes = require('../js/themes.js');
const { server, manager } = require('./server');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
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


/** Joue les phases d'avant-composition (proposition, vote, préparation) puis attend le round 1. */
async function playPregame(clients) {
  const lastRoom = (c) => c.messages.filter((m) => m.room).map((m) => m.room).pop();
  clients.forEach((c) => c.send({ t: 'pre-propose', text: 'Idée de ' + c.name }));
  if (clients.length > 2) {
    await Promise.all(clients.map((c) => c.wait('room', (m) => m.room.pre && m.room.pre.stage === 'vote')));
    clients.forEach((c) => c.send({ t: 'pre-vote', id: lastRoom(c).pre.book.themes.find((th) => th.authorId !== c.id).id }));
  }
  await Promise.all(clients.map((c) => c.wait('room', (m) => m.room.pre && m.room.pre.stage === 'prep', 0, 9000)));
  clients.forEach((c) => c.send({ t: 'pre-prep', bpm: 100, instrumentId: 'piano', mode: 'expert' }));
  await Promise.all(clients.map((c) => c.wait('room', (m) => m.room.round && m.room.pre && m.room.pre.stage === 'done', 0, 9000)));
}

class Client {
  constructor(port, name) {
    this.name = name;
    this.messages = [];
    this.waiters = [];
    this.ws = new WebSocket('ws://127.0.0.1:' + port + '/ws');
    this.ready = new Promise((resolve, reject) => {
      this.ws.on('open', resolve);
      this.ws.on('error', reject);
    });
    this.ws.on('message', (data) => {
      const message = JSON.parse(data.toString());
      this.messages.push(message);
      this.waiters = this.waiters.filter((waiter) => !waiter(message));
    });
  }
  send(message) {
    this.ws.send(JSON.stringify(message));
  }
  wait(t, predicate, from = 0, timeout = 4000) {
    const match = (m) => m.t === t && (!predicate || predicate(m));
    const existing = this.messages.slice(from).find(match);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout en attendant ' + t + ' (' + this.name + ')')), timeout);
      this.waiters.push((m) => {
        if (!match(m)) return false;
        clearTimeout(timer);
        resolve(m);
        return true;
      });
    });
  }
  /** Envoie une commande ; attend un instant, puis renvoie { error } si le serveur a refusé, sinon { room } (dernière vue). */
  async cmd(message) {
    const from = this.messages.length;
    this.send(message);
    await sleep(120);
    const error = this.messages.slice(from).find((m) => m.t === 'error');
    if (error) return { error };
    return { room: this.last() };
  }
  last() {
    return this.messages.filter((m) => m.t === 'room').slice(-1)[0].room;
  }
  close() {
    this.ws.close();
  }
}



const crypto = require('crypto');
const { validateContribution } = require('./rooms');

const sha = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');
function wav(seconds, freq) {
  const rate = 8000;
  const n = Math.floor(rate * seconds);
  const data = Buffer.alloc(44 + n * 2);
  data.write('RIFF', 0); data.writeUInt32LE(36 + n * 2, 4); data.write('WAVE', 8); data.write('fmt ', 12);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22); data.writeUInt32LE(rate, 24);
  data.writeUInt32LE(rate * 2, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34); data.write('data', 36); data.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i += 1) data.writeInt16LE(Math.round(12000 * Math.sin((2 * Math.PI * freq * i) / rate)), 44 + i * 2);
  return data;
}

function sampleContribution(hash, extra) {
  const settings = { mode: 'whole', pitched: 'yes', octave: 0, volume: 0, sample: { hash, name: 'Mon son', duration: 0.5 } };
  return Object.assign({ instrumentId: 'sample-' + hash.slice(0, 12), instrument: { id: 'sample-' + hash.slice(0, 12), label: 'Mon son', engine: 'sample', settings }, settings, clip: null, notes: [{ step: 0, row: 5, length: 1 }] }, extra || {});
}

async function main() {
  const A = wav(0.3, 440);
  const hA = sha(A);
  // règles pures
  check('P1 contribution « son importé » : refusée si le serveur n\'a pas le fichier', validateContribution(sampleContribution(hA), 4, () => false).code === 'missing-sound');
  check('P2 acceptée quand le fichier est sur le serveur', validateContribution(sampleContribution(hA), 4, (h) => h === hA).ok);
  check('P3 id d\'instrument incohérent avec l\'empreinte refusé', !validateContribution(sampleContribution(hA, { instrumentId: 'sample-000000000000' }), 4, () => true).ok);
  check('P4 empreinte mal formée refusée', !validateContribution(sampleContribution('zz'), 4, () => true).ok);
  check('P5 « sample-… » sans réglages ni empreinte refusé', !validateContribution({ instrumentId: 'sample-abcdefabcdef', settings: null, notes: [{ step: 0, row: 0, length: 1 }] }, 4, () => true).ok);
  check('P6 instantané qui cite une AUTRE empreinte que les réglages refusé', !validateContribution(sampleContribution(hA, { instrument: { id: 'sample-' + hA.slice(0, 12), engine: 'sample', settings: { sample: { hash: sha(Buffer.from('x')) } } } }), 4, () => true).ok);
  check('P7 la contribution ne contient jamais d\'audio, seulement l\'empreinte (quelques centaines d\'octets)', JSON.stringify(validateContribution(sampleContribution(hA), 4, () => true).value).length < 800);

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const base = 'http://127.0.0.1:' + port;
  manager.introMs = 100;
  manager.drawMs = 300;
  const put = (code, hash, token, body) => fetch(base + '/rooms/' + code + '/sounds/' + hash, { method: 'PUT', headers: token ? { Authorization: 'Bearer ' + token } : {}, body });
  const get = (code, hash, token) => fetch(base + '/rooms/' + code + '/sounds/' + hash, { headers: token ? { Authorization: 'Bearer ' + token } : {} });

  const alice = new Client(port, 'Alice'); await alice.ready;
  alice.send({ t: 'create', name: 'Alice', max: 4 });
  const wa = await alice.wait('welcome');
  const bob = new Client(port, 'Bob'); await bob.ready;
  bob.send({ t: 'join', code: wa.room.code, name: 'Bob' });
  const wb = await bob.wait('welcome');
  const other = new Client(port, 'Zed'); await other.ready;
  other.send({ t: 'create', name: 'Zed', max: 4 });
  const wz = await other.wait('welcome');
  const codeA = wa.room.code;
  const codeZ = wz.room.code;
  const tokA = wa.you.token;
  const tokB = wb.you.token;
  const tokZ = wz.you.token;

  check('H1 envoi sans jeton refusé (403)', (await put(codeA, hA, '', A)).status === 403);
  check('H2 envoi avec le jeton d\'un AUTRE salon refusé (403)', (await put(codeA, hA, tokZ, A)).status === 403);
  check('H3 jeton inventé refusé', (await put(codeA, hA, 'nimportequoi', A)).status === 403);
  let r = await put(codeA, hA, tokA, A);
  check('H4 envoi valide : 201, enregistré dans le salon', r.status === 201 && manager.get(codeA).sounds.has(hA) && manager.get(codeA).soundBytes === A.length);
  r = await put(codeA, hA, tokB, A);
  check('H5 même fichier renvoyé : 200 « déjà là » (pas de doublon, pas de double comptage)', r.status === 200 && (await r.json()).already === true && manager.get(codeA).soundBytes === A.length);
  check('H6 empreinte qui ne correspond pas au contenu refusée (400)', (await put(codeA, sha(Buffer.from('autre')), tokA, A)).status === 400);
  const junk = Buffer.from('ceci n\'est pas de l\'audio'.repeat(20));
  check('H7 contenu qui n\'est pas WAV/MP3/OGG refusé (415), même avec la bonne empreinte', (await put(codeA, sha(junk), tokA, junk)).status === 415);
  const big = Buffer.concat([wav(0.1, 300), Buffer.alloc(5 * 1024 * 1024)]);
  check('H8 fichier trop gros refusé (413) sans être stocké', (await put(codeA, sha(big), tokA, big).catch(() => ({ status: 413 }))).status === 413 && !manager.get(codeA).sounds.has(sha(big)));
  check('H9 empreinte mal formée dans l\'URL : introuvable (404, pas de plantage)', (await get(codeA, 'abc', tokA)).status === 404);
  r = await get(codeA, hA, tokB);
  const back = Buffer.from(await r.arrayBuffer());
  check('H10 un autre joueur du salon télécharge le son, octet pour octet', r.status === 200 && r.headers.get('content-type') === 'audio/wav' && back.equals(A) && sha(back) === hA);
  check('H11 le téléchargement n\'est pas mis en cache partagé', /no-store/.test(r.headers.get('cache-control') || ''));
  check('H12 sans jeton, ou avec le jeton d\'un autre salon : refusé (403)', (await get(codeA, hA, '')).status === 403 && (await get(codeA, hA, tokZ)).status === 403);
  check('H13 le son d\'un salon n\'est PAS lisible via un autre salon (404 même avec jeton valide)', (await get(codeZ, hA, tokZ)).status === 404);
  check('H14 code de salon inconnu : 403', (await get('ZZZZZ', hA, tokA)).status === 403);
  check('H15 méthode non prévue refusée (405)', (await fetch(base + '/rooms/' + codeA + '/sounds/' + hA, { method: 'DELETE', headers: { Authorization: 'Bearer ' + tokA } })).status === 405);
  // quota par joueur
  let last = 0;
  for (let i = 0; i < 9; i += 1) {
    const f = wav(0.05, 100 + i * 10);
    last = (await put(codeA, sha(f), tokB, f)).status;
  }
  check('H16 quota par joueur : 8 fichiers différents maximum (le 9e est refusé en 429)', last === 429 && Array.from(manager.get(codeA).sounds.values()).filter((s) => s.owner === wb.you.id).length === 8, last);
  // l'état du salon ne contient jamais l'audio
  const view = JSON.stringify(manager.get(codeA).view());
  check('H17 la vue diffusée aux joueurs ne contient aucun fichier audio', !view.includes('RIFF') && view.length < 6000, view.length);
  check('H18 les fichiers ne sont pas dans le WebSocket (messages reçus légers)', alice.messages.every((m) => JSON.stringify(m).length < 20000));

  // contribution via WebSocket
  await alice.wait('room');
  alice.send({ t: 'start' });
  await alice.wait('started');
  await bob.wait('started');
  await playPregame([alice, bob]);
  for (let i = 0; i < 40 && manager.get(codeA).round.status !== 'working'; i += 1) await sleep(100);
  const unknown = sha(Buffer.from('jamais envoye'));
  alice.messages.length = 0;
  alice.send({ t: 'submit', round: 0, contribution: sampleContribution(unknown) });
  const refused = await alice.wait('error');
  check('W1 contribution qui cite un son jamais envoyé : refusée (missing-sound)', refused.code === 'missing-sound');
  const hZ = sha(wav(0.4, 500));
  await put(codeZ, hZ, tokZ, wav(0.4, 500));
  alice.messages.length = 0;
  alice.send({ t: 'submit', round: 0, contribution: sampleContribution(hZ) });
  check('W2 contribution qui cite un son d\'UN AUTRE salon : refusée', (await alice.wait('error')).code === 'missing-sound');
  alice.messages.length = 0;
  alice.send({ t: 'submit', round: 0, contribution: sampleContribution(hA) });
  const ok = await bob.wait('contribution');
  check('W3 contribution avec un son présent sur le serveur : acceptée et diffusée avec l\'empreinte seulement', ok.contribution.settings.sample.hash === hA && JSON.stringify(ok.contribution).length < 1500, JSON.stringify(ok.contribution).length);
  check('W4 le son reste disponible après la contribution (aucune dépendance à la bibliothèque de l\'auteur)', (await get(codeA, hA, tokB)).status === 200);

  [alice, bob, other].forEach((c) => c.close());
  await sleep(100);
  server.close();
  console.log('\n' + passed + '/' + (passed + failures.length) + ' OK');
  process.exit(failures.length ? 1 : 0);
}

main().catch((error) => {
  console.error('ERREUR DE TEST', error);
  process.exit(2);
});

'use strict';
/**
 * Tests du serveur de salons : vrais clients WebSocket contre le vrai serveur (port aléatoire).
 *   npm test
 */
const assert = require('assert');
const http = require('http');
const WebSocket = require('ws');
const { server, manager } = require('./server');
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
  /** Attend un message de type `t` (déjà reçu depuis `from`, ou à venir). */
  wait(t, predicate, from = 0, timeout = 4000) {
    const match = (message) => message.t === t && (!predicate || predicate(message));
    const existing = this.messages.slice(from).find(match);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout en attendant ' + t + ' (' + this.name + ')')), timeout);
      this.waiters.push((message) => {
        if (!match(message)) return false;
        clearTimeout(timer);
        resolve(message);
        return true;
      });
    });
  }
  async request(message, expectType, predicate) {
    const from = this.messages.length;
    this.send(message);
    return this.wait(expectType, predicate, from);
  }
  async expectError(message, code) {
    const from = this.messages.length;
    this.send(message);
    const error = await this.wait('error', null, from);
    return error.code === code ? error : Object.assign(error, { wrong: true });
  }
  close() {
    this.ws.close();
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Joue les phases d'avant-composition (proposition, vote, préparation) avec de vrais clients, puis attend l'annonce du round 1. */
async function playPregame(clients, options = {}) {
  const lastRoom = (c) => c.messages.filter((m) => m.t === 'room' || m.t === 'started' || m.t === 'welcome').map((m) => m.room).pop();
  clients.forEach((c) => c.send({ t: 'pre-propose', text: 'Idée de ' + c.name }));
  if (clients.length > 2) {
    await Promise.all(clients.map((c) => c.wait('room', (m) => m.room.pre && m.room.pre.stage === 'vote')));
    clients.forEach((c) => {
      const option = lastRoom(c).pre.book.themes.find((theme) => theme.authorId !== c.id);
      c.send({ t: 'pre-vote', id: option.id });
    });
  }
  await Promise.all(clients.map((c) => c.wait('room', (m) => m.room.pre && m.room.pre.stage === 'prep', 0, 9000)));
  clients.forEach((c, index) => c.send({ t: 'pre-prep', bpm: options.bpm || 100 + index * 10, instrumentId: 'piano', mode: 'expert' }));
  await Promise.all(clients.map((c) => c.wait('room', (m) => m.room.round && m.room.pre && m.room.pre.stage === 'done', 0, 9000)));
}
const goodContribution = (extra) => Object.assign({ instrumentId: 'piano', instrument: { id: 'piano' }, settings: null, notes: [{ step: 0, row: 3, length: 1 }] }, extra);

function get(port, path) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path }, (response) => {
      let body = '';
      response.on('data', (chunk) => (body += chunk));
      response.on('end', () => resolve({ status: response.statusCode, body, headers: response.headers }));
    }).on('error', reject);
  });
}

async function main() {
  manager.introMs = 150; // annonce de round raccourcie pour les tests
  manager.drawMs = 300; // tirage au sort à deux joueurs : affichage raccourci
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  /* ---------------- validation pure ---------------- */
  check('V1 contribution valide acceptée', validateContribution(goodContribution(), 4).ok);
  check('V2 sans note ni voix refusée', !validateContribution(goodContribution({ notes: [] }), 4).ok);
  check('V3 note hors de la boucle refusée', !validateContribution(goodContribution({ notes: [{ step: 16, row: 0, length: 1 }] }), 4).ok);
  check('V4 note valide en boucle de 4 mesures, hors boucle de 2 mesures', validateContribution(goodContribution({ notes: [{ step: 9, row: 0, length: 1 }] }), 4).ok && !validateContribution(goodContribution({ notes: [{ step: 9, row: 0, length: 1 }] }), 2).ok);
  check('V5 durée de note < 0,05 refusée', !validateContribution(goodContribution({ notes: [{ step: 0, row: 0, length: 0.01 }] }), 4).ok);
  check('V5b notes entre les temps acceptées (demi-temps, quart de temps, placement libre) et conservées', (() => { const r = validateContribution(goodContribution({ notes: [{ step: 0.5, row: 0, length: 0.5 }, { step: 2.25, row: 1, length: 0.25 }, { step: 5.1234, row: 2, length: 1.3333 }] }), 4); return r.ok && r.value.notes[0].step === 0.5 && r.value.notes[1].step === 2.25 && r.value.notes[2].step === 5.123 && r.value.notes[2].length === 1.333; })());
  check('V5c pas de NaN / texte comme position', !validateContribution(goodContribution({ notes: [{ step: NaN, row: 0, length: 1 }] }), 4).ok && !validateContribution(goodContribution({ notes: [{ step: '2', row: 0, length: 1 }] }), 4).ok);
  check('V6 instrument invalide refusé', !validateContribution(goodContribution({ instrumentId: '../x' }), 4).ok);
  const clip = { id: 'c1', wav: 'AAAA', sampleRate: 24000, duration: 1.2, peaks: [0.1, 0.5], start: 2, gainDb: 0 };
  check('V6b voyelle par note acceptée et conservée', (() => { const r = validateContribution({ instrumentId: 'vox', instrument: { id: 'vox' }, settings: null, notes: [{ step: 0, row: 3, length: 1, vowel: 'ou' }, { step: 2, row: 3, length: 1, vowel: 'a' }] }, 4); return r.ok && r.value.notes[0].vowel === 'ou' && r.value.notes[1].vowel === 'a'; })());
  check('V6c voyelle inconnue refusée', !validateContribution(goodContribution({ notes: [{ step: 0, row: 3, length: 1, vowel: 'z' }] }), 4).ok);
  check('V7 voix enregistrée valide acceptée (sans note)', validateContribution({ instrumentId: 'mic', notes: [], clip }, 4).ok);
  check('V8 voix trop longue refusée', !validateContribution({ instrumentId: 'mic', notes: [], clip: Object.assign({}, clip, { duration: 99 }) }, 4).ok);
  check('V9 voix non base64 refusée', !validateContribution({ instrumentId: 'mic', notes: [], clip: Object.assign({}, clip, { wav: '<script>' }) }, 4).ok);
  check('V10 voix démarrant hors boucle refusée', !validateContribution({ instrumentId: 'mic', notes: [], clip: Object.assign({}, clip, { start: 40 }) }, 4).ok);

  /* ---------------- salons ---------------- */
  const host = new Client(port, 'Alice');
  await host.ready;
  const welcome = await host.request({ t: 'create', name: '  Alice  ', max: 3 }, 'welcome');
  check('R1 création : code de 5 caractères sans lettres ambiguës', /^[A-HJ-NP-Z2-9]{5}$/.test(welcome.room.code), welcome.room.code);
  check('R2 le créateur est l\'hôte, pseudo nettoyé, jeton secret fourni', welcome.room.hostId === welcome.you.id && welcome.you.name === 'Alice' && welcome.you.token.length >= 16);
  check('R3 la vue du salon ne contient aucun jeton', !JSON.stringify(welcome.room).includes(welcome.you.token));
  const code = welcome.room.code;

  const bad = new Client(port, 'bad'); await bad.ready;
  check('R4 code inconnu : message clair', (await bad.expectError({ t: 'join', code: 'ZZZZZ', name: 'Bob' }, 'no-room')).code === 'no-room');
  check('R5 pseudo vide refusé', (await bad.expectError({ t: 'join', code, name: '   ' }, 'bad-name')).code === 'bad-name');
  check('R6 pseudo déjà pris refusé (sans tenir compte des majuscules)', (await bad.expectError({ t: 'join', code, name: 'aLICE' }, 'name-taken')).code === 'name-taken');
  bad.close();

  const bob = new Client(port, 'Bob'); await bob.ready;
  const bobWelcome = await bob.request({ t: 'join', code: code.toLowerCase(), name: 'Bob' }, 'welcome');
  check('R7 rejoindre avec le code (minuscules acceptées)', bobWelcome.room.players.length === 2 && bobWelcome.room.code === code);
  const aliceSees = await host.wait('room', (m) => m.room.players.length === 2);
  check('R8 l\'hôte voit arriver le participant', aliceSees.room.players.map((p) => p.name).join() === 'Alice,Bob');
  check('R9 couleurs et avatars distincts', new Set(aliceSees.room.players.map((p) => p.color)).size === 2);

  check('R10 un non-hôte ne peut pas régler le salon', (await bob.expectError({ t: 'configure', bars: 2 }, 'not-host')).code === 'not-host');
  check('R11 un non-hôte ne peut pas lancer', (await bob.expectError({ t: 'start' }, 'not-host')).code === 'not-host');
  await host.request({ t: 'configure', bars: 2, bpm: 150, max: 3 }, 'room', (m) => m.room.settings.bars === 2);
  check('R12 l\'hôte règle mesures et tempo', manager.get(code).settings.bpm === 150);
  await host.request({ t: 'configure', bars: 99, bpm: 5 }, 'room', (m) => m.room.settings.bars === 4);
  check('R13 valeurs hors limites ramenées dans les bornes', manager.get(code).settings.bars === 4 && manager.get(code).settings.bpm === 60);
  await host.request({ t: 'configure', bars: 2, bpm: 150 }, 'room', (m) => m.room.settings.bars === 2);
  await host.request({ t: 'configure', max: 2 }, 'room', (m) => m.room.settings.max === 2);
  const carol = new Client(port, 'Carol'); await carol.ready;
  check('R14 salon complet refusé (capacité 2)', (await carol.expectError({ t: 'join', code, name: 'Carol' }, 'full')).code === 'full');
  await host.request({ t: 'configure', max: 3 }, 'room', (m) => m.room.settings.max === 3);
  const carolWelcome = await carol.request({ t: 'join', code, name: 'Carol' }, 'welcome');
  check('R15 3e joueur accepté après augmentation de la capacité', carolWelcome.room.players.length === 3);
  check('R16 impossible de descendre sous le nombre de joueurs présents', (await host.expectError({ t: 'configure', max: 2 }, 'too-many')).code === 'too-many');

  const solo = new Client(port, 'Solo'); await solo.ready;
  const soloRoom = await solo.request({ t: 'create', name: 'Solo', max: 4 }, 'welcome');
  check('R17 démarrer seul impossible (2 joueurs minimum)', (await solo.expectError({ t: 'start' }, 'not-enough')).code === 'not-enough');
  check('R18 deux salons ont deux codes différents', soloRoom.room.code !== code);
  solo.close();

  /* ---------------- partie à 3 : rounds simultanés ---------------- */
  const ids = { Alice: welcome.you.id, Bob: bobWelcome.you.id, Carol: carolWelcome.you.id };
  manager.get(code).settings.roundSeconds = 60;
  const roundOf = (client, from = 0) => client.messages.slice(from).filter((m) => m.t === 'room' || m.t === 'started').map((m) => m.room).filter((r) => r.round).pop();
  const started = await host.request({ t: 'start' }, 'started');
  await Promise.all([bob.wait('started'), carol.wait('started')]);
  host.id = ids.Alice; bob.id = ids.Bob; carol.id = ids.Carol;
  check('G0 au lancement, la partie commence par la proposition des thèmes (pas par le round 1)', started.room.status === 'playing' && started.room.pre.stage === 'propose' && started.room.round === null);
  await playPregame([host, bob, carol]);
  const plan = started.room.plan;
  check('G1 3 chansons, chacune avec son créateur', started.room.songs.length === 3 && started.room.songs.map((s) => s.creatorId).join() === [ids.Alice, ids.Bob, ids.Carol].join());
  check('G2 3 rounds de 3 tâches (créations puis ajouts)', plan.length === 3 && plan.every((r) => r.length === 3) && plan[0].every((t) => t.kind === 'create') && plan[1].concat(plan[2]).every((t) => t.kind === 'add'));
  check('G3 rotation : chaque round, 3 chansons différentes ; jamais sa propre chanson après le round 1', plan.every((r) => new Set(r.map((t) => t.songId)).size === 3) && plan.slice(1).every((r) => r.every((t) => started.room.songs.find((s) => s.id === t.songId).creatorId !== t.playerId)));
  check('G3b chaque joueur reçoit 3 chansons différentes en 3 rounds', [ids.Alice, ids.Bob, ids.Carol].every((id) => new Set(plan.map((r) => r.find((t) => t.playerId === id).songId)).size === 3));
  const firstRound = roundOf(host).round;
  check('G3c la vue annonce le round 1 (annonce, durée du chrono, 3 tâches « working »)', firstRound.index === 0 && firstRound.status === 'intro' && firstRound.durationMs === 60000 && firstRound.tasks.every((t) => t.status === 'working'));
  const late = new Client(port, 'late'); await late.ready;
  check('G4 on ne rejoint plus une partie commencée', (await late.expectError({ t: 'join', code, name: 'Dave' }, 'started')).code === 'started');
  late.close();

  check('G5 pendant l\'annonce, envoyer est refusé', (await host.expectError({ t: 'submit', round: 0, contribution: goodContribution() }, 'too-early')).code === 'too-early');
  await host.wait('room', (m) => m.room.round && m.room.round.status === 'working', host.messages.length - 1).catch(() => null);
  await sleep(700);
  check('G6 le chrono démarre (statut working, temps restant ≈ 60 s)', manager.get(code).round.status === 'working' && roundOf(host).round.remainingMs > 50000, roundOf(host).round);
  check('G7 mauvais round refusé', (await host.expectError({ t: 'submit', round: 2, contribution: goodContribution() }, 'stale-round')).code === 'stale-round');
  check('G8 contribution vide refusée pendant le chrono (« Prêt » sans rien)', (await host.expectError({ t: 'submit', round: 0, contribution: goodContribution({ notes: [] }) }, 'invalid')).code === 'invalid');
  check('G8b « Prêt » sans contenu du tout refusé', (await host.expectError({ t: 'submit', round: 0, contribution: null }, 'invalid')).code === 'invalid');
  check('G9 contribution hors boucle refusée', (await host.expectError({ t: 'submit', round: 0, contribution: goodContribution({ notes: [{ step: 99, row: 0, length: 1 }] }) }, 'invalid')).code === 'invalid');
  check('G9b rien n\'a été enregistré par les refus', manager.get(code).contributions.length === 0);

  // Alice est prête avant les autres : sa contribution est enregistrée et diffusée, le round continue.
  const aliceFrom = bob.messages.length;
  const aliceDone = await host.request({ t: 'submit', round: 0, contribution: goodContribution() }, 'contribution');
  const bobSaw = await bob.wait('contribution', (m) => m.contribution.playerId === ids.Alice, aliceFrom);
  check('G10 « Prêt » d\'Alice : enregistré et vu par Bob', aliceDone.contribution.playerId === ids.Alice && bobSaw.contribution.id === aliceDone.contribution.id && aliceDone.contribution.endReason === 'ready' && aliceDone.contribution.empty === false);
  check('G11 le round continue tant que Bob et Carol travaillent', manager.get(code).round.index === 0 && manager.get(code).round.status === 'working' && manager.get(code).round.tasks.find((t) => t.playerId === ids.Alice).status === 'ready');
  check('G12 renvoyer (double clic, rechargement) est refusé : pas de doublon', (await host.expectError({ t: 'submit', round: 0, contribution: goodContribution({ notes: [{ step: 2, row: 1, length: 1 }] }) }, 'duplicate')).code === 'duplicate');
  check('G12b la contribution d\'Alice n\'a pas été écrasée', manager.get(code).contributions.length === 1 && manager.get(code).contributions[0].notes[0].step === 0);

  // Les deux autres valident en même temps : le round se termine immédiatement et le suivant est annoncé.
  const fromBob = bob.messages.length;
  bob.send({ t: 'submit', round: 0, contribution: goodContribution({ notes: [{ step: 1, row: 2, length: 1 }] }) });
  carol.send({ t: 'submit', round: 0, contribution: goodContribution({ notes: [{ step: 2, row: 2, length: 1 }] }) });
  const next = await bob.wait('room', (m) => m.room.round && m.room.round.index === 1, fromBob);
  check('G13 tous prêts → round 2 annoncé tout de suite (avant la fin du chrono)', next.room.round.status === 'intro' && next.room.round.lastEnd === 'all-ready', next.room.round);
  check('G14 3 contributions de round 1, toutes « ready », aucune vide', manager.get(code).contributions.filter((c) => c.round === 0).length === 3 && manager.get(code).contributions.every((c) => c.endReason === 'ready' && !c.empty));

  for (const index of [1, 2]) {
    await sleep(700);
    const working = manager.get(code).round.status === 'working';
    if (!working) check('G15.' + index + ' round ' + (index + 1) + ' en cours', false);
    host.send({ t: 'submit', round: index, contribution: goodContribution({ notes: [{ step: index, row: 4, length: 2 }] }) });
    bob.send({ t: 'submit', round: index, contribution: goodContribution({ instrumentId: 'bass', notes: [{ step: index + 1, row: 1, length: 1 }] }) });
    carol.send({ t: 'submit', round: index, contribution: goodContribution({ instrumentId: 'lead', notes: [{ step: index + 2, row: 0, length: 1 }] }) });
    if (index === 1) await host.wait('room', (m) => m.room.round && m.room.round.index === 2, host.messages.length - 1).catch(() => null);
  }
  await Promise.all([host, bob, carol].map((c) => c.wait('room', (m) => m.room.status === 'finished')));
  const room = manager.get(code);
  const all = room.contributions;
  check('G16 9 contributions, la partie est terminée', all.length === 9 && room.status === 'finished', [all.length, room.status]);
  check('G17 chaque participant contribue exactement une fois à chaque chanson', new Set(all.map((c) => c.songId + '|' + c.playerId)).size === 9);
  check('G18 la 1re contribution de chaque chanson est celle de son créateur (base intacte)', room.songs.every((s) => all.find((c) => c.songId === s.id && c.order === 0).playerId === s.creatorId && all.find((c) => c.songId === s.id && c.order === 0).kind === 'initial'));
  check('G19 ordres 0,1,2 par chanson, une contribution par round', room.songs.every((s) => all.filter((c) => c.songId === s.id).map((c) => c.order).sort().join() === '0,1,2' && all.filter((c) => c.songId === s.id).map((c) => c.round).sort().join() === '0,1,2'));
  const seen = (c) => c.messages.filter((m) => m.t === 'contribution').map((m) => m.contribution.id).join(',');
  check('G20 les 3 joueurs ont reçu les mêmes 9 contributions dans le même ordre', seen(host) === seen(bob) && seen(bob) === seen(carol) && seen(host).split(',').length === 9, [seen(host), seen(bob), seen(carol)]);
  check('G21 contenu préservé : notes, instrument, auteur, chanson', all.find((c) => c.round === 1 && c.playerId === ids.Bob).instrumentId === 'bass' && all.every((c) => Array.isArray(c.notes) && c.notes.length === 1));
  check('G22 après la fin, plus aucune soumission', (await host.expectError({ t: 'submit', round: 2, contribution: goodContribution() }, 'not-playing')).code === 'not-playing');
  check('G23 la vue ne contient aucun jeton', !JSON.stringify(room.view()).includes(welcome.you.token));

  /* ---------------- aide : parties de test ---------------- */
  const game = async (n, names, seconds) => {
    const clients = [];
    for (let i = 0; i < n; i += 1) {
      const c = new Client(port, names[i]); await c.ready; clients.push(c);
    }
    const w0 = await clients[0].request({ t: 'create', name: names[0], max: n }, 'welcome');
    const ws = [w0];
    for (let i = 1; i < n; i += 1) ws.push(await clients[i].request({ t: 'join', code: w0.room.code, name: names[i] }, 'welcome'));
    const gameRoom = manager.get(w0.room.code);
    if (seconds) gameRoom.settings.roundSeconds = seconds;
    await clients[0].request({ t: 'start' }, 'started');
    await Promise.all(clients.slice(1).map((c) => c.wait('started')));
    clients.forEach((c, i) => { c.id = ws[i].you.id; });
    await playPregame(clients);
    return { clients, ws, room: gameRoom, code: w0.room.code };
  };
  const untilWorking = async (g) => { for (let i = 0; i < 40 && g.room.round.status !== 'working'; i += 1) await sleep(100); };

  /* ---------------- chrono à zéro : brouillon sauvegardé, rien inventé pour qui n'a rien envoyé ---------------- */
  const Rounds = require('../js/rounds.js');
  Rounds.GRACE_SECONDS = 1.5;
  const t = await game(3, ['Tina', 'Théo', 'Tara'], 5);
  await untilWorking(t);
  const tNames = t.ws.map((w) => w.you.id);
  t.clients[0].send({ t: 'submit', round: 0, contribution: goodContribution() }); // Tina : prête
  await t.clients[1].wait('contribution', (m) => m.contribution.playerId === tNames[0]);
  check('Z1 pendant le chrono, un envoi automatique (null) n\'est pas une contribution valide', (await t.clients[1].expectError({ t: 'submit', round: 0, contribution: null }, 'invalid')).code === 'invalid');
  const closing = await t.clients[1].wait('room', (m) => m.room.round && m.room.round.status === 'closing', 0, 9000);
  check('Z2 chrono à zéro : le salon passe en « closing » (délai pour envoyer les brouillons)', closing.room.round.status === 'closing' && closing.room.round.index === 0);
  const draft = await t.clients[1].request({ t: 'submit', round: 0, contribution: goodContribution({ notes: [{ step: 5, row: 2, length: 1 }] }) }, 'contribution');
  check('Z3 le brouillon envoyé à temps est sauvegardé tel quel (raison « timeout », non vide)', draft.contribution.endReason === 'timeout' && !draft.contribution.empty && draft.contribution.notes[0].step === 5);
  const afterRound = await t.clients[0].wait('room', (m) => m.room.round && m.room.round.index === 1, 0, 6000);
  const r0 = t.room.contributions.filter((c) => c.round === 0);
  const tara = r0.find((c) => c.playerId === tNames[2]);
  check('Z4 qui n\'a rien envoyé reçoit une contribution VIDE (aucune note inventée)', tara && tara.empty === true && tara.notes.length === 0 && tara.instrumentId === null && tara.endReason === 'timeout', tara);
  check('Z5 le round suivant démarre sans bloquer, raison « timeout »', afterRound.room.round.lastEnd === 'timeout');
  check('Z6 3 contributions pour le round 1 (1 prête, 1 sauvegardée au chrono, 1 vide)', r0.length === 3 && r0.filter((c) => c.empty).length === 1);
  check('Z7 une fois le round clos, un retardataire est refusé (round périmé)', (await t.clients[2].expectError({ t: 'submit', round: 0, contribution: goodContribution() }, 'stale-round')).code === 'stale-round');
  t.clients.forEach((c) => c.close());
  Rounds.GRACE_SECONDS = 3;

  /* ---------------- joueur absent : ne bloque jamais, reprise possible ---------------- */
  const g = await game(3, ['Ana', 'Ben', 'Cléo'], 60);
  await untilWorking(g);
  const by = (id) => g.clients[g.ws.findIndex((w) => w.you.id === id)];
  const gid = g.ws.map((w) => w.you.id);
  g.clients[1].close(); // Ben part en plein round 1
  await g.clients[0].wait('room', (m) => m.room.players.find((p) => p.name === 'Ben' && !p.connected));
  check('P1 l\'absence de Ben est signalée aux autres', g.room.player(gid[1]).connected === false);
  g.clients[0].send({ t: 'submit', round: 0, contribution: goodContribution() });
  g.clients[2].send({ t: 'submit', round: 0, contribution: goodContribution({ notes: [{ step: 3, row: 3, length: 1 }] }) });
  await g.clients[0].wait('room', (m) => m.room.round && m.room.round.index === 1);
  const ben0 = g.room.contributions.find((c) => c.round === 0 && c.playerId === gid[1]);
  check('P2 les présents sont prêts : le round se termine sans attendre Ben', g.room.round.index === 1 && g.room.round.lastEnd === 'all-ready');
  check('P3 la tâche de Ben est une contribution vide « absent »', ben0 && ben0.empty && ben0.endReason === 'absent');
  const back = new Client(port, 'Ben-bis'); await back.ready;
  const welcomeBack = await back.request({ t: 'join', code: g.code, token: g.ws[1].you.token }, 'welcome');
  const sync = await back.wait('sync');
  check('P4 reconnexion avec le jeton : même joueur, état complet (contributions vides comprises)', welcomeBack.reconnected && welcomeBack.you.id === gid[1] && sync.contributions.length === 3 && sync.room.round.index === 1);
  check('P5 un faux jeton ne donne pas la place', (await (async () => { const f = new Client(port, 'f'); await f.ready; const e = await f.expectError({ t: 'join', code: g.code, name: 'Zed', token: 'faux' }, 'started'); f.close(); return e; })()).code === 'started');
  await untilWorking(g);
  check('P6 Ben, revenu pendant le round 2, peut jouer', (await back.request({ t: 'submit', round: 1, contribution: goodContribution() }, 'contribution')).contribution.playerId === gid[1]);
  check('P6b mais il ne peut plus rejouer le round 1', (await back.expectError({ t: 'submit', round: 0, contribution: goodContribution() }, 'stale-round')).code === 'stale-round');
  g.clients[0].close();
  await back.wait('room', (m) => m.room.hostId !== gid[0]);
  check('P7 hôte déconnecté : le rôle passe à un joueur présent', g.room.hostId !== gid[0] && g.room.player(g.room.hostId).connected);
  back.close(); g.clients.forEach((c) => c.close());

  /* ---------------- quitter en cours de partie ---------------- */
  const k = await game(2, ['Lina', 'Marc'], 60);
  await untilWorking(k);
  k.clients[1].send({ t: 'leave' });
  await k.clients[0].wait('room', (m) => m.room.players.find((p) => p.name === 'Marc' && !p.connected));
  check('L1 quitter en cours de partie : le joueur reste listé comme absent', k.room.players.length === 2 && !k.room.players[1].connected);
  k.clients[0].send({ t: 'submit', round: 0, contribution: goodContribution() });
  await k.clients[0].wait('room', (m) => m.room.round && m.room.round.index === 1);
  check('L2 la partie à 2 continue avec le joueur restant (rounds suivants jouables)', k.room.round.index === 1 && k.room.contributions.length === 2);
  await untilWorking(k);
  k.clients[0].send({ t: 'submit', round: 1, contribution: goodContribution() });
  await k.clients[0].wait('room', (m) => m.room.status === 'finished');
  check('L3 la partie à 2 se termine : 4 contributions dont 2 vides (Marc absent)', k.room.contributions.length === 4 && k.room.contributions.filter((c) => c.empty && c.endReason === 'absent').length === 2);
  k.clients.forEach((c) => c.close());

  /* ---------------- 2 joueurs complets ---------------- */
  const d = await game(2, ['Duo1', 'Duo2'], 60);
  await untilWorking(d);
  const dIds = d.ws.map((w) => w.you.id);
  const dHost = d.clients[dIds.indexOf(d.room.hostId)];
  const dGuest = d.clients[dIds.indexOf(d.room.hostId) === 0 ? 1 : 0];
  check('Rv0 pendant la composition, personne (hôte compris) ne peut lancer la révélation', (await dHost.expectError({ t: 'reveal-start' }, 'bad-state')).code === 'bad-state' && (await dGuest.expectError({ t: 'reveal-start' }, 'bad-state')).code === 'bad-state');
  for (const round of [0, 1]) {
    if (round === 1) await untilWorking(d);
    d.clients.forEach((c) => c.send({ t: 'submit', round, contribution: goodContribution({ notes: [{ step: round, row: 2, length: 1 }] }) }));
    if (round === 0) await d.clients[0].wait('room', (m) => m.room.round && m.room.round.index === 1);
  }
  await d.clients[0].wait('room', (m) => m.room.status === 'finished');
  check('D1 deux joueurs : 2 rounds, 4 contributions, chacun contribue aux deux chansons', d.room.contributions.length === 4 && new Set(d.room.contributions.map((c) => c.songId + '|' + c.playerId)).size === 4 && d.room.plan.length === 2);

  /* ---------------- révélation contrôlée par l'hôte ---------------- */
  const rv = (c) => c.messages.filter((m) => m.t === 'room').slice(-1)[0].room.reveal;
  check('Rv1 fin de partie : la révélation attend l\'hôte (étape « waiting », aucune chanson lancée)', d.room.reveal && d.room.reveal.stage === 'waiting' && rv(dHost).stage === 'waiting' && rv(dHost).songIndex === -1);
  check('Rv2 un joueur qui n\'est pas l\'hôte ne peut PAS démarrer la révélation', (await dGuest.expectError({ t: 'reveal-start' }, 'not-host')).code === 'not-host' && d.room.reveal.stage === 'waiting');
  const fromA = dHost.messages.length, fromB = dGuest.messages.length;
  dHost.send({ t: 'reveal-start' });
  const gotA = await dHost.wait('room', (m) => m.room.reveal && m.room.reveal.stage === 'song', fromA);
  const gotB = await dGuest.wait('room', (m) => m.room.reveal && m.room.reveal.stage === 'song', fromB);
  check('Rv3 l\'hôte démarre : TOUS les joueurs reçoivent la même décision (chanson 0, même séquence)', gotA.room.reveal.songIndex === 0 && gotB.room.reveal.songIndex === 0 && gotA.room.reveal.seq === gotB.room.reveal.seq && gotA.room.reveal.seq === 1);
  check('Rv4 un joueur qui n\'est pas l\'hôte ne peut pas passer à la chanson suivante', (await dGuest.expectError({ t: 'reveal-next' }, 'not-host')).code === 'not-host' && d.room.reveal.songIndex === 0);
  check('Rv5 il ne peut pas non plus relancer ni terminer', (await dGuest.expectError({ t: 'reveal-replay', index: 0 }, 'not-host')).code === 'not-host' && (await dGuest.expectError({ t: 'reveal-end' }, 'not-host')).code === 'not-host');
  check('Rv6 le serveur refuse de redémarrer une révélation déjà lancée', (await dHost.expectError({ t: 'reveal-start' }, 'bad-state')).code === 'bad-state');
  check('Rv7 terminer avant la dernière chanson est refusé', (await dHost.expectError({ t: 'reveal-end' }, 'bad-state')).code === 'bad-state');
  const fromA2 = dHost.messages.length, fromB2 = dGuest.messages.length;
  dHost.send({ t: 'reveal-next' });
  const nextA = await dHost.wait('room', (m) => m.room.reveal && m.room.reveal.songIndex === 1, fromA2);
  const nextB = await dGuest.wait('room', (m) => m.room.reveal && m.room.reveal.songIndex === 1, fromB2);
  check('Rv8 « suivante » de l\'hôte : chanson 2 pour tout le monde (séquence suivante)', nextA.room.reveal.seq === 2 && nextB.room.reveal.seq === 2 && nextB.room.reveal.stage === 'song');
  check('Rv9 après la dernière chanson, « suivante » est refusé (il faut terminer)', (await dHost.expectError({ t: 'reveal-next' }, 'last-song')).code === 'last-song');
  const fromB3 = dGuest.messages.length;
  dHost.send({ t: 'reveal-replay', index: 0 });
  const replayB = await dGuest.wait('room', (m) => m.room.reveal && m.room.reveal.seq === 3, fromB3);
  check('Rv10 réécoute décidée par l\'hôte : tout le monde rejoue la chanson 1 (nouvelle séquence)', replayB.room.reveal.songIndex === 0 && replayB.room.reveal.stage === 'song');
  const syncFrom = dGuest.messages.length;
  dGuest.send({ t: 'reveal-sync' });
  const synced = await dGuest.wait('room', null, syncFrom);
  check('Rv11 « resynchronisation » : un client retrouve l\'état courant (étape, chanson, temps écoulé)', synced.room.reveal.stage === 'song' && synced.room.reveal.songIndex === 0 && typeof synced.room.reveal.elapsedMs === 'number' && synced.room.reveal.elapsedMs >= 0);
  dHost.send({ t: 'reveal-replay', index: 1 }); await dGuest.wait('room', (m) => m.room.reveal && m.room.reveal.seq === 4, syncFrom);
  dHost.send({ t: 'reveal-end' });
  const endB = await dGuest.wait('room', (m) => m.room.reveal && m.room.reveal.stage === 'ended', syncFrom);
  check('Rv12 « Terminer la partie » de l\'hôte : écran final pour tout le monde', endB.room.reveal.stage === 'ended');
  check('Rv13 plus aucune commande de révélation après la fin', (await dHost.expectError({ t: 'reveal-next' }, 'bad-state')).code === 'bad-state');
  const titles = d.room.view().songs.map((song) => song.title);
  check('Rv14 chaque chanson porte le nom de son créateur initial (titre fixé par le serveur au lancement)', titles[0] === 'La chanson de Duo1' && titles[1] === 'La chanson de Duo2' && d.room.songs.every((song, i) => song.creatorId === d.room.players[i].id), titles);
  check('Rv15 le titre est le même dans la vue de chaque joueur', JSON.stringify(dHost.messages.filter((m) => m.t === 'room').slice(-1)[0].room.songs.map((x) => x.title)) === JSON.stringify(dGuest.messages.filter((m) => m.t === 'room').slice(-1)[0].room.songs.map((x) => x.title)));
  d.clients.forEach((c) => c.close());

  /* ---------------- fichiers statiques ---------------- */
  const index = await get(port, '/');
  check('S1 le jeu est servi (index.html)', index.status === 200 && index.body.includes('Gartic Bande') && index.headers['content-type'].startsWith('text/html'));
  check('S2 les scripts sont servis', (await get(port, '/js/game.js')).status === 200);
  check('S3 le dossier server/ n\'est pas servi', (await get(port, '/server/rooms.js')).status === 404 && (await get(port, '/server/package.json')).status === 404);
  check('S4 pas de remontée de dossier', (await get(port, '/js/..%2f..%2fetc%2fpasswd')).status === 404 && (await get(port, '/../server/server.js')).status === 404);
  const skinHost = new Client(port, 'Skin');
  await skinHost.ready;
  const skinWelcome = await skinHost.request({ t: 'create', name: 'Skin', max: 3, skin: { color: 'blue', hat: 'wizard' } }, 'welcome');
  const skinMe = skinWelcome.room.players.find((p) => p.id === skinWelcome.you.id);
  check('K1 skin choisi (couleur + chapeau) renvoyé dans le salon', skinMe && skinMe.skin && skinMe.skin.color === 'blue' && skinMe.skin.hat === 'wizard');
  const badHost = new Client(port, 'Bad');
  await badHost.ready;
  const badWelcome = await badHost.request({ t: 'create', name: 'Bad', max: 3, skin: { color: '<x>', hat: '../../etc' } }, 'welcome');
  const badMe = badWelcome.room.players.find((p) => p.id === badWelcome.you.id);
  check('K2 skin invalide nettoyé (couleur connue, chapeau sûr)', badMe && badMe.skin && badMe.skin.hat === 'none' && /^[a-z]+$/.test(badMe.skin.color));
  skinHost.close(); badHost.close();

  check('S5 /health répond', (await get(port, '/health')).body === 'ok');
  check('S6 aucun jeton ni clé n\'apparaît dans les fichiers publics', !(await get(port, '/js/game.js')).body.match(/AKIA|secret_key|api[_-]?key/i));

  [host, bob, carol].forEach((c) => c.close());
  await sleep(100);
  server.close();
  console.log('\n' + passed + '/' + (passed + failures.length) + ' OK');
  process.exit(failures.length ? 1 : 0);
}

main().catch((error) => {
  console.error('ERREUR DE TEST', error);
  process.exit(2);
});
